import { describe, expect, it } from 'vitest';
import {
	auslastungZeile,
	breakEven,
	gewinnSatz,
	istMonat,
	monatPlus,
	monatsGrenzen,
	verfuegbareStunden,
	werktage
} from '../../src/lib/auslastung';

/** Auslastung je Mitarbeiter und Monat + Break-even (Wunsch Jamil msg 2476, Punkt 4). */
describe('Auslastung', () => {
	it('Monat prüfen, blättern, Grenzen', () => {
		expect(istMonat('2026-11')).toBe(true);
		expect(istMonat('2026-13')).toBe(false);
		expect(istMonat('2026-1')).toBe(false);
		expect(istMonat(202611)).toBe(false);
		expect(monatPlus('2026-12', 1)).toBe('2027-01');
		expect(monatPlus('2026-01', -1)).toBe('2025-12');
		expect(monatsGrenzen('2026-12')).toEqual({ von: '2026-12-01', bis: '2027-01-01' });
	});

	it('Werktage Mo–Fr (bis ausschließlich)', () => {
		expect(werktage('2026-11-01', '2026-12-01')).toBe(21); // November 2026: 1. ist Sonntag
		expect(werktage('2026-02-01', '2026-03-01')).toBe(20);
		expect(werktage('2026-01-01', '2027-01-01')).toBe(261);
	});

	it('Verfügbare Stunden = Jahresstunden × Anteil der Werktage im Monat', () => {
		// 210 Tage × 7 h = 1.470 h im Jahr; November 21 von 261 Werktagen
		expect(verfuegbareStunden(1470, '2026-11')).toBe(118.3);
		expect(verfuegbareStunden(0, '2026-11')).toBe(0);
	});

	it('Zeile: Auslastung in Prozent, freie Stunden nie negativ; ohne Kalkulation keine Kapazität', () => {
		expect(auslastungZeile(100, 75)).toEqual({ verfuegbar: 100, geplant: 75, auslastungProzent: 75, frei: 25, ueberbucht: false });
		expect(auslastungZeile(100, 120)).toEqual({ verfuegbar: 100, geplant: 120, auslastungProzent: 120, frei: 0, ueberbucht: true });
		expect(auslastungZeile(null, 8)).toEqual({ verfuegbar: null, geplant: 8, auslastungProzent: null, frei: null, ueberbucht: false });
		expect(auslastungZeile(0, 0).auslastungProzent).toBeNull();
	});

	it('Break-even: Umsatz anteilig nach eingeplanten Stunden im Monat, minus Material, gegen Monatskosten', () => {
		const b = breakEven(1_000_000, [
			// 10.000 € Auftrag, 40 h insgesamt, 20 h in diesem Monat → 5.000 € Umsatz, 1.000 € Material
			{ nettoCent: 1_000_000, materialCent: 200_000, stundenGesamt: 40, stundenImMonat: 20 },
			// 3.000 € ganz im Monat
			{ nettoCent: 300_000, materialCent: 0, stundenGesamt: 8, stundenImMonat: 8 },
			// ohne Stunden im Monat zählt nicht
			{ nettoCent: 999_999, materialCent: 0, stundenGesamt: 10, stundenImMonat: 0 }
		]);
		expect(b).toEqual({
			kostenCent: 1_000_000,
			umsatzCent: 800_000,
			materialCent: 100_000,
			deckungsbeitragCent: 700_000,
			ergebnisCent: -300_000,
			erreicht: false,
			deckungProzent: 70
		});
		const gut = breakEven(500_000, [{ nettoCent: 600_000, materialCent: 50_000, stundenGesamt: 10, stundenImMonat: 10 }]);
		expect(gut).toMatchObject({ ergebnisCent: 50_000, erreicht: true, deckungProzent: 110 });
		expect(breakEven(0, []).deckungProzent).toBeNull();
	});

	it('Satz für Kachel und Sprache', () => {
		expect(gewinnSatz(400_000, 120)).toBe('4.000,00\u00a0€ Gewinn verplant, 120 Stunden frei');
		expect(gewinnSatz(-300_050, 12.5)).toBe('noch 3.000,50\u00a0€ bis zum Break-even, 12,5 Stunden frei');
		expect(gewinnSatz(0, null)).toBe('0,00\u00a0€ Gewinn verplant');
	});
});
