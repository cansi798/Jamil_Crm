import { describe, expect, it } from 'vitest';
import { deute } from '../../src/lib/server/ki/fake';
import { NUR_LESEN, pruefeAktion } from '../../src/lib/server/sprache/aktionen';

const kontext = { heute: '2026-11-15', wochentag: 'sonntag', uhrzeit: '10:00' } as never;

/** Sprachaktionen Lexware Phase 2 (STANDING RULE): versenden, neue Version, Terminvorschläge, Annahme mit Termin. */
describe('Sprache: Angebote über Lexware, Terminvorschläge', () => {
	it('Fake-KI erkennt die Sätze', () => {
		expect(deute('Angebot Müller versenden', kontext)).toEqual({ aktion: 'angebot_versenden', daten: { angebot: 'Müller' } });
		expect(deute('Schick das Angebot für Schmidt raus', kontext)).toEqual({ aktion: 'angebot_versenden', daten: { angebot: 'Schmidt' } });
		expect(deute('Neue Version vom Angebot Müller', kontext)).toEqual({ aktion: 'neue_angebotsversion', daten: { angebot: 'Müller' } });
		expect(deute('Termine für das Angebot Müller: 1., 8. und 15. März', kontext)).toEqual({
			aktion: 'terminvorschlaege_setzen',
			daten: { angebot: 'Müller', termine: ['2027-03-01', '2027-03-08', '2027-03-15'] }
		});
		expect(deute('Angebot Müller ist angenommen, Termin 2', kontext)).toEqual({ aktion: 'angebot_entscheidung', daten: { angebot: 'Müller', status: 'angenommen', termin: '2' } });
		expect(deute('Angebot Müller ist angenommen', kontext)).toEqual({ aktion: 'angebot_entscheidung', daten: { angebot: 'Müller', status: 'angenommen' } });
	});
	it('Schemas: höchstens drei Termine als Datum; Termin bei der Annahme 1–3/keiner; alle mit Rückfrage', () => {
		expect(pruefeAktion({ aktion: 'terminvorschlaege_setzen', daten: { angebot: 'Müller', termine: ['2027-03-01'] } })).toBeTruthy();
		expect(() => pruefeAktion({ aktion: 'terminvorschlaege_setzen', daten: { angebot: 'Müller', termine: ['1.3.', '2027-03-08'] } })).toThrow();
		expect(() => pruefeAktion({ aktion: 'terminvorschlaege_setzen', daten: { angebot: 'M', termine: ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04'] } })).toThrow();
		expect(() => pruefeAktion({ aktion: 'angebot_entscheidung', daten: { angebot: 'Müller', status: 'angenommen', termin: '7' } })).toThrow();
		for (const a of ['angebot_versenden', 'neue_angebotsversion', 'terminvorschlaege_setzen']) expect(NUR_LESEN as readonly string[]).not.toContain(a);
	});
});
