import { describe, expect, it } from 'vitest';
import { kopfIstHell, portalLogo } from '../../src/lib/portal-kopf';

describe('Logo im Kopf des Kundenportals (Jamil msgs 3088, 3126)', () => {
	const beide = { briefkopf: true, dunkel: true };
	it('heller Kopf (z. B. #f4f1eb): normales Logo ohne Feld', () => {
		expect(kopfIstHell('#f4f1eb')).toBe(true);
		expect(portalLogo('#f4f1eb', beide)).toEqual({ variante: 'briefkopf', feld: null });
		expect(portalLogo('#f4f1eb', { briefkopf: false, dunkel: true })).toEqual({ variante: 'dunkel', feld: 'dunkel' });
	});
	it('dunkler Kopf (Standard Anthrazit): helle Variante ohne Feld, sonst normales Logo auf weißem Feld', () => {
		expect(kopfIstHell(null)).toBe(false);
		expect(portalLogo(null, beide)).toEqual({ variante: 'dunkel', feld: null });
		expect(portalLogo('#1f2430', { briefkopf: true, dunkel: false })).toEqual({ variante: 'briefkopf', feld: 'weiss' });
	});
	it('ohne Logo: keins', () => {
		expect(portalLogo('#f4f1eb', { briefkopf: false, dunkel: false })).toBeNull();
		expect(portalLogo(null, { briefkopf: false, dunkel: false })).toBeNull();
	});
});
