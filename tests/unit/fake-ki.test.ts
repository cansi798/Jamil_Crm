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

	it('Aufgabe mit Zuständigem und Fälligkeit', async () => {
		expect(await ki.aktionAusText('Neue Aufgabe für Murat: Silikonfuge erneuern, bis Freitag', kontext)).toEqual({
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

	it('Leitfaden (Jamil msg 4353): öffnen, Stand, Eingaben', async () => {
		expect(await ki.aktionAusText('Leitfaden starten', kontext)).toEqual({ aktion: 'leitfaden_oeffnen', daten: {} });
		expect(await ki.aktionAusText('Leitfaden fortsetzen für Demir', kontext)).toEqual({ aktion: 'leitfaden_oeffnen', daten: { kunde: 'Demir' } });
		expect(await ki.aktionAusText('Öffne den Leitfaden bei Familie Demir', kontext)).toEqual({ aktion: 'leitfaden_oeffnen', daten: { kunde: 'Demir' } });
		expect(await ki.aktionAusText('Wie weit ist der Leitfaden bei Demir?', kontext)).toEqual({ aktion: 'abfrage_leitfaden', daten: { auftrag: 'Demir' } });
		expect(await ki.aktionAusText('Im Leitfaden: E-Mail ist max@example.org, bevorzugt per WhatsApp', kontext)).toEqual({
			aktion: 'leitfaden_eingabe',
			daten: { email: 'max@example.org', bevorzugter_kontakt: 'chat' }
		});
		expect((await ki.aktionAusText('Im Leitfaden bei Becker: Telefon ist 0171 2345678', kontext)).daten).toEqual({ telefon: '0171 2345678', kunde: 'Becker' });
		expect(await ki.aktionAusText('E-Mail ist kunde@beispiel.de', kontext)).toEqual({ aktion: 'leitfaden_eingabe', daten: { email: 'kunde@beispiel.de' } });
		// Kunde anlegen bleibt Kunde anlegen
		expect((await ki.aktionAusText('Neuer Kunde Eva Schulz aus Hamburg, bevorzugt per WhatsApp', kontext)).aktion).toBe('kunde_anlegen');
	});

	it('Kunde mit bevorzugtem Kontaktweg (Jamil msgs 4289/4291)', async () => {
		expect(await ki.aktionAusText('Neuer Kunde Eva Schulz aus Hamburg, bevorzugt per WhatsApp', kontext)).toEqual({
			aktion: 'kunde_anlegen',
			daten: { art: 'privat', vorname: 'Eva', nachname: 'Schulz', ort: 'Hamburg', bevorzugter_kontakt: 'chat' }
		});
		expect((await ki.aktionAusText('Lege Kunde Herr Peter Brandt an, möchte lieber angerufen werden', kontext)).daten).toMatchObject({
			anrede: 'Herr',
			vorname: 'Peter',
			nachname: 'Brandt',
			bevorzugter_kontakt: 'telefon'
		});
		expect((await ki.aktionAusText('Neuer Kunde Firma Holzbau Nord GmbH, Kontakt per E-Mail', kontext)).daten).toMatchObject({
			art: 'firma',
			firma: 'Holzbau Nord GmbH',
			bevorzugter_kontakt: 'email'
		});
		expect((await ki.aktionAusText('Neuer Kunde Eva Schulz aus Hamburg', kontext)).daten).not.toHaveProperty('bevorzugter_kontakt');
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

describe('Test-KI: Nachkalkulation, Verlust, Kundenportal (Jamil msgs 2770–2774; Foto-Aufmaß entfernt msg 2904)', () => {
	const k = { heute: '2026-10-20', wochentag: 'Dienstag' };
	it('erkennt die neuen Fragen', () => {
		expect(deute('Wie lief der Auftrag Müller?', k)).toEqual({ aktion: 'abfrage_nachkalkulation', daten: { auftrag: 'Müller' } });
		expect(deute('Nachkalkulation für Schmidt', k)).toEqual({ aktion: 'abfrage_nachkalkulation', daten: { auftrag: 'Schmidt' } });
		expect(deute('Welche Aufträge machen Verlust?', k)).toEqual({ aktion: 'abfrage_verlust', daten: {} });
		expect(deute('Kundenportal für Müller', k)).toEqual({ aktion: 'portallink_zeigen', daten: { auftrag: 'Müller' } });
		expect(deute('Foto-Aufmaß für Bad Meier', k).aktion).not.toBe('foto_aufmass');
		expect(deute('Angebot Müller ist angenommen', k)).toEqual({ aktion: 'angebot_entscheidung', daten: { angebot: 'Müller', status: 'angenommen' } });
		expect(deute('Kunde Schmidt hat das Angebot abgelehnt', k)).toMatchObject({ aktion: 'angebot_entscheidung', daten: { status: 'abgelehnt' } });
	});
});
