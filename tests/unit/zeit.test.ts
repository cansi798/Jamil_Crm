import { describe, expect, it } from 'vitest';
import { berlinTag, tagesGrenzen, verschiebeAufTag, wocheVon } from '../../src/lib/zeit';

const stunden = (g: { beginn: Date; ende: Date }) => (g.ende.getTime() - g.beginn.getTime()) / 3.6e6;

describe('Berlin-Zeit', () => {
	it('berlinTag: Kalendertag in Europe/Berlin, auch um Mitternacht und in der Umstellungsnacht', () => {
		expect(berlinTag(new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25'); // 23:30 MEZ
		expect(berlinTag(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25'); // 00:30 MESZ
		expect(berlinTag(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26'); // 00:00 MEZ
		expect(berlinTag(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25'); // 02:30 MESZ
		expect(berlinTag(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25'); // 02:30 MEZ (zweites Mal)
		expect(berlinTag(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
		expect(berlinTag(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
		expect(berlinTag(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
	});

	it('tagesGrenzen: Berliner Mitternacht bis nächste Mitternacht (23/24/25 Stunden)', () => {
		const herbst = tagesGrenzen('2026-10-25');
		expect(herbst.beginn.toISOString()).toBe('2026-10-24T22:00:00.000Z');
		expect(herbst.ende.toISOString()).toBe('2026-10-25T23:00:00.000Z');
		expect(stunden(herbst)).toBe(25);
		expect(stunden(tagesGrenzen('2026-03-29'))).toBe(23);
		expect(tagesGrenzen('2026-03-29').beginn.toISOString()).toBe('2026-03-28T23:00:00.000Z');
		expect(stunden(tagesGrenzen('2026-10-21'))).toBe(24);
		expect(tagesGrenzen('2026-12-01').beginn.toISOString()).toBe('2026-11-30T23:00:00.000Z');
	});

	it('tagesGrenzen lehnt ungültige Tage ab', () => {
		for (const t of ['2026-02-30', '2026-13-01', '26-10-21', '2026-10-21T00:00', '']) {
			expect(() => tagesGrenzen(t), t).toThrow();
		}
	});

	it('wocheVon: Montag bis Sonntag der Woche, die den Tag enthält', () => {
		const woche = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
		expect(wocheVon('2026-10-21')).toEqual(woche);
		expect(wocheVon('2026-10-19')).toEqual(woche);
		expect(wocheVon('2026-10-25')).toEqual(woche);
		expect(wocheVon('2026-10-26')).toEqual([
			'2026-10-26',
			'2026-10-27',
			'2026-10-28',
			'2026-10-29',
			'2026-10-30',
			'2026-10-31',
			'2026-11-01'
		]);
		expect(wocheVon('2027-01-01')[0]).toBe('2026-12-28');
	});

	it('verschiebeAufTag behält Berliner Uhrzeit und Dauer, auch über die Zeitumstellung', () => {
		const v = verschiebeAufTag(new Date('2026-10-23T06:00:00Z'), new Date('2026-10-23T10:00:00Z'), '2026-10-26');
		expect(v.beginn.toISOString()).toBe('2026-10-26T07:00:00.000Z'); // 08:00 Berlin bleibt 08:00 nach Umstellung
		expect(v.ende.getTime() - v.beginn.getTime()).toBe(4 * 3.6e6);
		// zurück in die Sommerzeit
		const z = verschiebeAufTag(v.beginn, v.ende, '2026-10-20');
		expect(z.beginn.toISOString()).toBe('2026-10-20T06:00:00.000Z');
		// gleicher Tag: unverändert
		const g = verschiebeAufTag(new Date('2026-10-21T13:15:00Z'), new Date('2026-10-21T15:00:00Z'), '2026-10-21');
		expect(g.beginn.toISOString()).toBe('2026-10-21T13:15:00.000Z');
		expect(g.ende.toISOString()).toBe('2026-10-21T15:00:00.000Z');
	});
});
