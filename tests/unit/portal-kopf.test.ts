import { describe, expect, it } from 'vitest';
import { kopfIstHell, portalLogo } from '../../src/lib/portal-kopf';

describe('Logo im Kopf des Kundenportals (Jamil msgs 3088, 3126)', () => {
	const beide = { briefkopf: true, dunkel: true };
	it('heller Kopf (z. B. #f4f1eb): normales Logo ohne Feld', () => {
		expect(kopfIstHell('#f4f1eb')).toBe(true);
		expect(portalLogo('#f4f1eb', beide)).toEqual({ variante: 'briefkopf', feld: null });
		expect(portalLogo('#f4f1eb', { briefkopf: false, dunkel: true })).toEqual({ variante: 'dunkel', feld: 'dunkel' });
	});
	it('Standard (Jamil msg 6546): weißer Kopf → normales Logo ohne Feld', () => {
		expect(kopfIstHell(null)).toBe(true);
		expect(portalLogo(null, beide)).toEqual({ variante: 'briefkopf', feld: null });
	});
	it('dunkler Kopf (z. B. Anthrazit): helle Variante ohne Feld, sonst normales Logo auf weißem Feld', () => {
		expect(kopfIstHell('#2d2c2e')).toBe(false);
		expect(portalLogo('#2d2c2e', beide)).toEqual({ variante: 'dunkel', feld: null });
		expect(portalLogo('#1f2430', { briefkopf: true, dunkel: false })).toEqual({ variante: 'briefkopf', feld: 'weiss' });
	});
	it('ohne Logo: keins', () => {
		expect(portalLogo('#f4f1eb', { briefkopf: false, dunkel: false })).toBeNull();
		expect(portalLogo('#2d2c2e', { briefkopf: false, dunkel: false })).toBeNull();
	});
});
