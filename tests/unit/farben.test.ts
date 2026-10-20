import { describe, expect, it } from 'vitest';
import { FARB_PALETTE, istFarbe, schriftAuf, standardFarbe, STANDARD_QUELLEN_FARBEN } from '../../src/lib/farben';

describe('Farben der Auftragsquellen', () => {
	it('Farbe prüfen', () => {
		expect(istFarbe('#0f6cbd')).toBe(true);
		expect(istFarbe('#0F6CBD')).toBe(true);
		expect(istFarbe('0f6cbd')).toBe(false);
		expect(istFarbe('#fff')).toBe(false);
		expect(istFarbe('red')).toBe(false);
		expect(istFarbe('#0f6cbd;background:url(x)')).toBe(false);
	});
	it('Vorgaben: Startliste fest (Groß/Klein egal), sonst Palette nach Position', () => {
		expect(standardFarbe('Hornbach')).toBe(STANDARD_QUELLEN_FARBEN.hornbach);
		expect(standardFarbe(' website ')).toBe('#0f6cbd');
		expect(standardFarbe('Instagram', 3)).toBe(FARB_PALETTE[3]);
		expect(standardFarbe('Instagram', FARB_PALETTE.length + 1)).toBe(FARB_PALETTE[1]);
		expect(new Set(Object.values(STANDARD_QUELLEN_FARBEN)).size).toBe(8);
	});
	it('Schrift: weiß auf dunklen, dunkel auf hellen Farben; alle Vorgaben lesbar mit weiß oder dunkel', () => {
		expect(schriftAuf('#0f6cbd')).toBe('#ffffff');
		expect(schriftAuf('#ffd335')).toBe('#1c1f23');
		expect(schriftAuf('#ffffff')).toBe('#1c1f23');
		expect(schriftAuf('kaputt')).toBe('#1c1f23');
	});
});
