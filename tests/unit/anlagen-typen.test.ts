import { describe, expect, it } from 'vitest';
import { ANLAGEN_TYPEN, TYP_NAMEN, istAnlagenTyp, pruefeExtra, extraAusFormular, extraAnzeige } from '../../src/lib/anlagen-typen';

describe('Anlagen-Typen', () => {
	it('acht Typen mit deutschen Namen', () => {
		expect(ANLAGEN_TYPEN).toEqual(['solar', 'waermepumpe', 'gasspeicher', 'heizung', 'klima', 'lueftung', 'wallbox', 'sonstige']);
		expect(TYP_NAMEN.waermepumpe).toBe('Wärmepumpe');
		expect(istAnlagenTyp('solar')).toBe(true);
		expect(istAnlagenTyp('atomkraft')).toBe(false);
	});

	it('pruefeExtra: nur Felder des Typs, Zahlen/Auswahl/Datum geprüft, leere weg', () => {
		expect(pruefeExtra('solar', { leistung_kwp: '9,8', module: '24', wechselrichter: ' SMA ', fremd: 'x', speicher_kwh: '' })).toEqual({
			leistung_kwp: 9.8,
			module: 24,
			wechselrichter: 'SMA'
		});
		expect(pruefeExtra('waermepumpe', { bauart: 'luft_wasser' })).toEqual({ bauart: 'luft_wasser' });
		expect(() => pruefeExtra('waermepumpe', { bauart: 'zauber' })).toThrow(/Bauart/);
		expect(() => pruefeExtra('solar', { leistung_kwp: 'viel' })).toThrow(/Leistung/);
		expect(() => pruefeExtra('solar', { leistung_kwp: '-1' })).toThrow(/Leistung/);
		expect(() => pruefeExtra('gasspeicher', { pruefung_bis: '31.12.2027' })).toThrow(/Prüfung/);
		expect(pruefeExtra('gasspeicher', { pruefung_bis: '2027-12-31' })).toEqual({ pruefung_bis: '2027-12-31' });
		expect(pruefeExtra('sonstige', { egal: '1' })).toEqual({});
		expect(() => pruefeExtra('solar', { wechselrichter: 'x'.repeat(201) })).toThrow(/zu lang/);
	});

	it('Formular: extra_<feld>; Anzeige mit Einheit und Auswahltext', () => {
		const f = new FormData();
		f.set('extra_leistung_kw', '11');
		f.set('extra_anschluss', 'Typ 2');
		f.set('titel', 'egal');
		expect(extraAusFormular(f)).toEqual({ leistung_kw: '11', anschluss: 'Typ 2' });
		expect(extraAnzeige('waermepumpe', { bauart: 'sole_wasser', leistung_kw: 8.5 })).toEqual([
			{ name: 'Bauart', wert: 'Sole/Wasser' },
			{ name: 'Heizleistung', wert: '8,5 kW' }
		]);
	});
});
