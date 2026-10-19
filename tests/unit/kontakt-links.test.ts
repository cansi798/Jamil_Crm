import { describe, expect, it } from 'vitest';
import { navigationsLink, telefonLink } from '../../src/lib/kontakt-links';

describe('Kontakt-Links', () => {
	it('Navigieren: Google-Maps-Route mit kodierter Adresse; ohne Adresse null', () => {
		expect(navigationsLink('Dünenweg 1, 25980 Sylt')).toBe(
			'https://www.google.com/maps/dir/?api=1&destination=D%C3%BCnenweg%201%2C%2025980%20Sylt'
		);
		expect(navigationsLink('  ')).toBeNull();
		expect(navigationsLink(null)).toBeNull();
	});

	it('Anrufen: tel: nur mit Ziffern (+ bleibt); zu kurz/leer → null', () => {
		expect(telefonLink('040 / 123 45-6')).toBe('tel:040123456');
		expect(telefonLink('+49 (40) 123456')).toBe('tel:+4940123456');
		expect(telefonLink('12')).toBeNull();
		expect(telefonLink(null)).toBeNull();
	});
});
