import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { legeKalkMitarbeiterAn, legeKostenAn } from '../../src/lib/server/kalkulation';
import { ladeAuslastung, pruefeMonat } from '../../src/lib/server/auslastung';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { load as startLoad } from '../../src/routes/(app)/+page.server';
import { ausTagUndUhrzeit, berlinTag } from '../../src/lib/zeit';
import { load as seitenLoad } from '../../src/routes/(app)/plantafel/auslastung/+page.server';

/** Auslastung je Mitarbeiter und Monat + Break-even (Wunsch Jamil msg 2476, Punkte 4 und 5). */
describe('Auslastung und Break-even', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const MONAT = '2026-11';

	async function einsatz(betrieb: string, auftrag: string, benutzer: string, beginn: string, ende: string) {
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${betrieb}, ${auftrag}, ${benutzer}, ${beginn}::timestamptz, ${ende}::timestamptz)`;
	}
	async function angebot(auftrag: string, status: string, nettoCent: number, materialCent: number | null) {
		const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis)
			values (${u.betriebA}, ${auftrag}, 'entwurf', '2027-12-31') returning id`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent, material_cent)
			values (${u.betriebA}, ${a.id}, 1, 'Leistung', 1, 'psch', ${nettoCent}, ${materialCent})`;
		if (status !== 'entwurf') {
			await root`update app.angebote set status = 'versendet' where id = ${a.id}`;
			if (status !== 'versendet') await root`update app.angebote set status = ${status} where id = ${a.id}`;
		}
	}

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
		await root`delete from app.einsaetze`;
		await leereAngebote(root);
	});

	it('Monat prüfen: leer = dieser Monat (Berlin), sonst JJJJ-MM', () => {
		expect(pruefeMonat(undefined, new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
		expect(pruefeMonat('2026-02')).toBe('2026-02');
		expect(() => pruefeMonat('2026-2')).toThrow(/Monat/);
	});

	it('Verfügbar aus der Kalkulation, geplant aus Einsätzen (am Monatsrand gekappt); Hinweise; Geld nur auf Wunsch', async () => {
		await legeKalkMitarbeiterAn(kA(), { name: 'Murat', benutzerId: u.ids.monteurA, brutto: '36.000', agArt: 'prozent', agProzent: '0' });
		await legeKalkMitarbeiterAn(kA(), { name: 'Aushilfe', brutto: '12.000', agArt: 'prozent', agProzent: '0' });
		await legeKostenAn(kA(), { name: 'Miete', kategorie: 'fixkosten', betrag: '1.000,00', intervall: 'monatlich' });

		// Monteur: 2 × 8 h im November, 1 Einsatz über die Monatsgrenze (2 von 4 h im November); Chef 3 h (nicht in der Kalkulation)
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-11-03T07:00:00+01:00', '2026-11-03T15:00:00+01:00');
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-11-04T07:00:00+01:00', '2026-11-04T15:00:00+01:00');
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-10-31T22:00:00+01:00', '2026-11-01T02:00:00+01:00');
		await einsatz(u.betriebA, u.auftragA, u.ids.chefA, '2026-11-05T08:00:00+01:00', '2026-11-05T11:00:00+01:00');
		// anderer Betrieb zählt nie
		await einsatz(u.betriebB, u.auftragB, u.ids.chefB, '2026-11-05T08:00:00+01:00', '2026-11-05T18:00:00+01:00');

		const a = await ladeAuslastung(kA(), MONAT, { mitGeld: false });
		expect(a.geld).toBeNull();
		expect(a.kalkulationFehlt).toBe(false);
		const murat = a.personen.find((p) => p.name === 'Murat')!;
		// 210 × 7 = 1.470 h im Jahr, November 21 von 261 Werktagen
		expect(murat).toMatchObject({ benutzerId: u.ids.monteurA, verfuegbar: 118.3, geplant: 18, auslastungProzent: 15, frei: 100.3, hinweis: null });
		expect(a.personen.find((p) => p.name === 'Aushilfe')).toMatchObject({ verfuegbar: 118.3, geplant: 0, hinweis: expect.stringMatching(/Benutzer/) });
		const chef = a.personen.find((p) => p.benutzerId === u.ids.chefA)!;
		expect(chef).toMatchObject({ verfuegbar: null, geplant: 3, hinweis: expect.stringMatching(/Kalkulation/) });
		expect(a.summe).toMatchObject({ verfuegbar: 236.6, geplant: 18, frei: 218.6 });
	});

	it('Break-even: angenommene Angebote anteilig nach Stunden im Monat, minus Material, gegen Monatskosten', async () => {
		await legeKalkMitarbeiterAn(kA(), { name: 'Murat', benutzerId: u.ids.monteurA, brutto: '36.000', agArt: 'prozent', agProzent: '0' });
		await legeKalkMitarbeiterAn(kA(), { name: 'Aushilfe', brutto: '12.000', agArt: 'prozent', agProzent: '0' });
		await legeKostenAn(kA(), { name: 'Miete', kategorie: 'fixkosten', betrag: '1.000,00', intervall: 'monatlich' });
		// Monatskosten = (36.000 + 12.000 + 12.000) / 12 = 5.000 €
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-11-03T07:00:00+01:00', '2026-11-03T15:00:00+01:00'); // 8 h Nov
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-12-01T07:00:00+01:00', '2026-12-01T15:00:00+01:00'); // 8 h Dez
		await angebot(u.auftragA, 'angenommen', 2_000_000, 200_000); // 20.000 € netto, 2.000 € Material → Hälfte im November
		await angebot(u.auftragA, 'entwurf', 9_999_900, null); // Entwurf zählt nicht
		const ohneTermin = await u.neuerAuftrag('beauftragt', 'Noch nicht eingeplant');
		await angebot(ohneTermin, 'angenommen', 50_000, null);

		const a = await ladeAuslastung(kA(), MONAT, { mitGeld: true });
		expect(a.geld).toEqual({
			kostenCent: 500_000,
			umsatzCent: 1_000_000,
			materialCent: 100_000,
			deckungsbeitragCent: 900_000,
			ergebnisCent: 400_000,
			erreicht: true,
			deckungProzent: 180,
			nichtEingeplantCent: 50_000,
			auftraegeImMonat: 1
		});
		const leer = await ladeAuslastung(kA(), '2027-03', { mitGeld: true });
		expect(leer.geld).toMatchObject({ umsatzCent: 0, ergebnisCent: -500_000, erreicht: false });
	});

	it('Seite: Monteur 403; ohne „Preise sehen“ keine Geldwerte; Chef mit Break-even; Monat aus der Adresse', async () => {
		const laden = (nutzer: unknown, monat = MONAT) =>
			seitenLoad({ locals: { nutzer }, url: new URL(`http://x/plantafel/auslastung?monat=${monat}`) } as never) as Promise<Record<string, any>>;
		await expect(laden(u.monteurA)).rejects.toMatchObject({ status: 403 });
		const ohne = await laden(u.ohnePreiseA);
		expect(ohne).toMatchObject({ monat: MONAT, monatText: 'November 2026', mitGeld: false, geld: null, vorher: '2026-10', nachher: '2026-12' });
		const chef = await laden(u.chefA, 'kaputt');
		expect(chef.mitGeld).toBe(true);
		expect(chef.geld).not.toBeNull();
		expect(chef.monat).toMatch(/^\d{4}-\d{2}$/);
	});

	it('ohne Kalkulation: kalkulationFehlt, Personen nur aus der Plantafel', async () => {
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, '2026-11-03T07:00:00+01:00', '2026-11-03T15:00:00+01:00');
		const a = await ladeAuslastung(kA(), MONAT, { mitGeld: true });
		expect(a.kalkulationFehlt).toBe(true);
		expect(a.personen).toHaveLength(1);
		expect(a.personen[0]).toMatchObject({ verfuegbar: null, geplant: 8 });
		expect(a.summe).toMatchObject({ verfuegbar: 0, frei: 0 });
	});

	it('Sprache: Auslastung (alle / eine Person / nächster Monat), Gewinn nur mit „Preise sehen“; Start-Kachel', async () => {
		setzeKiAnbieter(new FakeKi());
		await legeKalkMitarbeiterAn(kA(), { name: 'Ali Monteur', benutzerId: u.ids.monteurA, brutto: '36.000', agArt: 'prozent', agProzent: '0' });
		const heute = berlinTag(new Date());
		await einsatz(u.betriebA, u.auftragA, u.ids.monteurA, ausTagUndUhrzeit(heute, '08:00').toISOString(), ausTagUndUhrzeit(heute, '16:00').toISOString());
		const frage = async (nutzer: unknown, text: string) =>
			(await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;

		const alle = await frage(u.chefA, 'Wie ist die Auslastung?');
		expect(alle.vorschlag).toBeNull();
		expect(alle.karte.titel).toMatch(/^Auslastung \w+ \d{4}$/);
		expect(alle.karte.antwort.vorlesen).toMatch(/8 von [\d,]+ Stunden verplant/);
		expect(alle.karte.antwort.vorlesen).toMatch(/Break-even/);
		expect(alle.karte.antwort.abschnitte[1].eintraege[0].link).toMatch(/^\/plantafel\/auslastung\?monat=\d{4}-\d{2}$/);

		const ali = await frage(u.chefA, 'Wie ausgelastet ist Ali nächsten Monat?');
		expect(ali.karte.titel).toMatch(/– Ali Monteur$/);
		expect(ali.karte.antwort.vorlesen).toMatch(/^Ali Monteur ist im \w+ \d{4} zu 0 Prozent ausgelastet/);

		const ohne = await frage(u.ohnePreiseA, 'Wie ist die Auslastung?');
		expect(ohne.karte.antwort.vorlesen).not.toMatch(/Break-even|€/);
		expect((await frage(u.ohnePreiseA, 'Wie viel Gewinn haben wir diesen Monat verplant?')).karte.fehler).toMatch(/Berechtigung/);
		expect((await frage(u.monteurA, 'Wie ist die Auslastung?')).karte.fehler).toMatch(/Berechtigung/);

		const gewinn = await frage(u.chefA, 'Wie viel Gewinn haben wir diesen Monat verplant?');
		expect(gewinn.karte.aktion).toBe('abfrage_monatsgewinn');
		expect(gewinn.karte.antwort.vorlesen).toMatch(/^Diesen Monat: noch [\d.]+,\d\d € bis zum Break-even, [\d,]+ Stunden frei\.$/);
		expect(gewinn.karte.antwort.abschnitte[0].titel).toBe('Break-even noch nicht erreicht');

		const start = (nutzer: unknown) =>
			startLoad({ locals: { nutzer }, parent: async () => ({ navigation: null }), url: new URL('http://x/') } as never) as Promise<Record<string, any>>;
		expect((await start(u.chefA)).monat).toMatchObject({ erreicht: false, kalkulationFehlt: false, satz: expect.stringMatching(/bis zum Break-even, [\d,]+ Stunden frei$/) });
		expect((await start(u.ohnePreiseA)).monat).toBeNull();
		expect((await start(u.monteurA)).monat).toBeNull();
	});
});
