import { describe, expect, it } from 'vitest';
import { farbStil, farbTokens, kontrast, STANDARD_FARBE } from '../../src/lib/farbe';

describe('farbTokens', () => {
	it('Standard ist Gold, Text darauf dunkel', () => {
		const t = farbTokens(null);
		expect(t['--ui-akzent']).toBe(STANDARD_FARBE);
		expect(t['--ui-akzent-auf']).toBe('#1f1e20');
	});
	it('ungültige Farbe → Gold', () => {
		expect(farbTokens('rot')['--ui-akzent']).toBe(STANDARD_FARBE);
		expect(farbTokens('#12345')['--ui-akzent']).toBe(STANDARD_FARBE);
	});
	it('dunkle Hausfarbe → weißer Text darauf', () => {
		expect(farbTokens('#1d4ed8')['--ui-akzent-auf']).toBe('#ffffff');
	});
	it('Akzenttext auf Weiß hat immer genug Kontrast', () => {
		for (const f of ['#c3a56f', '#ffd400', '#7fd1ae', '#1d4ed8', '#ffffff']) {
			expect(kontrast(farbTokens(f)['--ui-akzent-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('Text auf der Füllung ist lesbar (≥ 4,5 : 1)', () => {
		for (const f of ['#c3a56f', '#ffd400', '#1d4ed8', '#b03a2e', '#3f7d4e']) {
			const t = farbTokens(f);
			expect(kontrast(t['--ui-akzent'], t['--ui-akzent-auf'])).toBeGreaterThanOrEqual(4.5);
		}
	});
	it('Inline-Stil enthält alle Tokens', () => {
		expect(farbStil('#c3a56f')).toContain('--ui-akzent-text: #');
	});
});
