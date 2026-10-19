import { describe, expect, it } from 'vitest';
import { naechsterTermin, regelText, pruefeRegel } from '../../src/lib/wiederholung';

describe('naechsterTermin', () => {
	it('täglich / wöchentlich mit Intervall', () => {
		expect(naechsterTermin('2026-10-19', { regel: 'taeglich', intervall: 1, startTag: '2026-10-19' })).toBe('2026-10-20');
		expect(naechsterTermin('2026-10-30', { regel: 'taeglich', intervall: 3, startTag: '2026-10-30' })).toBe('2026-11-02');
		expect(naechsterTermin('2026-10-19', { regel: 'woechentlich', intervall: 2, startTag: '2026-10-19' })).toBe('2026-11-02');
	});

	it('monatlich: Monatsende wird gekappt, ohne dass der Tag „wandert“ (Bezug ist der Starttag)', () => {
		const r = { regel: 'monatlich' as const, intervall: 1, startTag: '2026-01-31' };
		expect(naechsterTermin('2026-01-31', r)).toBe('2026-02-28');
		expect(naechsterTermin('2026-02-28', r)).toBe('2026-03-31');
		expect(naechsterTermin('2027-12-31', r)).toBe('2028-01-31');
		expect(naechsterTermin('2028-01-31', r)).toBe('2028-02-29'); // Schaltjahr
		expect(naechsterTermin('2026-10-15', { regel: 'monatlich', intervall: 3, startTag: '2026-10-15' })).toBe('2027-01-15');
	});

	it('jährlich (Wartung): 29.02. → 28.02. in Nicht-Schaltjahren', () => {
		expect(naechsterTermin('2026-10-19', { regel: 'jaehrlich', intervall: 1, startTag: '2026-10-19' })).toBe('2027-10-19');
		expect(naechsterTermin('2028-02-29', { regel: 'jaehrlich', intervall: 1, startTag: '2028-02-29' })).toBe('2029-02-28');
		expect(naechsterTermin('2026-05-01', { regel: 'jaehrlich', intervall: 2, startTag: '2026-05-01' })).toBe('2028-05-01');
	});

	it('überfällig abgehakt: der nächste Termin liegt nach heute (verpasste Termine werden übersprungen)', () => {
		const r = { regel: 'woechentlich' as const, intervall: 1, startTag: '2026-09-01' };
		expect(naechsterTermin('2026-09-01', r, '2026-10-19')).toBe('2026-10-20');
		expect(naechsterTermin('2026-10-13', r, '2026-10-19')).toBe('2026-10-20');
	});
});

describe('Regel prüfen und als Text', () => {
	it('pruefeRegel: Art, Intervall 1–365, Ende nicht vor dem Start', () => {
		expect(pruefeRegel({ regel: 'monatlich', intervall: '2', ende: '' }, '2026-10-19')).toEqual({ regel: 'monatlich', intervall: 2, ende: null });
		expect(() => pruefeRegel({ regel: 'stuendlich', intervall: '1' }, '2026-10-19')).toThrow(/Wiederholung/);
		expect(() => pruefeRegel({ regel: 'taeglich', intervall: '0' }, '2026-10-19')).toThrow(/1 bis 365/);
		expect(() => pruefeRegel({ regel: 'taeglich', intervall: '1', ende: '2026-10-01' }, '2026-10-19')).toThrow(/Ende/);
	});

	it('regelText', () => {
		expect(regelText('taeglich', 1, null)).toBe('täglich');
		expect(regelText('woechentlich', 2, null)).toBe('alle 2 Wochen');
		expect(regelText('monatlich', 1, '2027-06-30')).toBe('monatlich bis 30.06.2027');
		expect(regelText('jaehrlich', 1, null)).toBe('jährlich');
	});
});
