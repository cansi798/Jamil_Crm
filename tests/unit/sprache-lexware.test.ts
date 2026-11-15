import { describe, expect, it } from 'vitest';
import { deute } from '../../src/lib/server/ki/fake';
import { NUR_LESEN, pruefeAktion } from '../../src/lib/server/sprache/aktionen';

const kontext = { heute: '2026-11-15', wochentag: 'sonntag', uhrzeit: '10:00' } as never;

/** Sprachaktionen Lexware/Mail (STANDING RULE: jede neue Funktion bekommt eine Sprachaktion). */
describe('Sprache: Lexware und Mailversand', () => {
	it('Fake-KI erkennt die Sätze', () => {
		expect(deute('Ist Lexware verbunden?', kontext)).toEqual({ aktion: 'abfrage_lexware', daten: {} });
		expect(deute('Hängt etwas bei Lexware?', kontext)).toEqual({ aktion: 'abfrage_lexware', daten: {} });
		expect(deute('Lexware-Abgleich starten', kontext)).toEqual({ aktion: 'lexware_abgleich_starten', daten: {} });
		expect(deute('Gleiche mit Lexware ab', kontext)).toEqual({ aktion: 'lexware_abgleich_starten', daten: {} });
		expect(deute('Ist Kunde Müller in Lexware?', kontext)).toEqual({ aktion: 'abfrage_kunde_lexware', daten: { kunde: 'Müller' } });
		expect(deute('Ist Bau-Meier GmbH schon in Lexware angelegt?', kontext)).toEqual({ aktion: 'abfrage_kunde_lexware', daten: { kunde: 'Bau-Meier GmbH' } });
		expect(deute('Ist der Mailversand eingerichtet?', kontext)).toEqual({ aktion: 'abfrage_mailversand', daten: {} });
		expect(deute('Gab es Mailfehler?', kontext)).toEqual({ aktion: 'abfrage_mailversand', daten: {} });
	});
	it('Schemas prüfen die Antwort der KI; alle vier ohne Rückfrage (Frage bzw. harmloser Abgleich)', () => {
		expect(pruefeAktion({ aktion: 'abfrage_kunde_lexware', daten: { kunde: 'Müller' } })).toEqual({ aktion: 'abfrage_kunde_lexware', daten: { kunde: 'Müller' } });
		expect(() => pruefeAktion({ aktion: 'abfrage_kunde_lexware', daten: {} })).toThrow();
		for (const a of ['abfrage_lexware', 'lexware_abgleich_starten', 'abfrage_kunde_lexware', 'abfrage_mailversand']) expect(NUR_LESEN as readonly string[]).toContain(a);
	});
});
