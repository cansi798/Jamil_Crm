import { describe, expect, it } from 'vitest';
import { enthaeltPreisfeld, ohnePreise, ohnePreisSpalten, PREISFELDER } from '../../src/lib/server/preisschutz';

describe('Preisschutz', () => {
	it('kennt genau die Preisfelder der Antworten', () => {
		expect(PREISFELDER).toEqual(expect.arrayContaining(['lohnCent', 'materialCent', 'einzelpreisCent', 'summeCent', 'nettoCent', 'mwstCent', 'bruttoCent']));
		// Partner/Fremdleistungen, Nachkalkulation, Kennzahlen (Preisschutz-Nachtrag)
		expect(PREISFELDER).toEqual(expect.arrayContaining(['betragCent', 'summeFremdCent', 'fremdleistungCent', 'umsatzCent', 'provisionCent', 'wertOffenCent', 'durchschnittCent']));
	});

	it('jedes Feld, das auf „Cent“ endet, gilt als Preisfeld (auch künftige)', () => {
		expect(enthaeltPreisfeld({ a: [{ irgendwasNeuesCent: null }] })).toBe(true);
		expect(ohnePreise({ name: 'x', summeFremdCent: 5, partner: { provisionCent: 1, prozent: 3 } })).toEqual({ name: 'x', partner: { prozent: 3 } });
		expect(enthaeltPreisfeld({ Centrum: 1, prozent: 2 })).toBe(false);
	});

	it('enthaeltPreisfeld sucht rekursiv in Objekten und Listen', () => {
		expect(enthaeltPreisfeld({ id: 1, name: 'x' })).toBe(false);
		expect(enthaeltPreisfeld(null)).toBe(false);
		expect(enthaeltPreisfeld('lohnCent')).toBe(false);
		expect(enthaeltPreisfeld([1, 'a', null])).toBe(false);
		expect(enthaeltPreisfeld({ lohnCent: 0 })).toBe(true);
		expect(enthaeltPreisfeld({ a: { b: [{ c: 1 }, { bruttoCent: undefined }] } })).toBe(true);
		expect(enthaeltPreisfeld([{ angebot: { positionen: [{ summeCent: 5 }] } }])).toBe(true);
	});

	it('ohnePreise entfernt die Felder rekursiv, ohne das Original zu ändern', () => {
		const roh = {
			id: 'a',
			nettoCent: 100,
			positionen: [{ bezeichnung: 'x', einzelpreisCent: 5, summeCent: 5, menge: 1 }],
			kunde: { name: 'Müller' },
			datum: '2026-10-17'
		};
		const sauber = ohnePreise(roh);
		expect(sauber).toEqual({ id: 'a', positionen: [{ bezeichnung: 'x', menge: 1 }], kunde: { name: 'Müller' }, datum: '2026-10-17' });
		expect(enthaeltPreisfeld(sauber)).toBe(false);
		expect(roh.nettoCent).toBe(100);
		expect(roh.positionen[0].summeCent).toBe(5);
		expect(ohnePreise([{ lohnCent: 1, a: 2 }])).toEqual([{ a: 2 }]);
		expect(ohnePreise(null)).toBeNull();
		expect(ohnePreise(7)).toBe(7);
	});

	it('ohnePreisSpalten: Spalten im Änderungsprotokoll (lohn_cent, material_cent, einzelpreis_cent)', () => {
		expect(ohnePreisSpalten({ bezeichnung: 'x', lohn_cent: 1, material_cent: 2, einzelpreis_cent: 3 })).toEqual({ bezeichnung: 'x' });
		expect(ohnePreisSpalten(null)).toBeNull();
	});
});
