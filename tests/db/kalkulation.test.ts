import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	aendereKalkMitarbeiter,
	aendereKosten,
	kalkulationZugriff,
	ladeBeispiel,
	ladeFirmensatz,
	ladeKalkulation,
	legeKalkMitarbeiterAn,
	legeKostenAn,
	loescheKalkMitarbeiter,
	loescheKosten,
	speichereBetriebswerte
} from '../../src/lib/server/kalkulation';
import { actions as seitenAktionen, load as seitenLoad } from '../../src/routes/(app)/kalkulation/+page.server';
import { load as katalogLoad } from '../../src/routes/(app)/katalog/+page.server';
import { legePositionAn } from '../../src/lib/server/katalog';
import { baueUmgebung, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** Kalkulation v2 (Wünsche Jamil, msgs 2515/2516): Kostenzeilen, Mitarbeiter, Kosten- und Verrechnungssatz. */
describe('Kalkulation v2', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const FIRMA = { standardTage: '210', standardStundenTag: '7', risikoProzent: '5', gewinnProzent: '15', aktuellerSatz: '55,00' };
	const MIETE = { name: 'Miete', kategorie: 'fixkosten', betrag: '1.000,00', intervall: 'monatlich' };
	const ALI = { name: 'Ali Monteur', brutto: '36.000', agArt: 'prozent', agProzent: '20' };

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.kalkulation_kosten`;
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

	it('ohne Werte: Standard 210 Tage × 7 h, keine Zeilen, kein Satz', async () => {
		const d = await ladeKalkulation(kA());
		expect(d.betrieb).toMatchObject({ standardTage: 210, standardStundenTag: 7 });
		expect(d.kosten).toEqual([]);
		expect(d.uebersicht.empfohlenCent).toBeNull();
	});

	it('Kostenzeilen + Mitarbeiter → Kosten-Stundensatz und Verrechnungssatz (deutsche Zahlen)', async () => {
		await speichereBetriebswerte(kA(), FIRMA);
		await legeKostenAn(kA(), MIETE); // 12.000 €/Jahr
		await legeKostenAn(kA(), { name: 'Transporter', kategorie: 'fahrzeug', betrag: '36.000', intervall: 'einmalig', abschreibungMonate: '72' }); // 6.000 €/Jahr
		const m = await legeKalkMitarbeiterAn(kA(), { ...ALI, benutzerId: u.ids.monteurA }); // 36.000 + 20 % = 43.200 €
		await legeKalkMitarbeiterAn(kA(), { name: 'Teilzeit', brutto: '', agArt: 'euro', agEuro: '', tageJahr: '100', stundenTag: '4,5' });
		expect(m).toMatchObject({ benutzerId: u.ids.monteurA, werte: { bruttoCent: 3_600_000, agProzent: 20, tageJahr: null } });
		const d = await ladeKalkulation(kA());
		expect(d.uebersicht).toMatchObject({
			kostenzeilenCent: 1_800_000,
			personalkostenCent: 4_320_000,
			gesamtkostenCent: 6_120_000,
			produktiveStunden: 1920, // 210 × 7 + 100 × 4,5
			kostendeckendCent: 3188, // 61.200 € / 1.920 h
			empfohlenCent: 3825, // + 20 %
			vergleich: 'mit_gewinn'
		});
		expect(await ladeFirmensatz(kA())).toEqual({ kostendeckendCent: 3188, empfohlenCent: 3825 });
	});

	it('Kostenzeile ändern (inaktiv), löschen; Betrieb B sieht nichts; fremd/unbekannt → 404; Prüfung → 400', async () => {
		const z = await legeKostenAn(kA(), MIETE);
		expect((await aendereKosten(kA(), z.id, { ...MIETE, aktiv: 'false' })).aktiv).toBe(false);
		expect((await ladeKalkulation(kA())).uebersicht.kostenzeilenCent).toBe(0);
		expect((await ladeKalkulation(kB())).kosten).toEqual([]);
		await expect(aendereKosten(kB(), z.id, MIETE)).rejects.toMatchObject({ status: 404 });
		await expect(loescheKosten(kB(), z.id)).rejects.toMatchObject({ status: 404 });
		await expect(loescheKosten(kA(), UNBEKANNT)).rejects.toMatchObject({ status: 404 });
		await expect(legeKostenAn(kA(), { ...MIETE, name: ' ' })).rejects.toThrow(/Bezeichnung/);
		await expect(legeKostenAn(kA(), { ...MIETE, kategorie: 'luxus' })).rejects.toThrow(/Kategorie/);
		await expect(legeKostenAn(kA(), { ...MIETE, intervall: 'woechentlich' })).rejects.toThrow(/Intervall/);
		await expect(legeKostenAn(kA(), { ...MIETE, intervall: 'einmalig' })).rejects.toThrow(/Abschreibung/);
		await expect(legeKostenAn(kA(), { ...MIETE, betrag: '-5' })).rejects.toThrow(/Betrag/);
		await expect(legeKalkMitarbeiterAn(kA(), { ...ALI, stundenTag: '30' })).rejects.toThrow(/Stunden pro Tag/);
		await expect(legeKalkMitarbeiterAn(kA(), { ...ALI, benutzerId: u.ids.chefB })).rejects.toThrow(/Benutzer/);
		await expect(speichereBetriebswerte(kA(), { ...FIRMA, standardTage: '400' })).rejects.toThrow(/Tage/);
		await loescheKosten(kA(), z.id);
		const m = await legeKalkMitarbeiterAn(kA(), ALI);
		expect((await aendereKalkMitarbeiter(kA(), m.id, { ...ALI, agArt: 'euro', agEuro: '9.000' })).werte).toMatchObject({ agEuroCent: 900_000 });
		await loescheKalkMitarbeiter(kA(), m.id);
	});

	it('Beispiel aus Jamils Excel: 13 Zeilen, 3 Mitarbeiter, 4.410 h; zweimal laden → keine Doppelten; v1-Summe wird inaktiv', async () => {
		await root`
			insert into app.kalkulation_kosten (betrieb_id, name, kategorie, betrag_cent, intervall)
			values (${u.betriebA}, 'Gemeinkosten (Summe aus der bisherigen Kalkulation)', 'sonstiges', 21600000, 'jaehrlich')`;
		const d = await ladeBeispiel(kA());
		expect(d.kosten).toHaveLength(14);
		expect(d.kosten.find((z) => z.name.startsWith('Gemeinkosten'))!.aktiv).toBe(false);
		expect(d.mitarbeiter.map((m) => m.name)).toEqual(['Mitarbeiter 1', 'Mitarbeiter 2', 'Mitarbeiter 3']);
		expect(d.uebersicht).toMatchObject({ produktiveStunden: 4410, monatskostenCent: 754412, kostendeckendCent: 2053 });
		expect((await ladeBeispiel(kA())).kosten).toHaveLength(14);
	});

	it('Seite: Aktionen (Chef); Büro 403; Fehler behalten die Eingaben', async () => {
		const req = (felder: Record<string, string>, nutzer = u.chefA) =>
			({ locals: { nutzer }, request: new Request('http://localhost/kalkulation', { method: 'POST', body: new URLSearchParams(felder) }) }) as never;
		expect(await seitenAktionen.firma(req(FIRMA))).toBeUndefined();
		expect(await seitenAktionen.kostenNeu(req(MIETE))).toBeUndefined();
		expect(await seitenAktionen.mitarbeiterNeu(req(ALI))).toBeUndefined();
		const d = (await seitenLoad({ locals: { nutzer: u.chefA } } as never)) as any;
		expect(d.uebersicht.empfohlenCent).toBe(Math.round(((1_200_000 + 4_320_000) / 1470) * 1.2));
		const zid = d.kosten[0].id;
		// Häkchen „aktiv“ nicht gesetzt → versteckter Wert „false“
		expect(await seitenAktionen.kostenAendern(req({ ...MIETE, id: zid, aktiv: 'false' }))).toBeUndefined();
		expect((await ladeKalkulation(kA())).kosten[0].aktiv).toBe(false);
		const fehler = (await seitenAktionen.kostenNeu(req({ ...MIETE, betrag: 'abc' }))) as any;
		expect(fehler.status).toBe(400);
		expect(fehler.data.werte).toMatchObject({ betrag: 'abc' });
		expect(((await seitenAktionen.kostenLoeschen(req({ id: zid }, u.bueroA))) as any).status).toBe(403);
		expect(await seitenAktionen.kostenLoeschen(req({ id: zid }))).toBeUndefined();
		expect(await seitenAktionen.beispiel(req({}))).toBeUndefined();
		expect((await ladeKalkulation(kA())).kosten.length).toBe(13);
	});

	it('Katalog zeigt den Verrechnungssatz als Hinweis – nur Chef, Büro nicht', async () => {
		await speichereBetriebswerte(kA(), FIRMA);
		await legeKostenAn(kA(), MIETE);
		await legeKalkMitarbeiterAn(kA(), ALI);
		const url = new URL('http://localhost/katalog');
		const chef = (await katalogLoad({ locals: { nutzer: u.chefA }, url } as never)) as any;
		expect(chef.stundensatz).toMatchObject({ kostendeckendCent: 3755, empfohlenCent: 4506 });
		const buero = (await katalogLoad({ locals: { nutzer: u.bueroA }, url } as never)) as any;
		expect(buero.stundensatz).toBeNull();
	});

	it('Katalog: Arbeitszeit je Einheit; Liste „unter kostendeckend“ (Lohn < Minuten × Kosten-Stundensatz)', async () => {
		await speichereBetriebswerte(kA(), FIRMA);
		await legeKostenAn(kA(), MIETE);
		await legeKalkMitarbeiterAn(kA(), ALI); // kostendeckend 37,55 €/h
		const ids: string[] = [];
		for (const [bezeichnung, einheit, arbeitMinuten, lohn] of [
			['Fliesen verlegen', 'm²', '60', '30,00'], // 37,55 nötig → unter
			['Silikonfuge', 'm', '6', '5,00'], // 3,76 nötig → ok
			['Regiestunde', 'h', '', '35,00'], // h = 60 Min. → unter
			['Ohne Zeit', 'Stk', '', '1,00'] // unbekannt
		]) {
			ids.push((await legePositionAn(kA(), { bezeichnung, einheit, arbeitMinuten, lohn, material: '0' }, true)).id);
		}
		const url = new URL('http://localhost/katalog');
		const chef = (await katalogLoad({ locals: { nutzer: u.chefA }, url } as never)) as any;
		expect(chef.unterKosten.map((p: any) => [p.bezeichnung, p.mindestCent])).toEqual([
			['Fliesen verlegen', 3755],
			['Regiestunde', 3755]
		]);
		expect(chef.ohneArbeitszeit).toBe(1);
		expect(chef.positionen.find((p: any) => p.bezeichnung === 'Silikonfuge').arbeitMinuten).toBe(6);
		await expect(legePositionAn(kA(), { bezeichnung: 'x', einheit: 'm', arbeitMinuten: 'lang' }, true)).rejects.toThrow(/Arbeitszeit/);
		await root`delete from app.katalog_positionen where id = any(${ids}::uuid[])`;
	});
});
