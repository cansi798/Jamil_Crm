import { describe, expect, it } from 'vitest';
import { deute, FakeKi, findeTag, findeUhrzeiten } from '../../src/lib/server/ki/fake';

const kontext = { heute: '2026-10-17', wochentag: 'Samstag' };

describe('FakeKi (regelbasiert)', () => {
	const ki = new FakeKi();

	it('Beispiel aus dem Pflichtenheft: Auftrag mit Tag, Mitarbeitern, Titel und Kunde', async () => {
		expect(await ki.aktionAusText('Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Müller', kontext)).toEqual({
			aktion: 'auftrag_anlegen',
			daten: {
				titel: 'Badsanierung',
				kunde: { name: 'Müller' },
				start: { tag: 'wochentag', wochentag: 'montag' },
				mitarbeiter: ['Ali', 'Mehmet']
			}
		});
	});

	it('To-do mit Zuständigem und Fälligkeit', async () => {
		expect(await ki.aktionAusText('Neues To-do für Murat: Silikonfuge erneuern, bis Freitag', kontext)).toEqual({
			aktion: 'todo_anlegen',
			daten: { titel: 'Silikonfuge erneuern', zustaendig: 'Murat', faellig: { tag: 'wochentag', wochentag: 'freitag' } }
		});
	});

	it('Termin (Einsatz) mit Uhrzeit', async () => {
		expect(await ki.aktionAusText('Termin bei Müller morgen 8 Uhr mit Ali', kontext)).toEqual({
			aktion: 'einsatz_anlegen',
			daten: { auftrag: 'Müller', mitarbeiter: ['Ali'], start: { tag: 'morgen', uhrzeit: '08:00' } }
		});
	});

	it('Angebot, Kunde, Verschieben, Unbekanntes', async () => {
		expect(await ki.aktionAusText('Erstelle ein Angebot für Müller', kontext)).toMatchObject({
			aktion: 'angebot_entwurf',
			daten: { auftrag: 'Müller' }
		});
		expect(await ki.aktionAusText('Neuer Kunde Eva Schulz aus Hamburg', kontext)).toEqual({
			aktion: 'kunde_anlegen',
			daten: { art: 'privat', vorname: 'Eva', nachname: 'Schulz', ort: 'Hamburg' }
		});
		expect(await ki.aktionAusText('Verschiebe den Termin bei Müller auf Freitag', kontext)).toEqual({
			aktion: 'einsatz_verschieben',
			daten: { auftrag: 'Müller', nach: { tag: 'wochentag', wochentag: 'freitag' } }
		});
		expect(await ki.aktionAusText('Wie wird das Wetter morgen?', kontext)).toEqual({ aktion: 'unbekannt', daten: {} });
	});

	it('Zeiten: Uhrzeiten und Tage', () => {
		expect(findeUhrzeiten('um halb neun').map((u) => u.uhrzeit)).toEqual(['08:30']);
		expect(findeUhrzeiten('um 14:30 Uhr').map((u) => u.uhrzeit)).toEqual(['14:30']);
		expect(findeUhrzeiten('von 8 bis 12 Uhr').map((u) => u.uhrzeit)).toEqual(['08:00', '12:00']);
		expect(findeUhrzeiten('um acht Uhr').map((u) => u.uhrzeit)).toEqual(['08:00']);
		expect(findeUhrzeiten('Viertel nach sieben').map((u) => u.uhrzeit)).toEqual(['07:15']);
		expect(findeTag('am 23.10.', kontext)).toEqual({ tag: 'datum', datum: '2026-10-23' });
		expect(findeTag('am 3.1.', kontext)).toEqual({ tag: 'datum', datum: '2027-01-03' });
		expect(findeTag('am 5. November', kontext)).toEqual({ tag: 'datum', datum: '2026-11-05' });
		expect(findeTag('übermorgen früh', kontext)).toEqual({ tag: 'uebermorgen' });
	});

	it('Angebotsentwurf: nur Katalogschlüssel, Menge aus dem Text, sonst unsicher', async () => {
		const e = await ki.angebotsEntwurf({
			text: '12 Quadratmeter Wandfliesen und Silikonfugen',
			katalog: [
				{ schluessel: 'K1', bezeichnung: 'Wandfliesen verlegen', einheit: 'm²', gewerk: 'fliesen' },
				{ schluessel: 'K2', bezeichnung: 'Silikonfuge erneuern', einheit: 'lfm', gewerk: 'fliesen' },
				{ schluessel: 'K3', bezeichnung: 'Raufaser tapezieren', einheit: 'm²', gewerk: 'maler' }
			]
		});
		expect(e.positionen).toEqual([
			{ schluessel: 'K1', menge: 12, unsicher: false },
			{ schluessel: 'K2', menge: 1, unsicher: true }
		]);
	});
});

describe('Test-KI: Nachkalkulation, Verlust, Kundenportal, Foto-Aufmaß (Jamil msgs 2770–2774)', () => {
	const k = { heute: '2026-10-20', wochentag: 'Dienstag' };
	it('erkennt die neuen Fragen', () => {
		expect(deute('Wie lief der Auftrag Müller?', k)).toEqual({ aktion: 'abfrage_nachkalkulation', daten: { auftrag: 'Müller' } });
		expect(deute('Nachkalkulation für Schmidt', k)).toEqual({ aktion: 'abfrage_nachkalkulation', daten: { auftrag: 'Schmidt' } });
		expect(deute('Welche Aufträge machen Verlust?', k)).toEqual({ aktion: 'abfrage_verlust', daten: {} });
		expect(deute('Kundenportal für Müller', k)).toEqual({ aktion: 'portallink_zeigen', daten: { auftrag: 'Müller' } });
		expect(deute('Foto-Aufmaß für Bad Meier', k)).toEqual({ aktion: 'foto_aufmass', daten: { auftrag: 'Bad Meier' } });
		expect(deute('Angebot Müller ist angenommen', k)).toEqual({ aktion: 'angebot_entscheidung', daten: { angebot: 'Müller', status: 'angenommen' } });
		expect(deute('Kunde Schmidt hat das Angebot abgelehnt', k)).toMatchObject({ aktion: 'angebot_entscheidung', daten: { status: 'abgelehnt' } });
	});
});
