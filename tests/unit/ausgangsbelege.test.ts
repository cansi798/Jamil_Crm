import { describe, expect, it } from 'vitest';
import { belegLink, belegSuche, suchMuster, BELEG_ARTEN } from '../../src/lib/ausgangsbelege';

/** Ausgangsbelege (Jamil msgs 3054–3056): alle Reiter teilen Adressen-Parameter und Suchregeln. */
describe('Ausgangsbelege – gemeinsame Regeln', () => {
	const f = { suche: null, status: null, zeitraum: 'monat' as const };

	it('Reiter in fester Reihenfolge', () => {
		expect(BELEG_ARTEN.map((a) => a.text)).toEqual(['Angebote', 'Auftragsbestätigungen', 'Rechnungen']);
	});

	it('Links: Standardwerte bleiben aus der Adresse, Suche bleibt bei Status/Zeitraum erhalten', () => {
		expect(belegLink('angebote', f)).toBe('/ausgangsbelege/angebote');
		expect(belegLink('rechnungen', f, { zeitraum: 'jahr' })).toBe('/ausgangsbelege/rechnungen?zeitraum=jahr');
		const mit = { suche: 'Meier & Co', status: 'entwurf', zeitraum: 'quartal' as const };
		expect(belegLink('angebote', mit)).toBe('/ausgangsbelege/angebote?suche=Meier+%26+Co&status=entwurf&zeitraum=quartal');
		expect(belegLink('angebote', mit, { status: null })).toBe('/ausgangsbelege/angebote?suche=Meier+%26+Co&zeitraum=quartal');
		expect(belegLink('auftragsbestaetigungen', mit, { status: 'bereit', zeitraum: 'monat' })).toBe('/ausgangsbelege/auftragsbestaetigungen?suche=Meier+%26+Co&status=bereit');
	});

	it('Suche: getrimmt, gekürzt, leer → null; Muster maskiert Sonderzeichen', () => {
		expect(belegSuche(new URL('http://t/?suche=%20%20'))).toBeNull();
		expect(belegSuche(new URL('http://t/?suche=%20ab%20'))).toBe('ab');
		expect(belegSuche(new URL(`http://t/?suche=${'x'.repeat(150)}`))!.length).toBe(100);
		expect(suchMuster(' a%b_c\\ ')).toBe('%a\\%b\\_c\\\\%');
		expect(suchMuster('')).toBeNull();
		expect(suchMuster(null)).toBeNull();
	});
});
