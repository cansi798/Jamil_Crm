import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';
import { legeKalkMitarbeiterAn, speichereBetriebswerte } from '../../src/lib/server/kalkulation';
import { auswertung, lernen, nachkalkulationAuftrag, nachkalkZugriff, uebernimmMinuten, verlustAuftraege } from '../../src/lib/server/nachkalkulation';
import { trageNach, zeitZugriff } from '../../src/lib/server/zeiterfassung';
import { materialHinzufuegen } from '../../src/lib/server/material';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { _fuerTests } from '../../src/lib/server/sprache/befehl';
import { nutzerVon } from './hilfe-1c';

/** Nachkalkulation (Jamil msgs 2770–2774, Punkt 1): Plan/Ist je Auftrag, Auswertung, Lernen, Rechte, Sprache. */
describe('Nachkalkulation', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let katalogId: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	async function angenommenesAngebot(auftrag: string, menge: number, minuten = 60) {
		const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${auftrag}, 'entwurf', '2027-12-31') returning id`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, katalog_position_id, bezeichnung, menge, einheit, einzelpreis_cent, material_cent, arbeit_minuten)
			values (${u.betriebA}, ${a.id}, 1, ${katalogId}, 'Fliesen verlegen', ${menge}, 'm²', 10000, 2000, ${minuten})`;
		await root`update app.angebote set status = 'versendet' where id = ${a.id}`;
		await root`update app.angebote set status = 'angenommen' where id = ${a.id}`;
	}

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		// Kosten-Stundensatz 50 €/h (50.000 € / 1.000 h), empfohlen 60 €/h, km-Satz 0,40 €
		await speichereBetriebswerte(kA(), { standardTage: '200', standardStundenTag: '5', risikoProzent: '10', gewinnProzent: '10', kmSatz: '0,40' });
		await legeKalkMitarbeiterAn(kA(), { name: 'Ali', benutzerId: u.ids.monteurA, brutto: '50.000', agArt: 'prozent', agProzent: '0' });
		const [kp] = await root`insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, einheit, lohn_cent, material_cent, arbeit_minuten)
			values (${u.betriebA}, 'fliesen', 'Fliesen verlegen', 'm²', 8000, 2000, 60) returning id`;
		katalogId = kp.id;
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, '2026-10-20T07:00:00+02:00', '2026-10-20T16:00:00+02:00')`;
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: nur mit „Preise sehen“ UND „Alle Aufträge ansehen“; Monteur und Büro ohne Preise 403', async () => {
		await expect(nachkalkZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		await expect(nachkalkZugriff({ nutzer: u.ohnePreiseA })).rejects.toMatchObject({ status: 403 });
		await expect(nachkalkZugriff({ nutzer: u.chefC })).rejects.toMatchObject({ status: 402 });
		await expect(nachkalkZugriff({ nutzer: u.bueroA })).resolves.toMatchObject({ betriebId: u.betriebA });
	});

	it('Plan/Ist eines Auftrags: Stunden, Fahrt mit km, Material, Gewinn, Ampel; Auftragsseite zeigt sie nur Chef/Büro', async () => {
		await angenommenesAngebot(u.auftragA, 10);
		const m = await zeitZugriff({ nutzer: u.monteurA });
		// 15 h Arbeit (statt 10), 1 h Fahrt mit 50 km
		await trageNach(m, { art: 'arbeit', tag: '2026-10-20', von: '07:00', bis: '15:30', pauseMin: '30', auftragId: u.auftragA, grund: 'Test' });
		await trageNach(m, { art: 'arbeit', tag: '2026-10-21', von: '07:00', bis: '14:00', auftragId: u.auftragA, grund: 'Test' });
		await trageNach(m, { art: 'fahrt', tag: '2026-10-20', von: '06:00', bis: '07:00', auftragId: u.auftragA, km: '50', grund: 'Test' });
		await materialHinzufuegen(await zeitZugriff({ nutzer: u.chefA }), u.auftragA, [{ bezeichnung: 'Kleber', einheit: 'Sack', menge: '4', preis: '60' }]);
		const nk = await nachkalkulationAuftrag(kA(), u.auftragA, { alle: true, benutzerId: u.ids.chefA });
		expect(nk.plan).toMatchObject({ stunden: 10, materialCent: 20_000, kostenCent: 70_000, erloesCent: 100_000, gewinnCent: 30_000 });
		// Ist: 15 h × 50 = 750; Fahrt 1 h × 50 + 50 km × 0,40 = 70; Material 240 → 1.060 → −60 €
		expect(nk.ist).toMatchObject({ stunden: 15, fahrtStunden: 1, km: 50, kmKostenCent: 2_000, fahrtkostenCent: 7_000, materialCent: 24_000, kostenCent: 106_000, gewinnCent: -6_000 });
		expect(nk.ampel).toBe('rot');
		expect(nk.stundenAbweichungProzent).toBe(50);
		const laden = (nutzer: Nutzer) => auftragLoad({ locals: { nutzer }, params: { id: u.auftragA } } as never) as Promise<Record<string, any>>;
		expect((await laden(u.chefA)).nachkalkulation.ist.gewinnCent).toBe(-6_000);
		expect((await laden(u.monteurA)).nachkalkulation).toBeNull();
		expect((await laden(u.ohnePreiseA)).nachkalkulation).toBeNull();
	});

	it('Auswertung je Gewerk, Quelle, Leistung und Mitarbeiter', async () => {
		const g = await auswertung(kA(), { von: '2026-10-19', bis: '2026-10-25', gruppe: 'gewerk' });
		expect(g.auftraege.map((a) => a.id)).toEqual([u.auftragA]);
		expect(g.zeilen).toEqual([expect.objectContaining({ name: 'Fliesen', auftraege: 1, istGewinnCent: -6_000, ampel: 'rot' })]);
		const ma = await auswertung(kA(), { von: '2026-10-19', bis: '2026-10-25', gruppe: 'mitarbeiter' });
		expect(ma.zeilen[0]).toMatchObject({ name: 'Ali Monteur', istStunden: 15 });
		const le = await auswertung(kA(), { von: '2026-10-19', bis: '2026-10-25', gruppe: 'leistung' });
		expect(le.zeilen[0]).toMatchObject({ name: 'Fliesen verlegen', erloesCent: 100_000 });
		const q = await auswertung(kA(), { von: '2026-10-19', bis: '2026-10-25', gruppe: 'quelle' });
		expect(q.zeilen[0].name).toBe('ohne Quelle');
		// anderer Zeitraum: nichts; anderer Betrieb: nichts
		expect((await auswertung(kA(), { von: '2026-11-01', bis: '2026-11-30', gruppe: 'gewerk' })).auftraege).toEqual([]);
		expect((await auswertung({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, { von: '2026-10-19', bis: '2026-10-25', gruppe: 'gewerk' })).auftraege).toEqual([]);
		await expect(auswertung(kA(), { von: '2026-10-25', bis: '2026-10-19', gruppe: 'gewerk' })).rejects.toMatchObject({ status: 400 });
		expect((await verlustAuftraege(kA(), 3650, new Date('2026-10-30T12:00:00Z'))).map((a) => a.id)).toEqual([u.auftragA]);
	});

	it('Lernen: Vorschlag erst ab 3 fertigen Aufträgen; Übernehmen setzt Minuten im Katalog (protokolliert)', async () => {
		await root`update app.auftraege set status = 'abgenommen' where id = ${u.auftragA}`;
		expect(await lernen(kA())).toEqual([]);
		const m = await zeitZugriff({ nutzer: u.chefA });
		for (const [i, std] of [[1, 18], [2, 16]] as const) {
			const a = await u.neuerAuftrag('abgenommen', `Fliesen ${i}`);
			await angenommenesAngebot(a, 10);
			await trageNach(m, { art: 'arbeit', tag: `2026-10-0${i}`, von: '06:00', bis: std === 18 ? '00:00' : '22:00', auftragId: a, grund: 'Test' });
		}
		const v = await lernen(kA());
		// Stichproben 90, 108, 96 Min./m² → Mittel 98
		expect(v).toEqual([expect.objectContaining({ katalogPositionId: katalogId, n: 3, aktuellMin: 60, vorschlagMin: 98, abweichungProzent: 63 })]);
		await uebernimmMinuten(kA(), katalogId, v[0].vorschlagMin);
		const [kp] = await root`select arbeit_minuten from app.katalog_positionen where id = ${katalogId}`;
		expect(Number(kp.arbeit_minuten)).toBe(98);
		const [prot] = await root`select vorher, nachher from app.aenderungen where tabelle = 'katalog_positionen' and datensatz_id = ${katalogId} order by id desc limit 1`;
		expect([Number(prot.vorher.arbeit_minuten), Number(prot.nachher.arbeit_minuten)]).toEqual([60, 98]);
		await expect(uebernimmMinuten({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, katalogId, 10)).rejects.toMatchObject({ status: 404 });
	});

	it('Sprache: „Wie lief der Auftrag …?“ und „Welche Aufträge machen Verlust?“ – nur lesend, Monteur ohne Recht', async () => {
		setzeKiAnbieter(new FakeKi());
		const frage = async (nutzer: Nutzer, text: string) =>
			(await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const r = await frage(u.chefA, 'Wie lief der Auftrag Badsanierung?');
		expect(r.vorschlag).toBeNull();
		expect(r.karte.titel).toMatch(/Nachkalkulation A-\d{4}-\d{4} · Verlust/);
		expect(r.karte.antwort.vorlesen).toMatch(/geplant 10 Stunden, gebraucht 15 Stunden/);
		const v = await frage(u.chefA, 'Welche Aufträge machen Verlust?');
		expect(v.karte.antwort.abschnitte[0].eintraege.length).toBeGreaterThanOrEqual(1);
		const mo = await frage(u.monteurA, 'Wie lief der Auftrag Badsanierung?');
		expect(mo.karte.fehler).toMatch(/Berechtigung/);
	});

	it('Sicherheit: Antworten prüfen die Rechte selbst; Monteur findet per Sprache keine fremden Aufträge', async () => {
		setzeKiAnbieter(new FakeKi());
		const kM = { betriebId: u.betriebA, benutzerId: u.ids.monteurA };
		// direkt (an rechte.ts vorbei): trotzdem gesperrt, keine Zahlen
		const nk = await _fuerTests.beantworteNachkalkulation(kM, u.monteurA, 'Badsanierung');
		expect(nk.fehler).toMatch(/Berechtigung/);
		expect(JSON.stringify(nk)).not.toMatch(/€/);
		const ve = await _fuerTests.beantworteVerlust(kM, u.monteurA);
		expect(ve.fehler).toMatch(/Berechtigung/);
		expect(ve.antwort).toBeUndefined();
		// „Preise sehen“ ohne „Alle Aufträge ansehen“ reicht nicht
		const nurPreise = nutzerVon(u.ids.monteurA, u.betriebA, ['auftraege.lesen', 'preise.sehen']);
		expect((await _fuerTests.beantworteNachkalkulation(kM, nurPreise, 'Fliesen')).fehler).toMatch(/Berechtigung/);
		// Planer ohne „Alle Aufträge ansehen“ findet per Sprache nur eigene Aufträge (Termin auf fremden Auftrag)
		const planer = nutzerVon(u.ids.monteurA, u.betriebA, ['kunden.lesen', 'auftraege.lesen', 'plantafel.bearbeiten']);
		const fremd = await u.neuerAuftrag('beauftragt', 'Geheimprojekt Zentrale');
		const r = (await antwort(await textPost({ locals: { nutzer: planer }, request: jsonAnfrage('POST', { text: 'Termin bei Geheimprojekt morgen um 8 Uhr' }) } as never))).koerper;
		expect(JSON.stringify(r)).not.toContain(fremd);
		expect(JSON.stringify(r.karte)).not.toMatch(/Geheimprojekt Zentrale –/);
	});
	it('Zwei Personen gleichzeitig: Stunden werden addiert, nicht vereinigt (16 h statt 8 h)', async () => {
		const id = await u.neuerAuftrag('in_arbeit', 'Zwei Monteure gleichzeitig');
		for (const b of [u.ids.monteurA, u.ids.chefA]) {
			await root`insert into app.zeit_eintraege (betrieb_id, benutzer_id, auftrag_id, art, beginn, ende, manuell, korrektur_grund)
				values (${u.betriebA}, ${b}, ${id}, 'arbeit', '2026-10-22T07:00:00+02:00', '2026-10-22T15:00:00+02:00', true, 'Test')`;
		}
		const nk = await nachkalkulationAuftrag(kA(), id, { alle: true, benutzerId: u.ids.chefA });
		expect(nk.ist.stunden).toBe(16);
	});
});
