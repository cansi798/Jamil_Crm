import { describe, expect, it } from 'vitest';
import { deute } from '../../src/lib/server/ki/fake';
import { NUR_LESEN, SCHRITT_AKTIONEN, pruefeAktion } from '../../src/lib/server/sprache/aktionen';

const kontext = { heute: '2026-11-15', wochentag: 'sonntag', uhrzeit: '10:00' } as never;

/** Sprachaktionen Lexware Phase 3 (STANDING RULE): Rechnung erstellen/senden, Mahnung pausieren, offene Rechnungen, bezahlt? */
describe('Sprache: Rechnungen und Mahnungen', () => {
	it('Fake-KI erkennt die Sätze', () => {
		expect(deute('Rechnung zu Auftrag Müller erstellen', kontext)).toEqual({ aktion: 'rechnung_erstellen', daten: { auftrag: 'Müller' } });
		expect(deute('Mach die Rechnung für Auftrag A-2026-0031', kontext)).toEqual({ aktion: 'rechnung_erstellen', daten: { auftrag: 'A-2026-0031' } });
		expect(deute('Rechnung RE0042 senden', kontext)).toEqual({ aktion: 'rechnung_senden', daten: { rechnung: 'RE0042' } });
		expect(deute('Schick die Rechnung an Müller', kontext)).toEqual({ aktion: 'rechnung_senden', daten: { rechnung: 'Müller' } });
		expect(deute('Welche Rechnungen sind überfällig?', kontext)).toEqual({ aktion: 'abfrage_offene_rechnungen', daten: { filter: 'ueberfaellig' } });
		expect(deute('Wer schuldet uns noch Geld?', kontext)).toEqual({ aktion: 'abfrage_offene_rechnungen', daten: { filter: 'offen' } });
		expect(deute('Hat Kunde Müller bezahlt?', kontext)).toEqual({ aktion: 'abfrage_zahlstatus', daten: { kunde: 'Müller' } });
		expect(deute('Keine Mahnung an Müller bis Monatsende', kontext)).toEqual({ aktion: 'mahnung_pausieren', daten: { rechnung: 'Müller', bis: '2026-11-30' } });
		expect(deute('Mahnungen für Schmidt pausieren bis 10.12.', kontext)).toEqual({ aktion: 'mahnung_pausieren', daten: { rechnung: 'Schmidt', bis: '2026-12-10' } });
	});
	it('Schemas: Fragen ohne Rückfrage, speichernde Aktionen mit Rückfrage; bis nur als Datum', () => {
		for (const a of ['abfrage_offene_rechnungen', 'abfrage_zahlstatus']) expect(NUR_LESEN as readonly string[]).toContain(a);
		for (const a of ['rechnung_erstellen', 'rechnung_senden', 'mahnung_pausieren']) {
			expect(NUR_LESEN as readonly string[]).not.toContain(a);
			expect(SCHRITT_AKTIONEN as readonly string[]).toContain(a);
		}
		expect(pruefeAktion({ aktion: 'mahnung_pausieren', daten: { rechnung: 'Müller', bis: '' } })).toBeTruthy();
		expect(() => pruefeAktion({ aktion: 'mahnung_pausieren', daten: { rechnung: 'Müller', bis: '30.11.' } })).toThrow();
		expect(() => pruefeAktion({ aktion: 'abfrage_offene_rechnungen', daten: { filter: 'alles' } })).toThrow();
	});
});
