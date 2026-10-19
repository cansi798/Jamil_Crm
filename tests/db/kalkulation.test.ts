import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	aendereKalkMitarbeiter,
	kalkulationZugriff,
	ladeKalkulation,
	legeKalkMitarbeiterAn,
	loescheKalkMitarbeiter,
	speichereBetriebswerte
} from '../../src/lib/server/kalkulation';
import { berechneMitarbeiter } from '../../src/lib/kalkulation';
import { actions as seitenAktionen, load as seitenLoad } from '../../src/routes/(app)/kalkulation/+page.server';
import { load as katalogLoad } from '../../src/routes/(app)/katalog/+page.server';
import { baueUmgebung, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026). */
describe('Kalkulation', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const FIRMA = {
		jahr: '2026',
		gemeinkosten: '60.000,00',
		anzahlProduktiv: '4',
		feiertage: '10',
		pufferArt: 'prozent',
		pufferWert: '15',
		gewinnProzent: '10',
		risikoProzent: '5',
		aktuellerSatz: '55,00'
	};
	const ALI = {
		name: 'Ali Monteur',
		brutto: '42.000',
		agArt: 'prozent',
		agProzent: '21',
		wochenstunden: '40',
		urlaubstage: '30',
		krankheitstage: '10'
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.kalkulation_mitarbeiter`;
		await root`delete from app.kalkulation_betrieb`;
	});

	it('Rechte: nur „Preise sehen“ + „Einstellungen“ (Chef); Büro, Monteur 403; ohne Katalog-Modul 402', async () => {
		await expect(kalkulationZugriff({ nutzer: u.chefA })).resolves.toBeUndefined();
		await expect(kalkulationZugriff({ nutzer: u.bueroA })).rejects.toMatchObject({ status: 403 });
		await expect(kalkulationZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		await expect(kalkulationZugriff({ nutzer: u.chefC })).rejects.toMatchObject({ status: 402 });
		await expect(seitenLoad({ locals: { nutzer: u.bueroA } } as never)).rejects.toMatchObject({ status: 403 });
	});

	it('ohne gespeicherte Werte: Standardwerte (aktuelles Jahr, 10 Feiertage), keine Mitarbeiter', async () => {
		const d = await ladeKalkulation(kA());
		expect(d.betrieb).toMatchObject({ jahr: new Date().getFullYear(), gemeinkostenCent: 0, anzahlProduktiv: 0, feiertage: 10, pufferArt: 'prozent' });
		expect(d.mitarbeiter).toEqual([]);
		expect(d.uebersicht.empfohlenCent).toBeNull();
	});

	it('Firmenwerte und Mitarbeiter speichern (deutsche Zahlen); Übersicht = Rechnung aus src/lib/kalkulation.ts', async () => {
		await speichereBetriebswerte(kA(), FIRMA);
		const m = await legeKalkMitarbeiterAn(kA(), { ...ALI, benutzerId: u.ids.monteurA });
		expect(m).toMatchObject({ name: 'Ali Monteur', benutzerId: u.ids.monteurA, werte: { bruttoCent: 4_200_000, agProzent: 21, wochenstunden: 40 } });
		const d = await ladeKalkulation(kA());
		expect(d.betrieb).toMatchObject({ gemeinkostenCent: 6_000_000, anzahlProduktiv: 4, pufferWert: 15, aktuellerSatzCent: 5500 });
		const erwartet = berechneMitarbeiter(d.betrieb, d.mitarbeiter[0].werte);
		expect(d.uebersicht.mitarbeiter[0].ergebnis).toEqual(erwartet);
		expect(erwartet).toMatchObject({ fakturierbareStunden: 1434.8, kostendeckendCent: 4587, empfohlenCent: 5276, vergleich: 'mit_gewinn' });
	});

	it('ändern (AG in Euro) und löschen; Betrieb B sieht nichts; fremd/unbekannt → 404', async () => {
		const m = await legeKalkMitarbeiterAn(kA(), ALI);
		const n = await aendereKalkMitarbeiter(kA(), m.id, { ...ALI, agArt: 'euro', agEuro: '9.000', agProzent: '' });
		expect(n.werte).toMatchObject({ agArt: 'euro', agEuroCent: 900_000, agProzent: null });
		expect((await ladeKalkulation(kB())).mitarbeiter).toEqual([]);
		await expect(aendereKalkMitarbeiter(kB(), m.id, ALI)).rejects.toMatchObject({ status: 404 });
		await expect(loescheKalkMitarbeiter(kB(), m.id)).rejects.toMatchObject({ status: 404 });
		await expect(loescheKalkMitarbeiter(kA(), UNBEKANNT)).rejects.toMatchObject({ status: 404 });
		await loescheKalkMitarbeiter(kA(), m.id);
		expect((await ladeKalkulation(kA())).mitarbeiter).toEqual([]);
	});

	it('Prüfung → 400 mit Feldnamen', async () => {
		const falsch = async (e: Record<string, string>, muster: RegExp) =>
			expect(legeKalkMitarbeiterAn(kA(), { ...ALI, ...e })).rejects.toThrow(muster);
		await falsch({ name: ' ' }, /Name/);
		await falsch({ brutto: '-1' }, /Bruttojahresgehalt/);
		await falsch({ agProzent: '120' }, /Arbeitgeber-Anteil/);
		await falsch({ agArt: 'euro', agEuro: '' }, /Arbeitgeber-Anteil/);
		await falsch({ wochenstunden: '0' }, /Wochenarbeitszeit/);
		await falsch({ urlaubstage: 'viel' }, /Urlaubstage/);
		await falsch({ benutzerId: u.ids.chefB }, /Benutzer/);
		await expect(speichereBetriebswerte(kA(), { ...FIRMA, pufferWert: '150' })).rejects.toThrow(/Puffer/);
		await expect(speichereBetriebswerte(kA(), { ...FIRMA, jahr: '1999' })).rejects.toThrow(/Jahr/);
		await expect(speichereBetriebswerte(kA(), { ...FIRMA, pufferArt: 'tage' })).rejects.toThrow(/Puffer/);
		// Puffer in Stunden darf über 100 liegen
		await expect(speichereBetriebswerte(kA(), { ...FIRMA, pufferArt: 'stunden', pufferWert: '160' })).resolves.toBeDefined();
	});

	it('Seite: Aktionen firma, mitarbeiterNeu, mitarbeiterAendern, mitarbeiterLoeschen (Chef); Büro 403', async () => {
		const req = (felder: Record<string, string>) =>
			({ locals: { nutzer: u.chefA }, request: new Request('http://localhost/kalkulation', { method: 'POST', body: new URLSearchParams(felder) }) }) as never;
		expect(await seitenAktionen.firma(req(FIRMA))).toBeUndefined();
		expect(await seitenAktionen.mitarbeiterNeu(req(ALI))).toBeUndefined();
		const d = (await seitenLoad({ locals: { nutzer: u.chefA } } as never)) as any;
		expect(d.uebersicht.mitarbeiter[0].ergebnis.empfohlenCent).toBe(5276);
		expect(d.benutzer.map((b: any) => b.name)).toContain('Ali Monteur');
		const id = d.mitarbeiter[0].id;
		expect(await seitenAktionen.mitarbeiterAendern(req({ ...ALI, id, wochenstunden: '20' }))).toBeUndefined();
		expect((await ladeKalkulation(kA())).mitarbeiter[0].werte.wochenstunden).toBe(20);
		const fehler = (await seitenAktionen.mitarbeiterNeu(req({ ...ALI, brutto: 'abc' }))) as any;
		expect(fehler.status).toBe(400);
		expect(fehler.data.werte).toMatchObject({ brutto: 'abc' });
		const buero = { locals: { nutzer: u.bueroA }, request: new Request('http://localhost/k', { method: 'POST', body: new URLSearchParams({ id }) }) } as never;
		expect(((await seitenAktionen.mitarbeiterLoeschen(buero)) as any).status).toBe(403);
		expect(await seitenAktionen.mitarbeiterLoeschen(req({ id }))).toBeUndefined();
	});

	it('Katalog zeigt den empfohlenen Firmenschnitt als Hinweis – nur Chef (Kalkulation sichtbar), Büro nicht', async () => {
		await speichereBetriebswerte(kA(), FIRMA);
		await legeKalkMitarbeiterAn(kA(), ALI);
		const url = new URL('http://localhost/katalog');
		const chef = (await katalogLoad({ locals: { nutzer: u.chefA }, url } as never)) as any;
		expect(chef.stundensatz).toEqual({ empfohlenCent: 5276, kostendeckendCent: 4587 });
		const buero = (await katalogLoad({ locals: { nutzer: u.bueroA }, url } as never)) as any;
		expect(buero.stundensatz).toBeNull();
	});
});
