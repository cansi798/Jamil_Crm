import { describe, expect, it } from 'vitest';
import { RASTERBILD, sichereDateiKopfzeilen } from '../../src/lib/server/datei-kopf';

/** Gespeicherte Dateien vom App-Ursprung: nie SVG/HTML inline (gespeichertes XSS). */
describe('Sichere Kopfzeilen für gespeicherte Dateien', () => {
	it('SVG, HTML, XML und Unbekanntes: als Download, octet-stream, nosniff, CSP mit sandbox', () => {
		for (const typ of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/javascript', 'image/heic', '']) {
			const k = sichereDateiKopfzeilen(typ, { name: 'logo.svg' });
			expect(k['content-type']).toBe('application/octet-stream');
			expect(k['content-disposition']).toMatch(/^attachment;/);
			expect(k['x-content-type-options']).toBe('nosniff');
			expect(k['content-security-policy']).toMatch(/default-src 'none'.*sandbox/);
		}
	});
	it('Rasterbilder inline mit sandbox; PDF inline ohne sandbox (Betrachter), aber nosniff', () => {
		for (const typ of ['image/png', 'image/jpeg', 'image/webp']) {
			const k = sichereDateiKopfzeilen(typ);
			expect(k['content-type']).toBe(typ);
			expect(k['content-disposition']).toBe('inline');
			expect(k['content-security-policy']).toMatch(/sandbox/);
		}
		const pdf = sichereDateiKopfzeilen('application/pdf');
		expect(pdf['content-disposition']).toBe('inline');
		expect(pdf['x-content-type-options']).toBe('nosniff');
		expect(pdf['content-security-policy']).toBeUndefined();
	});
	it('Logo-Routen: nur Rasterbilder', () => {
		expect(RASTERBILD.test('image/png')).toBe(true);
		expect(RASTERBILD.test('image/svg+xml')).toBe(false);
		expect(RASTERBILD.test('text/html')).toBe(false);
	});
});
