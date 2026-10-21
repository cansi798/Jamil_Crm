import { describe, expect, it } from 'vitest';
import { MAX_SCHRITTE, pruefeAktion, SCHRITT_AKTIONEN, SchemaFehler } from '../../src/lib/server/sprache/aktionen';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { mehrereAufrufe } from '../../src/lib/server/ki/openai-kompatibel';
import { ersetzePlatzhalter } from '../../src/lib/server/sprache/mehrschritt';

const kontext = { heute: '2026-10-21', wochentag: 'Mittwoch' };

/** Mehrere Schritte in einem Satz (Jamil msg 2983): Schema, Ersatz-KI, mehrere Werkzeugaufrufe, Platzhalter. */
describe('Mehrere Schritte', () => {
	it('prüft jeden Schritt wie eine einzelne Aktion; ein Schritt wird zur normalen Aktion', () => {
		const a = pruefeAktion({
			aktion: 'mehrere_schritte',
			daten: {
				schritte: [
					{ aktion: 'kunde_anlegen', daten: { art: 'privat', nachname: 'Müller' } },
					{ aktion: 'auftrag_anlegen', daten: { titel: 'Badsanierung', kunde: { name: '#1' } } }
				]
			}
		});
		expect(a).toEqual({
			aktion: 'mehrere_schritte',
			daten: {
				schritte: [
					{ aktion: 'kunde_anlegen', daten: { art: 'privat', nachname: 'Müller' } },
					{ aktion: 'auftrag_anlegen', daten: { titel: 'Badsanierung', kunde: { name: '#1' } } }
				]
			}
		});
		expect(pruefeAktion({ aktion: 'mehrere_schritte', daten: { schritte: [{ aktion: 'kunde_anlegen', daten: { art: 'firma', firma: 'Bau GmbH' } }] } })).toEqual({
			aktion: 'kunde_anlegen',
			daten: { art: 'firma', firma: 'Bau GmbH' }
		});
	});

	it('lehnt Fragen, Angebotsentwurf, Verschachtelung, falsche Felder und leere Listen ab', () => {
		const mit = (schritt: unknown) => () => pruefeAktion({ aktion: 'mehrere_schritte', daten: { schritte: [{ aktion: 'kunde_anlegen', daten: { art: 'privat', nachname: 'A' } }, schritt] } });
		expect(mit({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'heute' } })).toThrow(SchemaFehler);
		expect(mit({ aktion: 'angebot_entwurf', daten: { auftrag: 'x', stichworte: 'y' } })).toThrow(SchemaFehler);
		expect(mit({ aktion: 'mehrere_schritte', daten: { schritte: [] } })).toThrow(SchemaFehler);
		expect(mit({ aktion: 'auftrag_anlegen', daten: { titel: 'X' } })).toThrow(/Schritt 2: .*kunde/);
		expect(() => pruefeAktion({ aktion: 'mehrere_schritte', daten: { schritte: [] } })).toThrow(SchemaFehler);
		expect(() => pruefeAktion({ aktion: 'mehrere_schritte', daten: { schritte: [], extra: 1 } })).toThrow(SchemaFehler);
		expect(SCHRITT_AKTIONEN).not.toContain('angebot_entwurf');
		expect(MAX_SCHRITTE).toBe(8);
	});

	it('Ersatz-KI: Beispielsatz → drei Schritte mit Verweisen „#1“, „#2“; Einzelbefehle bleiben einzeln', async () => {
		const ki = new FakeKi();
		expect(await ki.aktionAusText('Leg Kunde Müller an, mach einen Auftrag Badsanierung und plan Murat für Montag ein.', kontext)).toEqual({
			aktion: 'mehrere_schritte',
			daten: {
				schritte: [
					{ aktion: 'kunde_anlegen', daten: { art: 'privat', nachname: 'Müller' } },
					{ aktion: 'auftrag_anlegen', daten: { titel: 'Badsanierung', kunde: { name: '#1' } } },
					{ aktion: 'einsatz_anlegen', daten: { start: { tag: 'wochentag', wochentag: 'montag' }, mitarbeiter: ['Murat'], auftrag: '#2' } }
				]
			}
		});
		expect((await ki.aktionAusText('Termin bei Becker morgen 8 Uhr mit Ali und Mehmet', kontext)).aktion).toBe('einsatz_anlegen');
		expect((await ki.aktionAusText('Neue Aufgabe für Murat: Silikonfuge erneuern, bis Freitag', kontext)).aktion).toBe('todo_anlegen');
		expect((await ki.aktionAusText('Weise Ali und Murat dem Auftrag Müller zu', kontext)).aktion).toBe('mitarbeiter_zuweisen');
	});

	it('mehrere Werkzeugaufrufe einer OpenAI-kompatiblen Antwort → mehrere_schritte', () => {
		const antwort = {
			choices: [
				{
					message: {
						tool_calls: [
							{ function: { name: 'kunde_anlegen', arguments: '{"art":"privat","nachname":"Müller"}' } },
							{ function: { name: 'auftrag_anlegen', arguments: { titel: 'Bad', kunde: { name: '#1' } } } }
						]
					}
				}
			]
		};
		const m = mehrereAufrufe(antwort)!;
		expect(pruefeAktion(m)).toMatchObject({ aktion: 'mehrere_schritte', daten: { schritte: [{ aktion: 'kunde_anlegen' }, { aktion: 'auftrag_anlegen' }] } });
		expect(mehrereAufrufe({ choices: [{ message: { tool_calls: [{ function: { name: 'kunde_anlegen', arguments: '{}' } }] } }] })).toBeNull();
	});

	it('Platzhalter werden durch die IDs früherer Schritte ersetzt', () => {
		const ergebnisse = new Map([
			[1, { kundeId: 'k-1' }],
			[2, { auftragId: 'a-2', kundeId: 'k-1' }]
		]);
		expect(ersetzePlatzhalter({ kundeId: '$kunde:1', x: ['$auftrag:2', '$auftrag:x'], n: 3, e: [{ auftragId: '$auftrag:2' }] }, ergebnisse)).toEqual({
			kundeId: 'k-1',
			x: ['a-2', '$auftrag:x'],
			n: 3,
			e: [{ auftragId: 'a-2' }]
		});
		expect(() => ersetzePlatzhalter('$auftrag:3', ergebnisse)).toThrow();
	});
});
