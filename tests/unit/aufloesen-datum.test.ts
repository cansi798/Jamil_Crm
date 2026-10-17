import { describe, expect, it } from 'vitest';
import { einsatzZeitraum, loeseTag } from '../../src/lib/server/sprache/aufloesen';

/** Berliner Wanduhr → Date (Hilfe für lesbare Tests). */
const berlin = (iso: string) => new Date(iso);

describe('Zeitangaben der KI in Berlin-Zeit auflösen', () => {
	it('heute, morgen, übermorgen nach Berliner Kalendertag', () => {
		const jetzt = berlin('2026-10-21T10:00:00+02:00'); // Mittwoch
		expect(loeseTag({ tag: 'heute' }, jetzt)).toBe('2026-10-21');
		expect(loeseTag({ tag: 'morgen' }, jetzt)).toBe('2026-10-22');
		expect(loeseTag({ tag: 'uebermorgen' }, jetzt)).toBe('2026-10-23');
		// 23:30 Uhr Berlin ist in UTC schon/noch ein anderer Tag – zählt Berlin
		const spaet = berlin('2026-10-21T23:30:00+02:00');
		expect(loeseTag({ tag: 'heute' }, spaet)).toBe('2026-10-21');
		expect(loeseTag({ tag: 'morgen' }, spaet)).toBe('2026-10-22');
		const frueh = berlin('2026-10-22T00:15:00+02:00'); // = 21.10. 22:15 UTC
		expect(loeseTag({ tag: 'heute' }, frueh)).toBe('2026-10-22');
	});

	it('„Montag“ = nächster Montag, heute ausgeschlossen', () => {
		const montag = berlin('2026-10-19T09:00:00+02:00');
		expect(loeseTag({ tag: 'wochentag', wochentag: 'montag' }, montag)).toBe('2026-10-26');
		expect(loeseTag({ tag: 'wochentag', wochentag: 'dienstag' }, montag)).toBe('2026-10-20');
		expect(loeseTag({ tag: 'wochentag', wochentag: 'sonntag' }, montag)).toBe('2026-10-25');
		const samstag = berlin('2026-10-17T12:00:00+02:00');
		expect(loeseTag({ tag: 'wochentag', wochentag: 'montag' }, samstag)).toBe('2026-10-19');
		expect(loeseTag({ tag: 'wochentag', wochentag: 'samstag' }, samstag)).toBe('2026-10-24');
	});

	it('Datum bleibt, wie gesagt', () => {
		expect(loeseTag({ tag: 'datum', datum: '2026-11-05' }, berlin('2026-10-17T12:00:00+02:00'))).toBe('2026-11-05');
	});

	it('Review Focus 3: „morgen 8 Uhr“ am Sa 24.10.2026 23:30 → So 25.10. 08:00 Berlin (Zeitumstellungsnacht)', () => {
		const jetzt = berlin('2026-10-24T23:30:00+02:00');
		expect(loeseTag({ tag: 'morgen' }, jetzt)).toBe('2026-10-25');
		const z = einsatzZeitraum('2026-10-25', '08:00');
		// am 25.10. gilt ab 03:00 wieder MEZ (UTC+1): 08:00 Berlin = 07:00 UTC
		expect(z.beginn.toISOString()).toBe('2026-10-25T07:00:00.000Z');
		expect(z.ende.toISOString()).toBe('2026-10-25T15:00:00.000Z');
	});

	it('Einsatzzeitraum: Standard 07:00, Dauer 8 Stunden; Ende aus „bis“; Ende vor Beginn → Fehler', () => {
		const standard = einsatzZeitraum('2026-10-21');
		expect(standard.beginn.toISOString()).toBe('2026-10-21T05:00:00.000Z');
		expect(standard.ende.toISOString()).toBe('2026-10-21T13:00:00.000Z');
		const bis = einsatzZeitraum('2026-10-21', '08:00', '12:30');
		expect(bis.ende.toISOString()).toBe('2026-10-21T10:30:00.000Z');
		expect(() => einsatzZeitraum('2026-10-21', '12:00', '08:00')).toThrow(/Ende/);
		// Beginn 20 Uhr ohne Ende: 8 Stunden würden über Mitternacht reichen – erlaubt (≤ 14 h)
		expect(einsatzZeitraum('2026-10-21', '20:00').ende.toISOString()).toBe('2026-10-22T02:00:00.000Z');
	});
});
