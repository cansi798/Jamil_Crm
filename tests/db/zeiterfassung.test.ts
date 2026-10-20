import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, testPng, type Umgebung } from './hilfe-1c';
import {
	gebeFrei,
	korrigiere,
	laufend,
	listeTaetigkeiten,
	listeZeiten,
	loescheTaetigkeit,
	loescheZeit,
	nachweis,
	stempeln,
	trageNach,
	zeitenZumAuftrag,
	zeitVerlauf,
	zeitZugriff,
	type ZeitZugriff
} from '../../src/lib/server/zeiterfassung';
import { materialHinzufuegen, materialStand, materialWieGeplant, setzeMaterialMenge } from '../../src/lib/server/material';
import { lieferscheinAuslesen } from '../../src/lib/server/ki/lieferschein';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { setzeGeokodierer, warteAufGeokodierung } from '../../src/lib/server/karte';
import { POST as stempelPost } from '../../src/routes/api/zeiten/stempeln/+server';
import { GET as exportGet } from '../../src/routes/(app)/zeiten/export/+server';

/** Zeiterfassung (Wunsch Jamil msgs 2770–2776): Stempeln, Korrekturen, Freigabe, Rechte, RLS, Material, Lieferschein. */
describe('Zeiterfassung', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let monteur: ZeitZugriff;
	let chef: ZeitZugriff;
	let buero: ZeitZugriff;
	const t = (s: string) => new Date(s);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		// Monteur sieht den Auftrag über einen Einsatz
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, '2026-10-20T07:00:00+02:00', '2026-10-20T16:00:00+02:00')`;
		await root`update app.betrieb_profil set strasse = 'Hauptstr. 1', plz = '20095', ort = 'Hamburg' where betrieb_id = ${u.betriebA}`;
		await root`insert into app.betrieb_profil (betrieb_id, firmenname, strasse, plz, ort) values (${u.betriebA}, 'Betrieb A', 'Hauptstr. 1', '20095', 'Hamburg') on conflict do nothing`;
		setzeGeokodierer(async (a) => (a.includes('Hamburg') ? { lat: 53.5511, lng: 9.9937 } : a.includes('Norderstedt') ? { lat: 53.7064, lng: 10.0102 } : null));
		monteur = await zeitZugriff({ nutzer: u.monteurA });
		chef = await zeitZugriff({ nutzer: u.chefA });
		buero = await zeitZugriff({ nutzer: u.bueroA });
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.zeit_eintraege`;
		await root`delete from app.auftrag_material`;
	});

	it('Rechte: Monteur und Chef dürfen; ohne Modul 402; Admin ohne Betrieb 403', async () => {
		expect(monteur.verwalten).toBe(false);
		expect(chef.verwalten).toBe(true);
		expect(buero.verwalten).toBe(true);
		await expect(zeitZugriff({ nutzer: u.chefC })).rejects.toMatchObject({ status: 402 });
		await expect(zeitZugriff({ nutzer: u.admin })).rejects.toMatchObject({ status: 403 });
		await expect(zeitZugriff({ nutzer: null })).rejects.toMatchObject({ status: 401 });
	});

	it('Start → Pause → Weiter → Fertig: Abschnitte, Summen, doppelte Tipps ändern nichts', async () => {
		await stempeln(monteur, 'start', { auftragId: u.auftragA }, t('2026-10-20T07:00:00+02:00'));
		const doppelt = await stempeln(monteur, 'start', { auftragId: u.auftragA }, t('2026-10-20T07:00:30+02:00'));
		expect(doppelt.meldung).toMatch(/bereits/);
		await stempeln(monteur, 'pause', {}, t('2026-10-20T12:00:00+02:00'));
		const p = await stempeln(monteur, 'pause', {}, t('2026-10-20T12:05:00+02:00'));
		expect(p.laufend?.art).toBe('pause');
		await stempeln(monteur, 'weiter', {}, t('2026-10-20T12:30:00+02:00'));
		const f = await stempeln(monteur, 'fertig', {}, t('2026-10-20T16:00:00+02:00'));
		expect(f.laufend).toBeNull();
		const liste = await listeZeiten(monteur, { von: '2026-10-20', bis: '2026-10-20' });
		expect(liste.map((e) => e.art)).toEqual(['arbeit', 'pause', 'arbeit']);
		const n = await nachweis(monteur, { von: '2026-10-20', bis: '2026-10-20' });
		expect(n.summe).toMatchObject({ arbeitMin: 510, pauseMin: 30 });
		await expect(stempeln(monteur, 'fertig', {}, t('2026-10-20T16:10:00+02:00'))).rejects.toMatchObject({ status: 409 });
		await expect(stempeln(monteur, 'weiter', {})).rejects.toMatchObject({ status: 409 });
	});

	it('Nur ein laufender Abschnitt je Person: Start woanders beendet den alten; DB verhindert zwei laufende', async () => {
		const zweiter = await u.neuerAuftrag('beauftragt', 'Zweiter');
		await stempeln(chef, 'start', { auftragId: u.auftragA }, t('2026-10-21T07:00:00+02:00'));
		await stempeln(chef, 'start', { auftragId: zweiter }, t('2026-10-21T09:00:00+02:00'));
		const l = await laufend(chef.k, u.ids.chefA);
		expect(l?.auftragId).toBe(zweiter);
		const alle = await listeZeiten(chef, { benutzerId: u.ids.chefA, von: '2026-10-21', bis: '2026-10-21' });
		expect(alle).toHaveLength(2);
		expect(alle[0].ende).toBe(t('2026-10-21T09:00:00+02:00').toISOString());
		// direkt in der Datenbank: ein zweiter laufender ist unmöglich, Überschneidung auch
		await expect(
			mitBetrieb(chef.k, (tx) => tx`insert into app.zeit_eintraege (betrieb_id, benutzer_id, art, beginn) values (${u.betriebA}, ${u.ids.chefA}, 'arbeit', '2026-10-22T07:00:00+02:00')`)
		).rejects.toMatchObject({ code: expect.stringMatching(/23505|23P01/) });
		await expect(
			mitBetrieb(chef.k, (tx) => tx`insert into app.zeit_eintraege (betrieb_id, benutzer_id, art, beginn, ende) values (${u.betriebA}, ${u.ids.chefA}, 'arbeit', '2026-10-21T08:00:00+02:00', '2026-10-21T08:30:00+02:00')`)
		).rejects.toMatchObject({ code: '23P01' });
	});

	it('Monteur stempelt nur auf sichtbare Aufträge (fremder Auftrag 404, anderer Betrieb 404)', async () => {
		const fremd = await u.neuerAuftrag('beauftragt', 'Nicht meiner');
		await expect(stempeln(monteur, 'start', { auftragId: fremd })).rejects.toMatchObject({ status: 404 });
		await expect(stempeln(monteur, 'start', { auftragId: u.auftragB })).rejects.toMatchObject({ status: 404 });
		await expect(stempeln(monteur, 'start', {})).rejects.toMatchObject({ status: 400 });
	});

	it('Abfahrt → Angekommen: Fahrt mit Start (Firma) und Ziel (Objekt), km aus Luftlinie × 1,3, dann läuft Arbeit', async () => {
		await stempeln(monteur, 'abfahrt', { auftragId: u.auftragA }, t('2026-10-23T07:00:00+02:00'));
		await warteAufGeokodierung();
		const r = await stempeln(monteur, 'angekommen', {}, t('2026-10-23T07:30:00+02:00'));
		expect(r.laufend).toMatchObject({ art: 'arbeit', auftragId: u.auftragA });
		const [fahrt] = (await listeZeiten(monteur, { von: '2026-10-23', bis: '2026-10-23' })).filter((e) => e.art === 'fahrt');
		expect(fahrt).toMatchObject({ startAdresse: 'Hauptstr. 1, 20095 Hamburg', zielAdresse: 'Lindenweg 3, 22846 Norderstedt', kmQuelle: 'luftlinie' });
		expect(fahrt.km).toBeCloseTo(22.5, 0);
		await stempeln(monteur, 'fertig', {}, t('2026-10-23T09:00:00+02:00'));
	});

	it('Nachtragen und Korrigieren nur mit Grund; Protokoll und Verlauf zeigen alt/neu; Freigabe sperrt für den Monteur', async () => {
		await root`delete from app.aenderungen where tabelle = 'zeit_eintraege'`;
		await expect(trageNach(monteur, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '16:30', pauseMin: '30', auftragId: u.auftragA })).rejects.toMatchObject({ status: 400 });
		const e = await trageNach(monteur, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '16:30', pauseMin: '30', auftragId: u.auftragA, grund: 'Handy leer' });
		expect(e).toMatchObject({ manuell: true, korrekturGrund: 'Handy leer', pauseMin: 30 });
		await expect(korrigiere(monteur, e.id, { art: 'arbeit', tag: '2026-10-19', von: '08:15', bis: '16:30', pauseMin: '30', auftragId: u.auftragA })).rejects.toMatchObject({ status: 400 });
		const k = await korrigiere(monteur, e.id, { art: 'arbeit', tag: '2026-10-19', von: '08:15', bis: '16:30', pauseMin: '30', auftragId: u.auftragA, grund: 'zu früh eingetragen' });
		expect(k.beginn).toBe(t('2026-10-19T08:15:00+02:00').toISOString());
		const [prot] = await root`select vorher, nachher from app.aenderungen where tabelle = 'zeit_eintraege' and datensatz_id = ${e.id} and aktion = 'geaendert' order by id desc limit 1`;
		expect(prot.vorher.korrektur_grund).toBe('Handy leer');
		expect(prot.nachher.korrektur_grund).toBe('zu früh eingetragen');
		const verlauf = await zeitVerlauf(chef, u.auftragA);
		expect(verlauf.map((v) => v.zeile.titel)).toEqual([expect.stringMatching(/korrigiert: zu früh eingetragen/), expect.stringMatching(/nachgetragen/)]);
		expect(verlauf[0].zeile.aenderungen[0]).toMatchObject({ feld: 'Beginn' });
		// Freigabe (nur Chef/Büro), danach darf der Monteur nicht mehr ändern, der Chef schon
		await expect(gebeFrei(monteur, u.ids.monteurA, '2026-10-19', '2026-10-25')).rejects.toMatchObject({ status: 403 });
		expect(await gebeFrei(buero, u.ids.monteurA, '2026-10-19', '2026-10-25')).toBe(1);
		await expect(korrigiere(monteur, e.id, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '16:30', grund: 'nochmal' })).rejects.toMatchObject({ status: 409 });
		await expect(loescheZeit(monteur, e.id, 'weg damit')).rejects.toMatchObject({ status: 409 });
		await korrigiere(chef, e.id, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '16:30', pauseMin: '30', auftragId: u.auftragA, grund: 'Chef korrigiert' });
		await loescheZeit(chef, e.id, 'doppelt erfasst');
		const [geloescht] = await root`select vorher from app.aenderungen where tabelle = 'zeit_eintraege' and datensatz_id = ${e.id} and aktion = 'geloescht'`;
		expect(geloescht.vorher.korrektur_grund).toBe('doppelt erfasst');
	});

	it('Sichtbarkeit: Monteur sieht nur eigene Zeiten (auch mit fremder Person im Filter), Chef alle; fremder Betrieb nie (RLS)', async () => {
		await trageNach(chef, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '09:00', grund: 'Test', benutzerId: u.ids.chefA });
		await trageNach(chef, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '10:00', grund: 'Für Ali', benutzerId: u.ids.monteurA });
		await expect(trageNach(monteur, { art: 'arbeit', tag: '2026-10-19', von: '11:00', bis: '12:00', grund: 'für Chef', benutzerId: u.ids.chefA })).rejects.toMatchObject({ status: 403 });
		const eigene = await listeZeiten(monteur, { benutzerId: u.ids.chefA });
		expect(eigene.every((e) => e.benutzerId === u.ids.monteurA)).toBe(true);
		expect(eigene).toHaveLength(1);
		expect(await listeZeiten(chef, {})).toHaveLength(2);
		const n = await nachweis(monteur, { benutzerId: u.ids.chefA, von: '2026-10-19', bis: '2026-10-19' });
		expect(n.person.id).toBe(u.ids.monteurA);
		const chefB = await zeitZugriff({ nutzer: u.chefB });
		expect(await listeZeiten(chefB, {})).toHaveLength(0);
		const sichtbar = await mitBetrieb(chefB.k, (tx) => tx`select count(*)::int as n from app.zeit_eintraege`);
		expect(sichtbar[0].n).toBe(0);
		// Monteur kann fremde Einträge nicht korrigieren (404)
		const fremd = (await listeZeiten(chef, { benutzerId: u.ids.chefA }))[0];
		await expect(korrigiere(monteur, fremd.id, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '09:30', grund: 'Hack' })).rejects.toMatchObject({ status: 404 });
	});

	it('Tätigkeiten ohne Auftrag: Startliste, Start „Lager“, zählt im Nachweis; benutzte Tätigkeit wird nur ausgeblendet', async () => {
		const liste = await listeTaetigkeiten(chef.k);
		expect(liste.map((x) => x.name)).toEqual(['Lager aufräumen', 'Werkstatt', 'Fahrzeugpflege', 'Büro', 'Schulung', 'Material holen']);
		const lager = liste[0];
		await stempeln(monteur, 'start', { taetigkeitId: lager.id }, t('2026-10-24T07:00:00+02:00'));
		const l = await stempeln(monteur, 'pause', {}, t('2026-10-24T09:00:00+02:00'));
		expect(l.laufend).toMatchObject({ art: 'pause', taetigkeitId: lager.id, taetigkeitName: 'Lager aufräumen' });
		await stempeln(monteur, 'fertig', {}, t('2026-10-24T09:15:00+02:00'));
		expect((await nachweis(monteur, { von: '2026-10-24', bis: '2026-10-24' })).summe.arbeitMin).toBe(120);
		expect(await loescheTaetigkeit(chef.k, lager.id)).toBe('ausgeblendet');
		await expect(stempeln(monteur, 'start', { taetigkeitId: lager.id })).rejects.toMatchObject({ status: 404 });
		await expect(stempeln(monteur, 'abfahrt', { taetigkeitId: liste[1].id })).rejects.toMatchObject({ status: 400 });
	});

	it('API /api/zeiten/stempeln: JSON-Pflicht, unbekannte Aktion 400, Start 200', async () => {
		const anfrage = (koerper: unknown, typ = 'application/json') =>
			stempelPost({ locals: { nutzer: u.monteurA }, request: new Request('http://x', { method: 'POST', headers: { 'content-type': typ }, body: JSON.stringify(koerper) }) } as never);
		expect((await anfrage({ aktion: 'start' }, 'text/plain')).status).toBe(415);
		expect((await anfrage({ aktion: 'tanzen' })).status).toBe(400);
		const r = await anfrage({ aktion: 'start', auftragId: u.auftragA });
		expect(r.status).toBe(200);
		expect((await r.json()).laufend.art).toBe('arbeit');
		await stempeln(monteur, 'fertig', {}, new Date(Date.now() + 3_600_000));
		const s = await zeitenZumAuftrag(chef, u.auftragA);
		expect(s.personen.map((p) => p.benutzerId)).toEqual([u.ids.monteurA]);
	});

	it('Export CSV und PDF; Monteur bekommt immer nur sich selbst', async () => {
		await trageNach(chef, { art: 'arbeit', tag: '2026-10-19', von: '08:00', bis: '12:00', grund: '=Formel', benutzerId: u.ids.monteurA, auftragId: u.auftragA });
		const csvAntwort = await exportGet({ locals: { nutzer: u.monteurA }, url: new URL(`http://x/zeiten/export?format=csv&von=2026-10-19&bis=2026-10-25&person=${u.ids.chefA}`) } as never);
		expect(csvAntwort.headers.get('content-type')).toMatch(/text\/csv/);
		const text = await csvAntwort.text();
		expect(text).toContain('2026-10-19;08:00;12:00;Arbeit;');
		expect(text).toContain(";4;");
		expect(text).toContain("'=Formel");
		const pdf = await exportGet({ locals: { nutzer: u.chefA }, url: new URL(`http://x/zeiten/export?format=pdf&von=2026-10-19&bis=2026-10-25&person=${u.ids.monteurA}`) } as never);
		expect(pdf.headers.get('content-type')).toBe('application/pdf');
		expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
	});

	describe('Material', () => {
		let angebotId: string;
		let posMaterial: string;
		beforeAll(async () => {
			await leereAngebote(root);
			const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${u.auftragA}, 'entwurf', '2027-12-31') returning id`;
			angebotId = a.id;
			const [p] = await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent, material_cent)
				values (${u.betriebA}, ${a.id}, 1, 'Fliesen verlegen', 12, 'm²', 6000, 2500) returning id`;
			posMaterial = p.id;
			await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent, material_cent)
				values (${u.betriebA}, ${a.id}, 2, 'Nur Lohn', 2, 'h', 6000, null)`;
		});

		it('ohne angenommenes Angebot: kein Plan, „wie geplant“ 409', async () => {
			const s = await materialStand(monteur, u.auftragA);
			expect(s.ohneAngebot).toBe(true);
			await expect(materialWieGeplant(monteur, u.auftragA)).rejects.toMatchObject({ status: 409 });
		});

		it('„wie geplant“ übernimmt Mengen; mehr/weniger je Zeile; Zusatz; Preise nur mit „Preise sehen“', async () => {
			await root`update app.angebote set status = 'versendet' where id = ${angebotId}`;
			await root`update app.angebote set status = 'angenommen' where id = ${angebotId}`;
			let s = await materialStand(monteur, u.auftragA);
			expect(s.zeilen).toEqual([{ id: null, positionId: posMaterial, bezeichnung: 'Fliesen verlegen', einheit: 'm²', mengePlan: 12, menge: null, quelle: 'plan' }]);
			expect(await materialWieGeplant(monteur, u.auftragA)).toBe(1);
			expect(await materialWieGeplant(monteur, u.auftragA)).toBe(0);
			await setzeMaterialMenge(monteur, u.auftragA, { positionId: posMaterial, menge: '13,5', preis: '99' });
			await materialHinzufuegen(monteur, u.auftragA, [{ bezeichnung: 'Silikon', einheit: 'Stk', menge: '2', preis: '5' }]);
			s = await materialStand(monteur, u.auftragA);
			expect(s.zeilen.map((z) => [z.bezeichnung, z.menge])).toEqual([['Fliesen verlegen', 13.5], ['Silikon', 2]]);
			expect(JSON.stringify(s)).not.toMatch(/Cent/);
			const c = await materialStand(chef, u.auftragA);
			expect(c.zeilen[0]).toMatchObject({ planCent: 2500, preisCent: null });
			expect(c.zeilen[1]).toMatchObject({ preisCent: null });
			// Preis im Protokoll nie
			const prot = await root`select nachher from app.aenderungen where tabelle = 'auftrag_material'`;
			expect(prot.every((p) => !('preis_cent' in (p.nachher ?? {})))).toBe(true);
		});

		it('Lieferschein: nur das Foto geht an die KI, Zustimmung Pflicht, Positionen zum Prüfen', async () => {
			const ki = new FakeKi();
			setzeKiAnbieter(ki);
			const foto = testPng(8, 8);
			await expect(lieferscheinAuslesen(monteur, u.auftragA, foto, false)).rejects.toMatchObject({ status: 400 });
			await expect(lieferscheinAuslesen(monteur, u.auftragA, new Uint8Array([1, 2, 3]), true)).rejects.toMatchObject({ status: 400 });
			const pos = await lieferscheinAuslesen(monteur, u.auftragA, foto, true);
			expect(pos[0]).toMatchObject({ bezeichnung: 'Fliesenkleber flex 25 kg', menge: 4, einheit: 'Sack', einzelpreisCent: 1890 });
			const anfrage = ki.letzteBildAnfrage!;
			expect(anfrage.bilder).toHaveLength(1);
			expect(anfrage.text + anfrage.system).not.toMatch(/Müller|Lindenweg|Norderstedt|Badsanierung/);
			ki.bildAntworten.lieferschein_positionen = { positionen: [] };
			await expect(lieferscheinAuslesen(monteur, u.auftragA, foto, true)).rejects.toMatchObject({ status: 422 });
		});
	});
});
