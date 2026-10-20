import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { speichereKolonne } from '../../src/lib/server/kolonnen';
import { legeEinsatzAn, legeGruppeAn } from '../../src/lib/server/plantafel';
import { termineAus } from '../../src/lib/kalender';
import { load as seitenLoad } from '../../src/routes/(app)/plantafel/+page.server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

/** Plantafel als Kalender (Jamil msg 2676): Monat/Woche/Tag/Team, Filter, Sprache „Kalender von Kolonne 3 im November“. */
describe('Plantafel-Kalender', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const laden = (q: string, nutzer: unknown = u.chefA) =>
		seitenLoad({ locals: { nutzer }, url: new URL(`http://x/plantafel${q}`) } as never) as Promise<Record<string, any>>;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.einsaetze`;
		await root`delete from app.kolonnen`;
	});

	it('Ansichten: Monat (Standard, 6 Wochen, auch Termine aus Nachbarmonaten), Woche, Tag, Team; Farbe Status', async () => {
		const ko = await speichereKolonne(kA(), null, { name: 'Kolonne 3', mitglieder: [u.ids.monteurA, u.ids.bueroA] });
		await legeGruppeAn(kA(), { auftragId: u.auftragA, kolonneId: ko.id, vonTag: '2026-11-16', bisTag: '2026-11-18' });
		await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.chefA, beginn: '2026-10-27T07:00:00Z', ende: '2026-10-27T09:00:00Z' });
		await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.chefA, beginn: '2026-12-15T07:00:00Z', ende: '2026-12-15T09:00:00Z' });

		const m = await laden('?tag=2026-11-10');
		expect(m).toMatchObject({ ansicht: 'monat', monat: '2026-11', farbe: 'person' });
		expect(m.wochen).toHaveLength(6);
		const t = termineAus(m.woche.einsaetze);
		expect(t.map((x) => [x.vonTag, x.bisTag, x.personen.length])).toEqual([
			['2026-10-27', '2026-10-27', 1], // sichtbare Vorwoche im Raster
			['2026-11-16', '2026-11-18', 2]
		]);
		expect(m.woche.einsaetze[0].auftragStatus).toBe('anfrage');

		const w = await laden('?ansicht=woche&tag=2026-11-17&farbe=status');
		expect(w).toMatchObject({ ansicht: 'woche', farbe: 'status' });
		expect(w.wochen).toEqual([['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']]);
		expect(w.woche.einsaetze).toHaveLength(6);
		const tag = await laden('?ansicht=tag&tag=2026-11-17');
		expect(tag.woche.tage).toEqual(['2026-11-17']);
		expect(tag.woche.einsaetze).toHaveLength(2);
		const team = await laden('?ansicht=team&tag=2026-11-17');
		expect(team.woche.tage).toHaveLength(7);
		expect((await laden('?ansicht=quatsch')).ansicht).toBe('monat');
	});

	it('Filter: Kolonne bzw. Mitarbeiter (mehrfach) aus der Adresse; Monteur 403', async () => {
		const ko = await speichereKolonne(kA(), null, { name: 'Kolonne 3', mitglieder: [u.ids.monteurA] });
		await legeGruppeAn(kA(), { auftragId: u.auftragA, kolonneId: ko.id, vonTag: '2026-11-16', bisTag: '2026-11-17' });
		await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.chefA, beginn: '2026-11-19T07:00:00Z', ende: '2026-11-19T09:00:00Z' });
		const nurKo = await laden(`?tag=2026-11-01&ko=${ko.id}`);
		expect(termineAus(nurKo.woche.einsaetze).map((x) => x.kolonne?.name)).toEqual(['Kolonne 3']);
		const zwei = await laden(`?tag=2026-11-01&ko=${ko.id}&ma=${u.ids.chefA}`);
		expect(termineAus(zwei.woche.einsaetze)).toHaveLength(2);
		expect(zwei.filter).toEqual({ ma: [u.ids.chefA], ko: [ko.id] });
		await expect(laden('', u.monteurA)).rejects.toMatchObject({ status: 403 });
	});

	it('Sprache: „Zeig mir den Kalender von Kolonne 3 im November“ → Link zur gefilterten Monatsansicht (öffnet sich)', async () => {
		setzeKiAnbieter(new FakeKi());
		const ko = await speichereKolonne(kA(), null, { name: 'Kolonne 3', mitglieder: [u.ids.monteurA] });
		const frage = async (text: string, nutzer: unknown = u.chefA) =>
			(await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const r = await frage('Zeig mir den Kalender von Kolonne 3 im November');
		expect(r.vorschlag).toBeNull();
		expect(r.karte.aktion).toBe('kalender_zeigen');
		expect(r.karte.titel).toMatch(/^Kalender Kolonne 3 · November \d{4}$/);
		expect(r.karte.antwort.oeffnen).toMatch(new RegExp(`^/plantafel\\?tag=\\d{4}-11-(01|\\d\\d)&ko=${ko.id}$`));
		const ali = await frage('Kalender von Ali nächste Woche');
		expect(ali.karte.antwort.oeffnen).toMatch(new RegExp(`^/plantafel\\?ansicht=woche&tag=.*&ma=${u.ids.monteurA}$`));
		expect((await frage('Zeig mir den Kalender von Kolonne 99')).karte.fehler).toMatch(/nicht gefunden/);
		const demo = await speichereKolonne(kA(), null, { name: 'Kolonne B (Demo)', mitglieder: [u.ids.monteurA] });
		expect((await frage('Zeig mir den Kalender von Kolonne B im Dezember')).karte.antwort.oeffnen).toContain(`ko=${demo.id}`);
		expect((await frage('Zeig mir den Kalender', u.monteurA)).karte.fehler).toMatch(/Berechtigung/);
	});
});
