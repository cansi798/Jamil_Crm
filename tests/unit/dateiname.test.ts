import { describe, expect, it } from 'vitest';
import { anzeigeDateiname, istKennungsName } from '../../src/lib/dateiname';

/** Lesbare Dateinamen statt Kennungen (Jamil msg 3133). */
describe('Anzeigename von Dateien', () => {
	const zeit = '2026-10-21T12:32:00Z'; // 14:32 in Berlin
	it('UUID- und Kamera-Namen werden zu „Foto vom …“, echte Namen bleiben', () => {
		expect(istKennungsName('a7e7637e-9935-4924-bb59-d561c0dd5eca.JPG')).toBe(true);
		expect(anzeigeDateiname('a7e7637e-9935-4924-bb59-d561c0dd5eca.JPG', 'image/jpeg', zeit)).toBe('Foto vom 21.10.2026, 14:32');
		expect(anzeigeDateiname('0f3c9a1b2c3d4e5f60718293a4b5c6d7.pdf', 'application/pdf', zeit)).toBe('PDF vom 21.10.2026, 14:32');
		expect(anzeigeDateiname('image.png', 'image/png', new Date(zeit))).toBe('Foto vom 21.10.2026, 14:32');
		expect(anzeigeDateiname('Grundriss Bad.pdf', 'application/pdf', zeit)).toBe('Grundriss Bad.pdf');
		expect(anzeigeDateiname('Gewächshaus Fundament.jpg', 'image/jpeg', zeit)).toBe('Gewächshaus Fundament.jpg');
		expect(istKennungsName('Angebot-2026-0001.pdf')).toBe(false);
	});
});
