import { describe, expect, it } from 'vitest';
import { pdfFarben } from '../../src/lib/server/pdf/farben';
import { kontrast, STANDARD_FARBE } from '../../src/lib/farbe';

/** PDFs in der Hausfarbe statt Navy (Prüfbericht 21.11.2026): gleiche Tokens wie die App, immer lesbar. */
describe('PDF-Farben', () => {
	it('Standard: Logo-Beige wie die App – Schrift abgedunkelt auf ≥ 4,5 : 1, kein Navy mehr', () => {
		const f = pdfFarben(null);
		expect(f.primaer).toBe(STANDARD_FARBE);
		expect(f.akzentText.toLowerCase()).not.toBe('#05346b');
		expect(kontrast(f.akzentText, '#ffffff')).toBeGreaterThanOrEqual(4.5);
		// Schrift auf der Beige-Fläche: weiß oder fast schwarz, wie bei den Knöpfen
		expect(['#ffffff', '#1d1d1f']).toContain(f.primaerAuf);
		expect(kontrast(f.primaer, f.primaerAuf)).toBeGreaterThanOrEqual(4.5);
	});
	it('jede Hausfarbe: Akzentschrift lesbar, dunkle Grundschrift auf der zarten Fläche lesbar', () => {
		for (const farbe of ['#c3a56f', '#ffd400', '#0a7d3b', '#e30613', '#05346b', '#f5f5f5', '#000000']) {
			const f = pdfFarben(farbe);
			expect(kontrast(f.akzentText, '#ffffff'), farbe).toBeGreaterThanOrEqual(4.5);
			expect(kontrast('#1c1f23', f.flaeche), farbe).toBeGreaterThanOrEqual(4.5);
		}
	});
});
