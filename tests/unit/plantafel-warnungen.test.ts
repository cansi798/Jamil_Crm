import { describe, expect, it } from 'vitest';
import { berechneWarnungen } from '../../src/lib/server/plantafel';
import { berlinZeitpunkt } from '../../src/lib/zeit';

const ALI = 'ali';
const MEHMET = 'mehmet';

type Uhr = [number, number];

/** Neuer Einsatz (ohne ID) an einem Berliner Tag von–bis (Stunden, Minuten). */
const neu = (benutzerId: string, tag: string, von: Uhr, bis: Uhr, bisTag = tag) => ({
	benutzerId,
	beginn: berlinZeitpunkt(tag, von[0], von[1]),
	ende: berlinZeitpunkt(bisTag, bis[0], bis[1])
});
/** Gespeicherter Einsatz mit ID. */
const e = (id: string, benutzerId: string, tag: string, von: Uhr, bis: Uhr, bisTag = tag) => ({
	id,
	...neu(benutzerId, tag, von, bis, bisTag)
});

describe('berechneWarnungen', () => {
	it('angrenzend (10–12 und 12–14) ist keine Doppelbelegung', () => {
		const einsatz = neu(ALI, '2026-10-21', [12, 0], [14, 0]);
		expect(berechneWarnungen(einsatz, [e('a', ALI, '2026-10-21', [10, 0], [12, 0])], [])).toEqual([]);
	});

	it('eine Minute Überlappung (10–12 und 11:59–13) ist eine Doppelbelegung', () => {
		const einsatz = neu(ALI, '2026-10-21', [11, 59], [13, 0]);
		expect(berechneWarnungen(einsatz, [e('a', ALI, '2026-10-21', [10, 0], [12, 0])], [])).toEqual([
			{ art: 'doppelt', einsatzId: 'a' }
		]);
	});

	it('anderer Mitarbeiter, gleiche Zeit → keine Warnung; derselbe Einsatz (beim Verschieben) zählt nicht', () => {
		const einsatz = e('x', ALI, '2026-10-21', [10, 0], [12, 0]);
		expect(berechneWarnungen(einsatz, [e('a', MEHMET, '2026-10-21', [10, 0], [12, 0])], [])).toEqual([]);
		expect(berechneWarnungen(einsatz, [e('x', ALI, '2026-10-21', [9, 0], [11, 0])], [])).toEqual([]);
	});

	it('Urlaub 20.–24.10. warnt für einen Einsatz am 24.10. 15–17 Uhr, nicht für den 25.10.', () => {
		const urlaub = [{ id: 'u', benutzerId: ALI, art: 'urlaub', von: '2026-10-20', bis: '2026-10-24' }];
		expect(berechneWarnungen(neu(ALI, '2026-10-24', [15, 0], [17, 0]), [], urlaub)).toEqual([
			{ art: 'urlaub', abwesenheitId: 'u' }
		]);
		expect(berechneWarnungen(neu(ALI, '2026-10-25', [8, 0], [10, 0]), [], urlaub)).toEqual([]);
		expect(berechneWarnungen(neu(ALI, '2026-10-19', [8, 0], [10, 0]), [], urlaub)).toEqual([]);
		expect(berechneWarnungen(neu(ALI, '2026-10-20', [0, 0], [1, 0]), [], urlaub)).toEqual([
			{ art: 'urlaub', abwesenheitId: 'u' }
		]);
		// Einsatz endet genau um Mitternacht des 20.10. → gehört nur zum 19.10.
		expect(berechneWarnungen(neu(ALI, '2026-10-19', [20, 0], [0, 0], '2026-10-20'), [], urlaub)).toEqual([]);
		// anderer Mitarbeiter
		expect(berechneWarnungen(neu(MEHMET, '2026-10-22', [8, 0], [10, 0]), [], urlaub)).toEqual([]);
	});

	it('Krankheit und Sonstiges werden mit ihrer Art gemeldet; mehrere Warnungen zugleich', () => {
		const abw = [
			{ id: 'k', benutzerId: ALI, art: 'krank', von: '2026-10-21', bis: '2026-10-21' },
			{ id: 's', benutzerId: ALI, art: 'sonstiges', von: '2026-10-21', bis: '2026-10-23' }
		];
		const einsatz = neu(ALI, '2026-10-21', [8, 0], [10, 0]);
		expect(berechneWarnungen(einsatz, [e('a', ALI, '2026-10-21', [9, 0], [11, 0])], abw)).toEqual([
			{ art: 'doppelt', einsatzId: 'a' },
			{ art: 'krank', abwesenheitId: 'k' },
			{ art: 'sonstiges', abwesenheitId: 's' }
		]);
	});

	it('Einsatz in der Umstellungsnacht (25.10. 01:00–03:00 Berlin) gehört zum 25.10.', () => {
		const einsatz = neu(ALI, '2026-10-25', [1, 0], [3, 0]);
		expect(einsatz.ende.getTime() - einsatz.beginn.getTime()).toBe(3 * 3.6e6); // 3 Stunden wegen der doppelten Stunde
		const am25 = [{ id: 'u', benutzerId: ALI, art: 'urlaub', von: '2026-10-25', bis: '2026-10-25' }];
		const am24 = [{ id: 'v', benutzerId: ALI, art: 'urlaub', von: '2026-10-24', bis: '2026-10-24' }];
		expect(berechneWarnungen(einsatz, [], am25)).toEqual([{ art: 'urlaub', abwesenheitId: 'u' }]);
		expect(berechneWarnungen(einsatz, [], am24)).toEqual([]);
	});
});
