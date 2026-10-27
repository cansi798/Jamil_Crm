import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { ladeFunktionenStand, setzeSchalter } from '../../src/lib/server/funktionen';
import { speichereBestandskunden, ladeBestandskunden } from '../../src/lib/server/kundenportal';
import { actions, load } from '../../src/routes/(app)/einstellungen/funktionen/+page.server';
import { load as neuLoad } from '../../src/routes/(app)/neu/+page.server';

/** Funktionen & Automatisierungen und Was ist neu (Jamil, Talk msg 3423). */
describe('Funktionen & Automatisierungen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.portal_einstellungen`;
		await root`delete from app.nachfass_stufen`;
	});

	it('ohne gespeicherte Werte: Schalter an, keine Stufen, nichts online buchbar', async () => {
		const s = await ladeFunktionenStand(kA());
		expect(s).toMatchObject({ ab_automatisch: true, bestand_aktiv: true, nachfassen: { aktiv: 0, gesamt: 0 }, portalLinks: { kunden: 0 } });
	});

	it('Schalter legt genau einen Wert um, lässt die übrigen unberührt und wirkt nur im eigenen Betrieb', async () => {
		await speichereBestandskunden(kA(), { aktiv: true, titel: 'Eigene Überschrift', text: 'T', leistungen: [{ titel: 'X', symbol: 'haus' }], knoepfe: [{ text: 'Los', url: 'https://beispiel.test/a' }] });
		await setzeSchalter(kA(), 'bestand_aktiv', 'aus');
		let s = await ladeFunktionenStand(kA());
		expect(s.bestand_aktiv).toBe(false);
		expect(s.ab_automatisch).toBe(true);
		// Inhalt der Karte bleibt erhalten
		expect(await ladeBestandskunden(kA())).toMatchObject({ aktiv: false, titel: 'Eigene Überschrift', knoepfe: [{ text: 'Los', url: 'https://beispiel.test/a' }] });
		await setzeSchalter(kA(), 'ab_automatisch', 'aus');
		s = await ladeFunktionenStand(kA());
		expect(s).toMatchObject({ ab_automatisch: false, bestand_aktiv: false });
		// Betrieb B unverändert
		expect(await ladeFunktionenStand(kB())).toMatchObject({ ab_automatisch: true, bestand_aktiv: true });
		await setzeSchalter(kA(), 'bestand_aktiv', 'an');
		expect((await ladeFunktionenStand(kA())).bestand_aktiv).toBe(true);
	});

	it('weist unbekannte Schalter und Werte ab', async () => {
		await expect(setzeSchalter(kA(), 'agb_url', 'an')).rejects.toMatchObject({ status: 400 });
		await expect(setzeSchalter(kA(), 'ab_automatisch', 'vielleicht')).rejects.toMatchObject({ status: 400 });
		await expect(setzeSchalter(kA(), "ab_automatisch'; drop table app.kunden;--", 'an')).rejects.toMatchObject({ status: 400 });
	});

	it('zählt Nachfass-Stufen (aktiv/gesamt)', async () => {
		await root`insert into app.nachfass_stufen (betrieb_id, art, pos, tage, todo, mail, aktiv) values (${u.betriebA}, 'angebot', 1, 7, true, false, true), (${u.betriebA}, 'angebot', 2, 14, true, false, false)`;
		expect((await ladeFunktionenStand(kA())).nachfassen).toEqual({ aktiv: 1, gesamt: 2 });
		expect((await ladeFunktionenStand(kB())).nachfassen).toEqual({ aktiv: 0, gesamt: 0 });
	});

	it('Seite: Chef sieht den Kundenweg, Büro und Monteur nicht (Recht „Einstellungen“); Aktion prüft das Recht', async () => {
		const d = (await load({ locals: { nutzer: u.chefA } } as never)) as { gruppen: { schritt: { id: string }; funktionen: { id: string }[] }[] };
		expect(d.gruppen.map((g) => g.schritt.id)).toEqual(['anfrage', 'angebot', 'auftrag', 'abschluss', 'danach']);
		expect(d.gruppen.flatMap((g) => g.funktionen.map((f) => f.id))).toContain('ab-automatisch');
		await expect(load({ locals: { nutzer: u.bueroA } } as never)).rejects.toMatchObject({ status: 403 });
		await expect(load({ locals: { nutzer: u.monteurA } } as never)).rejects.toMatchObject({ status: 403 });
		const f = new FormData();
		f.set('name', 'ab_automatisch');
		f.set('wert', 'aus');
		const post = (nutzer: unknown) => actions.schalten({ locals: { nutzer }, request: new Request('http://t/', { method: 'POST', body: f }) } as never) as Promise<{ status?: number; gespeichert?: boolean }>;
		expect((await post(u.bueroA)).status).toBe(403);
		expect((await ladeFunktionenStand(kA())).ab_automatisch).toBe(true);
		expect(await post(u.chefA)).toMatchObject({ gespeichert: true });
		expect((await ladeFunktionenStand(kA())).ab_automatisch).toBe(false);
	});

	it('Was ist neu: für jeden Benutzer des Betriebs, Einträge nach Recht gefiltert', async () => {
		const chef = ((await neuLoad({ locals: { nutzer: u.chefA } } as never)) as { eintraege: { titel: string }[] }).eintraege.map((e) => e.titel);
		const monteur = ((await neuLoad({ locals: { nutzer: u.monteurA } } as never)) as { eintraege: { titel: string }[] }).eintraege.map((e) => e.titel);
		expect(chef).toContain('Funktionen & Automatisierungen');
		expect(monteur).not.toContain('Funktionen & Automatisierungen');
		expect(monteur.length).toBeGreaterThan(0);
	});
});
