import { describe, expect, it } from 'vitest';
import { AKTIONEN, AKTIONS_SCHEMAS, pruefeAktion, pruefeEntwurf, werkzeuge } from '../../src/lib/server/sprache/aktionen';

describe('Aktions-Schema', () => {
	it('Aktionen aus dem Plan und die neuen (msgs 2645/2647) (+ „unbekannt” als Ausweg der KI)', () => {
		expect([...AKTIONEN]).toEqual([
			'kunde_anlegen',
			'auftrag_anlegen',
			'todo_anlegen',
			'einsatz_anlegen',
			'einsatz_verschieben',
			'angebot_entwurf',
			'protokoll_ausfuellen',
			'mitarbeiter_zuweisen',
			'status_aendern',
			'todo_abhaken',
			'anlage_anlegen',
			'nachfassen_pausieren',
			'abfrage_tagesplan'
		]);
		expect(Object.keys(AKTIONS_SCHEMAS).sort()).toEqual([...AKTIONEN, 'unbekannt'].sort());
		// Werkzeuge für Function Calling: je Aktion eine Funktion mit Parametern = Schema
		const w = werkzeuge();
		expect(w.map((x) => x.function.name).sort()).toEqual([...AKTIONEN, 'unbekannt'].sort());
		for (const x of w) {
			expect(x.type).toBe('function');
			expect(x.function.parameters).toBe(AKTIONS_SCHEMAS[x.function.name as keyof typeof AKTIONS_SCHEMAS]);
			expect(x.function.description.length).toBeGreaterThan(10);
		}
	});

	it('nimmt gültige Aktionen an', () => {
		expect(
			pruefeAktion({
				aktion: 'auftrag_anlegen',
				daten: {
					titel: 'Badsanierung',
					kunde: { name: 'Müller', ort: 'Norderstedt' },
					start: { tag: 'wochentag', wochentag: 'montag' },
					mitarbeiter: ['Ali', 'Mehmet']
				}
			})
		).toEqual({
			aktion: 'auftrag_anlegen',
			daten: {
				titel: 'Badsanierung',
				kunde: { name: 'Müller', ort: 'Norderstedt' },
				start: { tag: 'wochentag', wochentag: 'montag' },
				mitarbeiter: ['Ali', 'Mehmet']
			}
		});
		expect(pruefeAktion({ aktion: 'todo_anlegen', daten: { titel: 'Silikonfuge erneuern', zustaendig: 'Murat', faellig: { tag: 'wochentag', wochentag: 'freitag' } } }).aktion).toBe('todo_anlegen');
		expect(pruefeAktion({ aktion: 'kunde_anlegen', daten: { art: 'privat', vorname: 'Eva', nachname: 'Schulz', ort: 'Hamburg' } }).aktion).toBe('kunde_anlegen');
		expect(pruefeAktion({ aktion: 'einsatz_anlegen', daten: { auftrag: 'Müller', mitarbeiter: ['Ali'], start: { tag: 'morgen', uhrzeit: '08:00' } } }).aktion).toBe('einsatz_anlegen');
		expect(pruefeAktion({ aktion: 'einsatz_verschieben', daten: { mitarbeiter: 'Ali', nach: { tag: 'datum', datum: '2026-10-23' } } }).aktion).toBe('einsatz_verschieben');
		// nur neue Uhrzeit, kein Tag – Server greift auf bisherigen Tag zurück
		const vz = pruefeAktion({ aktion: 'einsatz_verschieben', daten: { mitarbeiter: 'Ali', nach: { uhrzeit: '10:00' } } });
		expect(vz.aktion).toBe('einsatz_verschieben');
		expect((vz as { daten: { nach: unknown } }).daten.nach).toEqual({ uhrzeit: '10:00' });
		expect(pruefeAktion({ aktion: 'angebot_entwurf', daten: { auftrag: 'Müller', stichworte: '12 m² Fliesen' } }).aktion).toBe('angebot_entwurf');
		expect(pruefeAktion({ aktion: 'unbekannt', daten: {} })).toEqual({ aktion: 'unbekannt', daten: {} });
	});

	it('lehnt Zusatzfelder ab (auch verschachtelt)', () => {
		expect(() => pruefeAktion({ aktion: 'todo_anlegen', daten: { titel: 'x', preis: 100 } })).toThrow(/preis/);
		expect(() => pruefeAktion({ aktion: 'auftrag_anlegen', daten: { titel: 'x', kunde: { name: 'M', adresse: 'y' } } })).toThrow(/adresse/);
		expect(() => pruefeAktion({ aktion: 'todo_anlegen', daten: { titel: 'x' }, extra: 1 })).toThrow();
		expect(() => pruefeAktion({ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'heute', zeitzone: 'UTC' } } })).toThrow(/zeitzone/);
	});

	it('lehnt falsche Typen, fehlende Pflichtfelder und unbekannte Werte ab', () => {
		const falsch: unknown[] = [
			null,
			'auftrag_anlegen',
			{ aktion: 'rechnung_anlegen', daten: {} },
			{ aktion: 'todo_anlegen' },
			{ aktion: 'todo_anlegen', daten: { titel: 5 } },
			{ aktion: 'todo_anlegen', daten: {} },
			{ aktion: 'todo_anlegen', daten: { titel: '' } },
			{ aktion: 'todo_anlegen', daten: { titel: 'x'.repeat(201) } },
			{ aktion: 'auftrag_anlegen', daten: { titel: 'x', kunde: 'Müller' } },
			{ aktion: 'auftrag_anlegen', daten: { titel: 'x', kunde: { name: 'M' }, mitarbeiter: 'Ali' } },
			{ aktion: 'auftrag_anlegen', daten: { titel: 'x', kunde: { name: 'M' }, mitarbeiter: [1] } },
			{ aktion: 'auftrag_anlegen', daten: { titel: 'x', kunde: { name: 'M' }, mitarbeiter: Array(11).fill('A') } },
			{ aktion: 'kunde_anlegen', daten: { art: 'verein', nachname: 'x' } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: [], start: { tag: 'morgen' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'gestern' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'morgen', uhrzeit: '25:00' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'morgen', uhrzeit: '8 Uhr' } } },
			// Querbedingungen: wochentag bzw. datum gehören zur Art der Angabe
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'wochentag' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'datum', datum: '2026-02-30' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'datum' } } },
			{ aktion: 'einsatz_anlegen', daten: { auftrag: 'M', mitarbeiter: ['A'], start: { tag: 'morgen', wochentag: 'montag' } } },
			{ aktion: 'einsatz_verschieben', daten: { mitarbeiter: 'Ali' } },
			{ aktion: 'angebot_entwurf', daten: { auftrag: 'Müller' } }
		];
		for (const x of falsch) expect(() => pruefeAktion(x), JSON.stringify(x)).toThrow();
	});

	it('Fehler sind Fehler-Objekte ohne Datenbankbezug (Meldung nennt Pfad)', () => {
		try {
			pruefeAktion({ aktion: 'todo_anlegen', daten: { titel: 'x', faellig: { tag: 'morgen', uhrzeit: 9 } } });
			expect.unreachable();
		} catch (e) {
			expect((e as Error).message).toMatch(/faellig\.uhrzeit/);
		}
	});
});

describe('Angebotsentwurf der KI (nachsichtig, aber nie mit Preisen)', () => {
	it('übernimmt Schlüssel, Menge, unsicher', () => {
		expect(pruefeEntwurf({ positionen: [{ schluessel: 'K1', menge: 12.5, unsicher: false }, { schluessel: 'K2', menge: 1, unsicher: true }] })).toEqual({
			positionen: [
				{ schluessel: 'K1', menge: 12.5, unsicher: false },
				{ schluessel: 'K2', menge: 1, unsicher: true }
			]
		});
	});

	it('Preisangaben der KI werden verworfen und die Position als unsicher markiert', () => {
		const e = pruefeEntwurf({ positionen: [{ schluessel: 'K1', menge: 3, unsicher: false, einzelpreis: 99.5 }, { schluessel: 'K2', menge: 2, preis_cent: 100 }] });
		expect(e.positionen).toEqual([
			{ schluessel: 'K1', menge: 3, unsicher: true },
			{ schluessel: 'K2', menge: 2, unsicher: true }
		]);
		expect(JSON.stringify(e)).not.toMatch(/preis/);
	});

	it('kaputte Positionen fallen weg, Menge wird auf 3 Nachkommastellen begrenzt, höchstens 200', () => {
		const e = pruefeEntwurf({
			positionen: [
				{ schluessel: 'K1', menge: -1 },
				{ schluessel: 5, menge: 1 },
				{ menge: 1 },
				{ schluessel: 'K3', menge: '2,5' },
				{ schluessel: 'K4', menge: 1.23456 },
				null,
				{ schluessel: 'K5', menge: 1e9 }
			]
		});
		expect(e.positionen).toEqual([{ schluessel: 'K4', menge: 1.235, unsicher: false }]);
		expect(pruefeEntwurf({ positionen: Array.from({ length: 250 }, (_, i) => ({ schluessel: `K${i}`, menge: 1 })) }).positionen).toHaveLength(200);
		expect(() => pruefeEntwurf({})).toThrow();
		expect(() => pruefeEntwurf(null)).toThrow();
	});
});
