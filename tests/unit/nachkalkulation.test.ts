import { describe, expect, it } from 'vitest';
import { kmSatz, lernVorschlaege, nachkalkuliere, planWerte, type PlanPosition } from '../../src/lib/nachkalkulation';

const pos = (o: Partial<PlanPosition> = {}): PlanPosition => ({
	katalogPositionId: 'k1',
	bezeichnung: 'Fliesen verlegen',
	menge: 10,
	einheit: 'm²',
	arbeitMinuten: 60,
	materialCent: 2_000,
	einzelpreisCent: 10_000,
	...o
});
const SATZ = { kostendeckendCent: 5_000, empfohlenCent: 6_000 };

describe('Nachkalkulation – Plan/Ist', () => {
	it('Plan aus Menge × Minuten, Material, Erlös; Einheit „h“ = 60 Min.; ohne Minuten gezählt', () => {
		expect(planWerte([pos(), pos({ einheit: 'h', menge: 2, arbeitMinuten: null }), pos({ einheit: 'Stk', arbeitMinuten: null })])).toEqual({
			minuten: 600 + 120,
			materialCent: 44_000,
			erloesCent: 220_000,
			ohneArbeitszeit: 1
		});
	});

	it('wie geplant: Gewinn Plan = Ist, Ampel grün (effektiv ≥ empfohlen)', () => {
		const n = nachkalkuliere({ positionen: [pos()], istArbeitMin: 600, istFahrtMin: 0, istKm: 0, istMaterialCent: 20_000, satz: SATZ, kmSatzCent: 30 });
		// Erlös 1.000 €, Material 200 €, 10 h × 50 € = 500 € → Gewinn 300 €
		expect(n.plan).toMatchObject({ stunden: 10, materialCent: 20_000, lohnkostenCent: 50_000, kostenCent: 70_000, erloesCent: 100_000, deckungsbeitragCent: 80_000, gewinnCent: 30_000 });
		expect(n.ist).toMatchObject({ stunden: 10, kostenCent: 70_000, gewinnCent: 30_000, effektiverSatzCent: 8_000 });
		expect(n.ampel).toBe('gruen');
		expect(n.stundenAbweichungProzent).toBe(0);
	});

	it('länger gebraucht + Fahrt mit km: Verlust, Ampel rot', () => {
		const n = nachkalkuliere({ positionen: [pos()], istArbeitMin: 900, istFahrtMin: 120, istKm: 100, istMaterialCent: 26_000, satz: SATZ, kmSatzCent: 40 });
		// Lohn 15 h × 50 = 750, Fahrt 2 h × 50 = 100 + 100 km × 0,40 = 40 → 140, Material 260 → Kosten 1.150 → −150
		expect(n.ist).toMatchObject({ lohnkostenCent: 75_000, fahrtkostenCent: 14_000, kmKostenCent: 4_000, kostenCent: 115_000, gewinnCent: -15_000 });
		// DB = 1.000 − 260 − 40 = 700 € / 17 h = 41,18 €/h < 50 → rot
		expect(n.ist.deckungsbeitragCent).toBe(70_000);
		expect(n.ampel).toBe('rot');
		expect(n.stundenAbweichungProzent).toBe(50);
	});

	it('gelb: deckt nur die Kosten', () => {
		const n = nachkalkuliere({ positionen: [pos()], istArbeitMin: 1_380, istFahrtMin: 0, istKm: 0, istMaterialCent: 20_000, satz: SATZ, kmSatzCent: null });
		// 800 € / 23 h = 34,78 → rot; 800/14 = 57,1 → gelb
		expect(n.ampel).toBe('rot');
		expect(nachkalkuliere({ positionen: [pos()], istArbeitMin: 840, istFahrtMin: 0, istKm: 0, istMaterialCent: 20_000, satz: SATZ, kmSatzCent: null }).ampel).toBe('gelb');
	});

	it('ohne Kalkulation: keine Kosten/Gewinne, Hinweis; Material ohne Erfassung = Plan; km ohne Satz → Hinweis', () => {
		const n = nachkalkuliere({ positionen: [pos()], istArbeitMin: 60, istFahrtMin: 30, istKm: 12, istMaterialCent: null, satz: null, kmSatzCent: null });
		expect(n.plan.gewinnCent).toBeNull();
		expect(n.ist.kostenCent).toBeNull();
		expect(n.ist.materialGeschaetzt).toBe(true);
		expect(n.ist.materialCent).toBe(20_000);
		expect(n.ampel).toBeNull();
		expect(n.hinweise.join(' ')).toMatch(/Kosten-Stundensatz/);
		expect(n.hinweise.join(' ')).toMatch(/km-Satz/);
		expect(n.hinweise.join(' ')).toMatch(/geplante Material/);
	});

	it('ohne Angebot und ohne Zeiten: Hinweise statt Division durch 0', () => {
		const n = nachkalkuliere({ positionen: [], istArbeitMin: 0, istFahrtMin: 0, istKm: 0, istMaterialCent: null, satz: SATZ, kmSatzCent: 30 });
		expect(n.ist.effektiverSatzCent).toBeNull();
		expect(n.stundenAbweichungProzent).toBeNull();
		expect(n.hinweise).toEqual(expect.arrayContaining([expect.stringMatching(/Kein angenommenes Angebot/), expect.stringMatching(/Noch keine Zeiten/)]));
	});

	it('km-Satz: fest, sonst Fahrzeugkosten ÷ km/Jahr, sonst null', () => {
		expect(kmSatz(45, 1_000_000, 10_000)).toBe(45);
		expect(kmSatz(null, 1_200_000, 40_000)).toBe(30);
		expect(kmSatz(null, 1_200_000, null)).toBeNull();
		expect(kmSatz(null, 0, 40_000)).toBeNull();
	});
});

describe('Nachkalkulation – Lernen', () => {
	const probe = (id: string, istMin: number, positionen: PlanPosition[]) => ({ auftragId: id, positionen, istArbeitMin: istMin });

	it('Faktor Ist/Plan je Auftrag, Mittelwert, n, Streuung; erst ab 3 Aufträgen und > 10 % Abweichung', () => {
		const p = (menge: number) => [pos({ menge, arbeitMinuten: 30 })];
		const proben = [probe('a', 330, p(10)), probe('b', 450, p(10)), probe('c', 360, p(10))];
		const v = lernVorschlaege(proben);
		// Stichproben: 33, 45, 36 → Mittel 38, Abweichung +27 %
		expect(v).toEqual([expect.objectContaining({ katalogPositionId: 'k1', n: 3, vorschlagMin: 38, minMin: 33, maxMin: 45, abweichungProzent: 27 })]);
		expect(v[0].streuungMin).toBeCloseTo(6.2, 1);
		expect(lernVorschlaege(proben.slice(0, 2))).toEqual([]);
		expect(lernVorschlaege([probe('a', 310, p(10)), probe('b', 300, p(10)), probe('c', 305, p(10))])).toEqual([]);
	});

	it('verteilt die Ist-Zeit anteilig auf mehrere Positionen; ohne Minuten oder ohne Zeit keine Stichprobe', () => {
		const zwei = [pos({ katalogPositionId: 'a', menge: 10, arbeitMinuten: 30 }), pos({ katalogPositionId: 'b', menge: 5, arbeitMinuten: 60 }), pos({ katalogPositionId: 'c', einheit: 'Stk', arbeitMinuten: null })];
		const v = lernVorschlaege([probe('1', 1200, zwei), probe('2', 1200, zwei), probe('3', 1200, zwei), probe('4', 0, zwei)]);
		// Plan 600 Min., Ist 1200 → Faktor 2 → a: 60, b: 120
		expect(v.map((x) => [x.katalogPositionId, x.vorschlagMin, x.n])).toEqual([['a', 60, 3], ['b', 120, 3]]);
	});
});
