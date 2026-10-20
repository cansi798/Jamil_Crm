import { describe, expect, it } from 'vitest';
import { kalibriert, kalibrierung, mape, regelSchaetzung, type Eingaben, type Historie } from '../../src/lib/foto-aufmass';
import { materialAlsMenge, pruefeEingaben, pruefeKiAufmass } from '../../src/lib/server/foto-aufmass';

const bad: Eingaben = { raumart: 'bad', wandM2: 20, bodenM2: 4, hoeheM: 2.5, objekte: { dusche: 1, wc: 1, waschtisch: 1, tueren: 1 }, referenz: null };

describe('Foto-Aufmaß – Rechnen und Lernen', () => {
	it('Faustwerte aus den Eingaben (Kleber 4 kg/m², Fugenmörtel 0,5 kg/m², Abdichtung Boden + Spritzbereiche)', () => {
		const r = regelSchaetzung(bad);
		expect(r).toMatchObject({ fliesenkleber_kg: 96, fugenmoertel_kg: 12, abdichtung_m2: 9.4, sockel_lfm: 7.1 });
		expect(regelSchaetzung({ ...bad, raumart: 'flur', objekte: {} }).abdichtung_m2).toBe(0);
	});

	it('Kalibrierung: Median von Ziel ÷ KI je Menge, Ist schlägt Übernommen, ab 2 Fällen, begrenzt 0,5–2', () => {
		const h = (ki: number, fin: number, ist: number | null = null, pos?: Record<string, [number, number]>): Historie => ({
			eingaben: bad, ki: { silikon_lfm: ki }, final: { silikon_lfm: fin }, ist: ist === null ? null : { silikon_lfm: ist }, positionen: pos
		});
		expect(kalibrierung([h(10, 12)])).toEqual({});
		const f = kalibrierung([h(10, 12), h(10, 14), h(10, 50, 11)]);
		expect(f.silikon_lfm).toEqual({ faktor: 1.2, n: 3 });
		expect(kalibrierung([h(10, 100), h(10, 100)]).silikon_lfm.faktor).toBe(2);
		expect(kalibrierung([h(1, 1, null, { abc: [4, 6] }), h(1, 1, null, { abc: [5, 7.5] })])['pos:abc']).toEqual({ faktor: 1.5, n: 2 });
		expect(kalibriert('silikon_lfm', 10, f)).toBe(12);
		expect(kalibriert('fliesenkleber_kg', 99.4, {})).toBe(99);
	});

	it('Abweichung (MAPE) für die Genauigkeitsmessung', () => {
		expect(mape([[10, 12], [20, 18]])).toBe(15);
		expect(mape([[0, 5]])).toBeNull();
	});

	it('Eingaben: Wand und Boden Pflicht (die KI schätzt sie nicht); Objekte ganzzahlig', () => {
		expect(() => pruefeEingaben({ raumart: 'bad', bodenM2: '4' })).toThrow(/Wandfläche/);
		expect(() => pruefeEingaben({ raumart: 'keller', wandM2: '1', bodenM2: '1' })).toThrow(/Raumart/);
		expect(pruefeEingaben({ raumart: 'bad', wandM2: '20,5', bodenM2: '4', dusche: '1', wc: '0' })).toMatchObject({ wandM2: 20.5, objekte: { dusche: 1 } });
	});

	it('KI-Antwort streng geprüft: nur bekannte Mengen, Zahlen ≥ 0, Konfidenz 0–1', () => {
		const k = pruefeKiAufmass({ mengen: { silikon_lfm: 12.34, unbekannt: 5, fliesenkleber_kg: -3 }, positionen: [{ schluessel: 'K1', menge: 2 }, { schluessel: 'K2', menge: -1 }], konfidenz: 7, annahmen: ['a', 3] });
		expect(k).toMatchObject({ mengen: { silikon_lfm: 12.3 }, positionen: [{ schluessel: 'K1', menge: 2 }], konfidenz: 1, annahmen: ['a'] });
		expect(() => pruefeKiAufmass({})).toThrow();
	});

	it('Ist-Verbrauch aus Material: Säcke mit „25 kg“ umgerechnet, Silikon nur in m', () => {
		expect(materialAlsMenge('Fliesenkleber flex 25 kg', 'Sack', 4)).toEqual({ schluessel: 'fliesenkleber_kg', menge: 100 });
		expect(materialAlsMenge('Fugenmörtel grau', 'kg', 10)).toEqual({ schluessel: 'fugenmoertel_kg', menge: 10 });
		expect(materialAlsMenge('Silikon weiß', 'Stk', 3)).toBeNull();
		expect(materialAlsMenge('Dichtband', 'm', 12)).toEqual({ schluessel: 'dichtband_lfm', menge: 12 });
	});
});
