import { describe, expect, it } from 'vitest';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { pruefeAktion } from '../../src/lib/server/sprache/aktionen';

const kontext = { heute: '2026-10-17', wochentag: 'Samstag' };

/** Neue Sprachaktionen (Jamil msgs 2645/2647) mit der regelbasierten Ersatz-KI. */
describe('Sprache: neue Aktionen (Ersatz-KI)', () => {
	const ki = new FakeKi();
	const deute = (t: string) => ki.aktionAusText(t, kontext);

	it('Mitarbeiter zuweisen', async () => {
		expect(await deute('Weise Ali und Murat dem Auftrag Müller zu')).toEqual({
			aktion: 'mitarbeiter_zuweisen',
			daten: { auftrag: 'Müller', mitarbeiter: ['Ali', 'Murat'] }
		});
	});

	it('Status ändern und „weiter“', async () => {
		expect(await deute('Setze Auftrag Müller auf in Arbeit')).toEqual({ aktion: 'status_aendern', daten: { auftrag: 'Müller', status: 'in_arbeit' } });
		expect(await deute('Auftrag Badsanierung weiter')).toEqual({ aktion: 'status_aendern', daten: { auftrag: 'Badsanierung', status: 'weiter' } });
	});

	it('To-do abhaken', async () => {
		expect(await deute('Hake das To-do Material holen ab')).toEqual({ aktion: 'todo_abhaken', daten: { titel: 'Material holen' } });
		expect(await deute('Silikon besorgen ist erledigt')).toEqual({ aktion: 'todo_abhaken', daten: { titel: 'Silikon besorgen' } });
	});

	it('Wiederkehrendes To-do', async () => {
		expect(await deute('Neues To-do: Filter wechseln alle 2 Wochen')).toMatchObject({
			aktion: 'todo_anlegen',
			daten: { titel: 'Filter wechseln', wiederholung: 'woechentlich', intervall: 2 }
		});
		expect(await deute('To-do jährlich Heizung warten bei Müller')).toMatchObject({ aktion: 'todo_anlegen', daten: { wiederholung: 'jaehrlich' } });
	});

	it('Anlage anlegen mit Typ, Hersteller und Wartung', async () => {
		expect(await deute('Neue Wärmepumpe bei Müller, Hersteller Vaillant, Wartung jährlich')).toEqual({
			aktion: 'anlage_anlegen',
			daten: { typ: 'waermepumpe', hersteller: 'Vaillant', wartung: 'jaehrlich', kunde: { name: 'Müller' } }
		});
	});

	it('Nachfassen pausieren / fortsetzen', async () => {
		expect(await deute('Nachfassen für Angebot AN-2026-0007 pausieren')).toEqual({ aktion: 'nachfassen_pausieren', daten: { angebot: 'AN-2026-0007' } });
		expect(await deute('Nachfassen bei Müller wieder fortsetzen')).toEqual({ aktion: 'nachfassen_pausieren', daten: { angebot: 'Müller', fortsetzen: true } });
	});

	it('Fragen: Tagesplan (ohne Bestätigung)', async () => {
		expect(await deute('Was steht heute für mich an?')).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'heute' } });
		expect(await deute('Was hat Sabine morgen?')).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'morgen', wer: 'Sabine' } });
		expect(await deute('Was habe ich diese Woche?')).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'woche' } });
		expect(await deute('Welche To-dos sind überfällig?')).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'heute', nur_ueberfaellig: true } });
	});

	it('Schemas: Status nur aus der Liste, Anlage-Typ geprüft', () => {
		expect(() => pruefeAktion({ aktion: 'status_aendern', daten: { auftrag: 'x', status: 'fertig' } })).toThrow();
		expect(() => pruefeAktion({ aktion: 'anlage_anlegen', daten: { kunde: { name: 'x' }, typ: 'atom' } })).toThrow();
		expect(() => pruefeAktion({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'jahr' } })).toThrow();
	});
});
