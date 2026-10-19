import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	aendereAnlage,
	anlagePerQr,
	anlagenVerlauf,
	holeAnlage,
	holeAnlagenDatei,
	legeAnlageAn,
	legeStoerungAn,
	listeAnlagen,
	loescheAnlage,
	planeWartung,
	setzeStoerungBehoben,
	speichereAnlagenDatei
} from '../../src/lib/server/anlagen';
import { aendereAuftrag, holeAuftrag, legeAuftragAn, sichtVon } from '../../src/lib/server/auftraege';
import { aendereTodo, todoSichtVon } from '../../src/lib/server/todos';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { naechsterTermin } from '../../src/lib/wiederholung';
import { baueUmgebung, testPng, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** Anlagen an Objekten mit QR-Code (Wünsche Jamil, msgs 2503/2505). */
describe('Anlagen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const heute = () => berlinTag(new Date());
	const wp = (extra: Record<string, unknown> = {}) =>
		legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'waermepumpe', bezeichnung: 'WP Keller', seriennummer: 'SN-4711', hersteller: 'Vaillant', ...extra }, {
			bauart: 'luft_wasser',
			leistung_kw: '8,5'
		});

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.todos`;
		await root`delete from app.todo_serien`;
		await root`update app.auftraege set anlage_id = null`;
		await root`delete from app.anlagen`;
	});

	it('anlegen mit Zusatzfeldern; QR-Kürzel zufällig (nicht die ID); Liste je Objekt', async () => {
		const a = await wp();
		expect(a).toMatchObject({ typ: 'waermepumpe', typName: 'Wärmepumpe', bezeichnung: 'WP Keller', seriennummer: 'SN-4711', objektBezeichnung: 'Haus Müller' });
		expect(a.extra).toEqual({ bauart: 'luft_wasser', leistung_kw: 8.5 });
		expect(a.qrToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
		expect(a.qrToken).not.toContain(a.id.slice(0, 8));
		const b = await legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'solar' });
		expect(b.bezeichnung).toBe('Solar / PV'); // ohne Bezeichnung: Typname
		expect(b.qrToken).not.toBe(a.qrToken);
		expect((await listeAnlagen(kA(), u.kundeA, u.objektA)).map((x) => x.bezeichnung)).toEqual(['Solar / PV', 'WP Keller']);
	});

	it('ungültige Eingaben → 400; fremdes Objekt/fremde Anlage → 404 (RLS)', async () => {
		await expect(legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'atom' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'solar', baujahr: '1850' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'solar' }, { leistung_kwp: 'viel' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'solar', wartungRegel: 'stuendlich' })).rejects.toMatchObject({ status: 400 });
		await expect(legeAnlageAn(kA(), u.kundeB, u.objektA, { typ: 'solar' })).rejects.toMatchObject({ status: 404 });
		await expect(legeAnlageAn(kB(), u.kundeA, u.objektA, { typ: 'solar' })).rejects.toMatchObject({ status: 404 });
		const a = await wp();
		await expect(holeAnlage(kB(), a.id)).rejects.toMatchObject({ status: 404 });
		await expect(aendereAnlage(kB(), a.id, { typ: 'solar' })).rejects.toMatchObject({ status: 404 });
		await expect(loescheAnlage(kB(), a.id)).rejects.toMatchObject({ status: 404 });
		await expect(holeAnlage(kA(), UNBEKANNT)).rejects.toMatchObject({ status: 404 });
		// RLS: Betrieb B sieht die Zeile nicht einmal direkt
		expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select id from app.anlagen`)).toHaveLength(0);
	});

	it('Garantie-Erinnerung: To-do 30 Tage vor Ablauf; Änderung ersetzt es; abgelaufen → keins', async () => {
		const bis = tagPlus(heute(), 100);
		const a = await wp({ garantieBis: bis });
		const erinnerung = async () =>
			(await root`select titel, to_char(faellig, 'YYYY-MM-DD') as faellig from app.todos where anlage_id = ${a.id} and erledigt_am is null`) as any[];
		expect(await erinnerung()).toEqual([{ titel: 'Garantie endet: WP Keller', faellig: tagPlus(bis, -30) }]);
		await aendereAnlage(kA(), a.id, { typ: 'waermepumpe', bezeichnung: 'WP Keller', garantieBis: tagPlus(heute(), 10) });
		expect(await erinnerung()).toEqual([{ titel: 'Garantie endet: WP Keller', faellig: heute() }]);
		await aendereAnlage(kA(), a.id, { typ: 'waermepumpe', bezeichnung: 'WP Keller', garantieBis: tagPlus(heute(), -1) });
		expect(await erinnerung()).toEqual([]);
	});

	it('Wartung planen: wiederkehrendes To-do an der Anlage; Abhaken → nächstes (mit Anlage); doppelt → 409', async () => {
		const a = await wp({ wartungRegel: 'jaehrlich', wartungIntervall: '1' });
		expect(a.wartungText).toBe('jährlich');
		const t = await planeWartung(kA(), a.id, { faellig: tagPlus(heute(), 7), zustaendigId: u.ids.monteurA });
		expect(t).toMatchObject({ titel: 'Wartung: WP Keller', anlage: { id: a.id, bezeichnung: 'WP Keller' }, serie: { text: 'jährlich' } });
		await expect(planeWartung(kA(), a.id, {})).rejects.toMatchObject({ status: 409 });
		await aendereTodo(kA(), t.id, { erledigt: true });
		const [n] = await root`select anlage_id, to_char(faellig, 'YYYY-MM-DD') as f from app.todos where serie_id = ${t.serie!.id} and erledigt_am is null`;
		expect(n.anlage_id).toBe(a.id);
		const start = tagPlus(heute(), 7);
		expect(n.f).toBe(naechsterTermin(start, { regel: 'jaehrlich', intervall: 1, startTag: start }, heute()));
		const ohne = await legeAnlageAn(kA(), u.kundeA, u.objektA, { typ: 'klima' });
		await expect(planeWartung(kA(), ohne.id, {})).rejects.toMatchObject({ status: 400 });
	});

	it('Auftrag zur Anlage: nur Anlage des eigenen Objekts; Objektwechsel löscht die Anlage', async () => {
		const a = await wp();
		const auftrag = await legeAuftragAn(kA(), { titel: 'Wartung WP', kundeId: u.kundeA, objektId: u.objektA, anlageId: a.id });
		expect(auftrag).toMatchObject({ anlageId: a.id, anlageBezeichnung: 'WP Keller' });
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeId: u.kundeA, anlageId: a.id })).rejects.toMatchObject({ status: 400 });
		const anderes = (await root`
			insert into app.objekte (betrieb_id, kunde_id, bezeichnung) values (${u.betriebA}, ${u.kundeA}, 'Ferienhaus') returning id`)[0].id;
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeId: u.kundeA, objektId: anderes, anlageId: a.id })).rejects.toMatchObject({
			status: 400
		});
		// Titel ändern behält die Anlage, Objektwechsel nimmt sie weg
		expect((await aendereAuftrag(kA(), auftrag.id, { titel: 'Wartung WP 2026' })).anlageId).toBe(a.id);
		expect((await aendereAuftrag(kA(), auftrag.id, { objektId: anderes })).anlageId).toBeNull();
		await aendereAuftrag(kA(), auftrag.id, { objektId: u.objektA, anlageId: a.id });
		// Löschen der Anlage: Auftrag bleibt, ohne Anlage
		await loescheAnlage(kA(), a.id);
		expect((await holeAuftrag(kA(), sichtVon(u.chefA), auftrag.id)).anlageId).toBeNull();
		await root`delete from app.objekte where id = ${anderes}`;
	});

	it('Verlauf: Aufträge (nach Sicht), To-dos, Störungen; Störung beheben', async () => {
		const a = await wp({ garantieBis: tagPlus(heute(), 200) });
		const auftrag = await legeAuftragAn(kA(), { titel: 'Reparatur WP', kundeId: u.kundeA, objektId: u.objektA, anlageId: a.id });
		const s = await legeStoerungAn(kA(), a.id, { titel: 'Fehler E42', beschreibung: 'Läuft nicht an' });
		expect(s).toMatchObject({ titel: 'Fehler E42', quelle: 'intern', vonName: 'Chef A', behobenAm: null });
		expect((await holeAnlage(kA(), a.id)).offeneStoerungen).toBe(1);
		const v = await anlagenVerlauf(kA(), a.id, sichtVon(u.chefA), todoSichtVon(u.chefA));
		expect(v.auftraege.map((x) => x.titel)).toEqual(['Reparatur WP']);
		expect(v.todos.map((x) => x.titel)).toEqual(['Garantie endet: WP Keller']);
		expect(v.stoerungen.map((x) => x.titel)).toEqual(['Fehler E42']);
		// Monteur ohne Bezug sieht den Auftrag und das fremde To-do nicht
		const m = await anlagenVerlauf({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, a.id, sichtVon(u.monteurA), todoSichtVon(u.monteurA));
		expect(m.auftraege).toEqual([]);
		expect(m.todos).toEqual([]);
		expect(m.stoerungen).toHaveLength(1);
		await setzeStoerungBehoben(kA(), a.id, s.id, true);
		expect((await holeAnlage(kA(), a.id)).offeneStoerungen).toBe(0);
		await expect(setzeStoerungBehoben(kB(), a.id, s.id, true)).rejects.toMatchObject({ status: 404 });
		await expect(legeStoerungAn(kA(), a.id, { titel: ' ' })).rejects.toMatchObject({ status: 400 });
		await root`delete from app.auftraege where id = ${auftrag.id}`;
	});

	it('Fotos/Dokumente: Inhalt muss zum Typ passen; fremder Betrieb → 404', async () => {
		const a = await wp();
		const d = await speichereAnlagenDatei(kA(), a.id, { name: 'C:\\fotos\\typenschild.png', typ: 'image/png', inhalt: testPng() });
		expect(d).toMatchObject({ name: 'typenschild.png', typ: 'image/png' });
		expect((await holeAnlagenDatei(kA(), a.id, d.id)).inhalt.byteLength).toBe(testPng().byteLength);
		await expect(
			speichereAnlagenDatei(kA(), a.id, { name: 'x.pdf', typ: 'application/pdf', inhalt: new TextEncoder().encode('<html>') })
		).rejects.toMatchObject({ status: 400 });
		await expect(holeAnlagenDatei(kB(), a.id, d.id)).rejects.toMatchObject({ status: 404 });
	});

	it('QR ohne Anmeldung: nur Typ + Kontakt des Betriebs; unbekannt/kaputt → null; Funktion nur für crm_auth', async () => {
		await root`
			insert into app.betrieb_profil (betrieb_id, firmenname, telefon, email)
			values (${u.betriebA}, 'Bauwelt Test GmbH', '040 123', 'info@bauwelt.test')
			on conflict (betrieb_id) do update set firmenname = excluded.firmenname, telefon = excluded.telefon, email = excluded.email`;
		const a = await wp();
		const t = await anlagePerQr(a.qrToken);
		expect(t).toEqual({
			anlageId: a.id,
			betriebId: u.betriebA,
			typ: 'waermepumpe',
			typName: 'Wärmepumpe',
			kontakt: { firmenname: 'Bauwelt Test GmbH', telefon: '040 123', email: 'info@bauwelt.test', web: null }
		});
		// keine Kunden-/Objektdaten in der Antwort
		expect(JSON.stringify(t)).not.toMatch(/Müller|Lindenweg|SN-4711|WP Keller/);
		expect(await anlagePerQr('x'.repeat(24))).toBeNull();
		expect(await anlagePerQr("' or 1=1 --")).toBeNull();
		expect(await anlagePerQr(a.id)).toBeNull(); // die ID ist kein Kürzel
		// crm_app darf die Funktion nicht aufrufen
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select * from app.anlage_per_qr(${a.qrToken})`)).rejects.toThrow(/permission denied/);
	});
});
