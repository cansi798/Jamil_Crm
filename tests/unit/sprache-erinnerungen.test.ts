import { describe, expect, it } from 'vitest';
import { FakeKi } from '../../src/lib/server/ki/fake';

const kontext = { heute: '2026-10-20', wochentag: 'Dienstag' };

/** Sprache mit Erinnerungen (Jamil msgs 2679/2682) – Ersatz-KI. */
describe('Sprache: Erinnerungen und eigene Termine', () => {
	const ki = new FakeKi();
	const deute = (t: string) => ki.aktionAusText(t, kontext);

	it('Aufgabe mit Uhrzeit und zwei Erinnerungen', async () => {
		expect(await deute('Erstelle Aufgabe Material bestellen für Freitag 10 Uhr, erinnere mich einen Tag vorher und eine Stunde vorher')).toEqual({
			aktion: 'todo_anlegen',
			daten: {
				titel: 'Material bestellen',
				faellig: { tag: 'wochentag', wochentag: 'freitag', uhrzeit: '10:00' },
				erinnerungen: [{ vorher_minuten: 1440 }, { vorher_minuten: 60 }]
			}
		});
	});

	it('Termin beim Kunden mit Erinnerungen; fester Zeitpunkt', async () => {
		expect(await deute('Termin beim Kunden Müller Donnerstag 14 Uhr, erinnere mich einen Tag und eine Stunde vorher')).toMatchObject({
			aktion: 'einsatz_anlegen',
			daten: { auftrag: 'Müller', start: { tag: 'wochentag', wochentag: 'donnerstag', uhrzeit: '14:00' }, erinnerungen: [{ vorher_minuten: 1440 }, { vorher_minuten: 60 }] }
		});
		expect(await deute('Todo Angebot schreiben für Freitag, erinnere mich morgen um 8')).toMatchObject({
			aktion: 'todo_anlegen',
			daten: { erinnerungen: [{ zeitpunkt: { tag: 'morgen', uhrzeit: '08:00' } }] }
		});
	});

	it('Kalendereintrag ohne Auftrag; „Erinnere mich an …“ bleibt eine Aufgabe für mich', async () => {
		expect(await deute('Kalendereintrag Zahnarzt Freitag 9 Uhr')).toEqual({
			aktion: 'einsatz_anlegen',
			daten: { eigener_titel: 'Zahnarzt', start: { tag: 'wochentag', wochentag: 'freitag', uhrzeit: '09:00' } }
		});
		expect(await deute('Kalendereintrag Besprechung Steuerberater morgen 14 Uhr, erinnere mich 30 Minuten vorher')).toMatchObject({
			aktion: 'einsatz_anlegen',
			daten: { eigener_titel: 'Besprechung Steuerberater', erinnerungen: [{ vorher_minuten: 30 }] }
		});
		expect(await deute('Erinnere mich an den Anruf bei Müller morgen')).toMatchObject({ aktion: 'todo_anlegen', daten: { zustaendig: 'mich' } });
	});
});
