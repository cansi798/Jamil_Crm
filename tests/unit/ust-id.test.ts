import { describe, expect, it } from 'vitest';
import { pruefeSteuernummer, pruefeUstId } from '../../src/lib/ust-id';
import { istLand, landName, LAENDER } from '../../src/lib/laender';
import { adresseLand } from '../../src/lib/server/lexware/land';

/** USt-IdNr./Steuernummer grob nach Länderpräfix (Can #6739, keine Online-Prüfung) und Länderliste (Migration 125). */
describe('USt-IdNr.', () => {
	it('gültige Formen je Land, normalisiert (Leerzeichen weg, groß)', () => {
		expect(pruefeUstId('de 123 456 789')).toEqual({ ok: true, wert: 'DE123456789', land: 'DE' });
		expect(pruefeUstId('ATU12345678')).toMatchObject({ ok: true, land: 'AT' });
		expect(pruefeUstId('CHE-123.456.789 MWST')).toMatchObject({ ok: true, wert: 'CHE-123.456.789MWST', land: 'CH' });
		expect(pruefeUstId('NL123456789B01')).toMatchObject({ ok: true, land: 'NL' });
		expect(pruefeUstId('EL123456789')).toMatchObject({ ok: true, land: 'GR' });
		expect(pruefeUstId('FR12345678901')).toMatchObject({ ok: true });
	});
	it('falsche Formen mit verständlicher Meldung; leer = keine Angabe', () => {
		expect(pruefeUstId('')).toBeNull();
		expect(pruefeUstId('   ')).toBeNull();
		expect(pruefeUstId('DE12345678')).toMatchObject({ ok: false, fehler: expect.stringMatching(/DE123456789/) });
		expect(pruefeUstId('AT12345678')).toMatchObject({ ok: false });
		expect(pruefeUstId('123456789')).toMatchObject({ ok: false, fehler: expect.stringMatching(/Länderkürzel/) });
		expect(pruefeUstId('XX12<34')).toMatchObject({ ok: false });
	});
	it('Steuernummer: Ziffern mit / und Leerzeichen', () => {
		expect(pruefeSteuernummer('12/345/67890')).toEqual({ ok: true, wert: '12/345/67890' });
		expect(pruefeSteuernummer('2181508150')).toMatchObject({ ok: true });
		expect(pruefeSteuernummer('12a/34')).toMatchObject({ ok: false });
		expect(pruefeSteuernummer('1/2')).toMatchObject({ ok: false });
		expect(pruefeSteuernummer(null)).toBeNull();
	});
});

describe('Länder', () => {
	it('Liste mit ISO-Codes, Deutschland zuerst; Namen', () => {
		expect(LAENDER[0]).toEqual(['DE', 'Deutschland']);
		expect(LAENDER.every(([c]) => /^[A-Z]{2}$/.test(c))).toBe(true);
		expect(istLand('AT')).toBe(true);
		expect(istLand('at')).toBe(false);
		expect(istLand('XX')).toBe(false);
		expect(landName('CH')).toBe('Schweiz');
		expect(landName(null)).toBe('Deutschland');
	});
	it('adresseLand: Land geht vor, PLZ-Kürzel ist Rückfall, Widerspruch → Warnung', () => {
		expect(adresseLand('AT', '1010')).toEqual({ countryCode: 'AT', zip: '1010', warnung: null });
		expect(adresseLand('AT', 'A-1010')).toEqual({ countryCode: 'AT', zip: '1010', warnung: null });
		expect(adresseLand(null, 'CH-8001')).toMatchObject({ countryCode: 'CH', zip: '8001' });
		expect(adresseLand('DE', 'A-1010')).toMatchObject({ countryCode: 'DE', zip: 'A-1010', warnung: expect.stringMatching(/passt nicht/) });
		expect(adresseLand('DE', '24103')).toEqual({ countryCode: 'DE', zip: '24103', warnung: null });
	});
});
