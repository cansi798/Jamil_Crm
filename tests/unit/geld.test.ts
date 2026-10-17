import { describe, expect, it } from 'vitest';
import {
	centAlsEingabe,
	euro,
	leseEuroInCent,
	leseMenge,
	mengeText,
	positionsSumme,
	summen
} from '../../src/lib/geld';

describe('Geld-Rechnen in Cent', () => {
	it('Review Focus 2: 3 × 33,33 € + 19 % → Netto 99,99, MwSt 19,00, Brutto 118,99', () => {
		expect(summen([{ menge: 3, einzelpreisCent: 3333 }], 19)).toEqual({ nettoCent: 9999, mwstCent: 1900, bruttoCent: 11899 });
	});

	it('Positionssumme kaufmännisch gerundet, ohne Gleitkommafehler', () => {
		expect(positionsSumme(2.5, 4999)).toBe(12498); // 12497,5 → 12498
		expect(positionsSumme(0.1 * 3, 1000)).toBe(300); // nicht 299 durch 0.30000000000000004
		expect(positionsSumme(1.005, 100)).toBe(101); // 100,5 → 101
		expect(positionsSumme(0.001, 1)).toBe(0); // 0,001 Cent → 0
		expect(positionsSumme(0.333, 3)).toBe(1); // 0,999 → 1
		expect(positionsSumme(1_000_000, 999_999_999)).toBe(999_999_999_000_000);
		expect(positionsSumme(3, 0)).toBe(0);
	});

	it('Summen: leer, MwSt 0 und 7, mehrere Positionen', () => {
		expect(summen([], 19)).toEqual({ nettoCent: 0, mwstCent: 0, bruttoCent: 0 });
		expect(summen([{ menge: 1, einzelpreisCent: 1000 }], 0)).toEqual({ nettoCent: 1000, mwstCent: 0, bruttoCent: 1000 });
		// 7 % von 1,50 € = 0,105 → 0,11
		expect(summen([{ menge: 1, einzelpreisCent: 150 }], 7)).toEqual({ nettoCent: 150, mwstCent: 11, bruttoCent: 161 });
		expect(
			summen(
				[
					{ menge: 2.5, einzelpreisCent: 4999 },
					{ menge: 1, einzelpreisCent: 1 }
				],
				19
			)
		).toEqual({ nettoCent: 12499, mwstCent: 2375, bruttoCent: 14874 });
	});

	it('leseMenge: Komma und Punkt, höchstens 3 Nachkommastellen, > 0 und ≤ 1 000 000', () => {
		expect(leseMenge('2,5')).toBe(2.5);
		expect(leseMenge('2.5')).toBe(2.5);
		expect(leseMenge(2.5)).toBe(2.5);
		expect(leseMenge(' 12 ')).toBe(12);
		expect(leseMenge('0,125')).toBe(0.125);
		expect(leseMenge('1.000,5')).toBe(1000.5);
		expect(leseMenge('1000000')).toBe(1_000_000);
		for (const w of ['0', '-1', '0,0001', 'abc', '', '1e3', '1,2,3', '1000000,001', 0, -2, Number.NaN, Infinity]) {
			expect(() => leseMenge(w as never), String(w)).toThrow(RangeError);
		}
	});

	it('leseEuroInCent: deutsche und englische Schreibweise, ≥ 0, höchstens 2 Nachkommastellen', () => {
		expect(leseEuroInCent('1.234,56')).toBe(123456);
		expect(leseEuroInCent('1234,56')).toBe(123456);
		expect(leseEuroInCent('1234.56')).toBe(123456);
		expect(leseEuroInCent(1234.56)).toBe(123456);
		expect(leseEuroInCent('12.5')).toBe(1250);
		expect(leseEuroInCent('12,5')).toBe(1250);
		expect(leseEuroInCent('0')).toBe(0);
		expect(leseEuroInCent('33,33 €')).toBe(3333);
		expect(leseEuroInCent(0.1 + 0.2)).toBe(30);
		for (const w of ['-1', '1,234', '1.2.3,4', 'abc', '', '12,345', -0.01, Number.NaN, '100000000,00', '1.2345']) {
			expect(() => leseEuroInCent(w as never), String(w)).toThrow(RangeError);
		}
	});

	it('Anzeige de-DE: „1.234,56 €“ mit geschütztem Leerzeichen; Mengen „2,5“', () => {
		expect(euro(123456)).toBe('1.234,56 €');
		expect(euro(0)).toBe('0,00 €');
		expect(euro(5)).toBe('0,05 €');
		expect(euro(123456789)).toBe('1.234.567,89 €');
		expect(euro(-1999)).toBe('-19,99 €');
		expect(mengeText(2.5)).toBe('2,5');
		expect(mengeText(1000.125)).toBe('1.000,125');
		expect(mengeText(3)).toBe('3');
		expect(centAlsEingabe(123456)).toBe('1234,56');
		expect(centAlsEingabe(0)).toBe('0,00');
	});

	it('Gesamtprüfung 3: Punkt ohne Komma ist Dezimaltrenner; „1.234“ als Betrag → Fehler mit Hinweis auf das Komma', () => {
		expect(leseMenge('0.125')).toBe(0.125);
		expect(leseMenge('2.250')).toBe(2.25);
		expect(leseMenge('1.000')).toBe(1);
		expect(leseMenge('1.234,5')).toBe(1234.5);
		expect(() => leseMenge('1.000.000')).toThrow(RangeError);
		expect(() => leseEuroInCent('1.234')).toThrow('Bitte Betrag mit Komma angeben, z. B. 1.234,00');
		expect(() => leseEuroInCent('1.234.567')).toThrow('Bitte Betrag mit Komma angeben, z. B. 1.234,00');
		expect(() => leseEuroInCent('0.125')).toThrow(RangeError);
		expect(leseEuroInCent('0.12')).toBe(12);
		expect(leseEuroInCent('1.234,00')).toBe(123400);
		expect(leseEuroInCent('1234.5')).toBe(123450);
	});
});
