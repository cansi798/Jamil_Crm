import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { ladeKarte, merkeAdressen, setzeGeokodierer, termineAlsStopps, warteAufGeokodierung } from '../../src/lib/server/karte';
import { legeEinsatzAn } from '../../src/lib/server/plantafel';
import { aendereAuftrag, legeAuftragAn } from '../../src/lib/server/auftraege';
import { ausTagUndUhrzeit, berlinTag } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { load as karteLoad } from '../../src/routes/(app)/karte/+page.server';

/** Auftragskarte (Jamil msg 2602): Koordinaten, Filter, Sicht, Termine heute als Route. */
describe('Auftragskarte', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const alle = () => ({ alle: true, benutzerId: u.ids.chefA });
	const anfragen: string[] = [];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		setzeGeokodierer(async (a) => {
			anfragen.push(a);
			if (a.includes('Nirgendwo')) return null;
			if (a.includes('Kaputt')) throw new Error('Netz weg');
			return { lat: 53.7 + anfragen.length / 1000, lng: 10.0 };
		});
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.geo_adressen`;
		await root`delete from app.einsaetze`;
		anfragen.length = 0;
	});

	it('Adressen werden einmal gesucht und gemerkt; nicht gefunden / Fehler', async () => {
		await merkeAdressen(kA(), ['Lindenweg 3, 22846 Norderstedt', 'Lindenweg 3,  22846 Norderstedt', 'Nirgendwo 1', 'Kaputt 2']);
		await warteAufGeokodierung();
		expect(anfragen).toHaveLength(3);
		const z = await root`select adresse, status, versuche from app.geo_adressen order by adresse`;
		expect(z.map((r) => [r.adresse, r.status])).toEqual([
			['Kaputt 2', 'fehler'],
			['Lindenweg 3, 22846 Norderstedt', 'gefunden'],
			['Nirgendwo 1', 'nicht_gefunden']
		]);
		await merkeAdressen(kA(), ['Lindenweg 3, 22846 Norderstedt', 'Kaputt 2']);
		await warteAufGeokodierung();
		expect(anfragen).toEqual(['Lindenweg 3, 22846 Norderstedt', 'Nirgendwo 1', 'Kaputt 2', 'Kaputt 2']); // Fehler wird erneut versucht
	});

	it('Karte: Aufträge mit Koordinaten (nach Hintergrundsuche); Monteur sieht nur eigene; Filter Status/Mitarbeiter/Zeitraum', async () => {
		const erst = await ladeKarte(kA(), alle(), {});
		expect(erst.auftraege.find((a) => a.id === u.auftragA)).toMatchObject({ adresse: 'Lindenweg 3, 22846 Norderstedt', lat: null });
		await warteAufGeokodierung();
		const k2 = await ladeKarte(kA(), alle(), {});
		expect(k2.auftraege.find((a) => a.id === u.auftragA)!.lat).not.toBeNull();
		expect(k2.offen).toBe(0);
		// Monteur ohne Bezug: nichts
		const monteur = await ladeKarte({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, {});
		expect(monteur.auftraege.map((a) => a.id)).not.toContain(u.auftragA);
		// Termin heute für den Monteur → er sieht den Auftrag; Filter Mitarbeiter + Zeitraum
		const heute = berlinTag(new Date());
		await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: ausTagUndUhrzeit(heute, '08:00').toISOString(), ende: ausTagUndUhrzeit(heute, '12:00').toISOString() });
		const m2 = await ladeKarte({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, {});
		expect(m2.auftraege.map((a) => a.id)).toContain(u.auftragA);
		expect((await ladeKarte(kA(), alle(), { benutzerId: u.ids.monteurA, von: heute, bis: heute })).auftraege.map((a) => a.id)).toEqual([u.auftragA]);
		expect((await ladeKarte(kA(), alle(), { status: ['abgerechnet'] })).auftraege).toEqual([]);
		await expect(ladeKarte(kA(), alle(), { status: ['fertig' as never] })).rejects.toMatchObject({ status: 400 });
	});

	it('Termine heute als Stopps (nach Uhrzeit, je Auftrag einmal)', async () => {
		const heute = berlinTag(new Date());
		const b = await legeAuftragAn(kA(), { titel: 'Zweiter Auftrag', kundeId: u.kundeA, objektId: u.objektA });
		await aendereAuftrag(kA(), b.id, { titel: 'Zweiter Auftrag' });
		const e = (auftragId: string, von: string, bis: string) =>
			legeEinsatzAn(kA(), { auftragId, benutzerId: u.ids.monteurA, beginn: ausTagUndUhrzeit(heute, von).toISOString(), ende: ausTagUndUhrzeit(heute, bis).toISOString() });
		await e(b.id, '13:00', '15:00');
		await e(u.auftragA, '08:00', '10:00');
		await e(u.auftragA, '10:30', '11:30');
		const s = await termineAlsStopps(kA(), alle(), { benutzerId: u.ids.monteurA });
		expect(s.map((x) => [x.titel, x.zeit])).toEqual([
			['Badsanierung', '08:00'],
			['Zweiter Auftrag', '13:00']
		]);
		await root`delete from app.auftraege where id = ${b.id}`;
	});

	it('Seite und Sprache „Route für heute“: eigene Route; Monteur nicht für andere', async () => {
		setzeKiAnbieter(new FakeKi());
		const heute = berlinTag(new Date());
		await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: ausTagUndUhrzeit(heute, '08:00').toISOString(), ende: ausTagUndUhrzeit(heute, '09:00').toISOString() });
		const seite = (await karteLoad({ locals: { nutzer: u.monteurA }, url: new URL('http://localhost/karte?route=heute') } as never)) as any;
		expect(seite.route.stopps.map((s: any) => s.titel)).toEqual(['Badsanierung']);
		const fremd = (await karteLoad({ locals: { nutzer: u.monteurA }, url: new URL(`http://localhost/karte?route=heute&person=${u.ids.chefA}`) } as never)) as any;
		expect(fremd.routeFehler).toMatch(/eigene Route/);
		const r = await antwort(await textPost({ locals: { nutzer: u.monteurA }, request: jsonAnfrage('POST', { text: 'Route für heute' }) } as never));
		expect(r.koerper.vorschlag).toBeNull();
		expect(r.koerper.karte.titel).toBe('Route für heute');
		expect(r.koerper.karte.antwort.abschnitte[0].eintraege[0].titel).toMatch(/^Badsanierung/);
		expect(r.koerper.karte.antwort.abschnitte[1].eintraege[0].link).toBe('/karte?route=heute');
	});
});
