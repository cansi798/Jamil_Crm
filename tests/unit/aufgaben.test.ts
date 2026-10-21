import { describe, expect, it } from 'vitest';
import { personenMitVorschlag, titelSchluessel, vorlageAufteilen, zeitraumText } from '../../src/lib/aufgaben';

/** Helfer für Aufgaben: Zeitraum-Text, Mitarbeiter-Vorschläge, „Aus Vorlage übernehmen“ (Jamil msgs 2975/2977/2978). */
describe('Aufgaben-Helfer', () => {
	it('Zeitraum als Text: ein Tag, mit Uhrzeit, von–bis', () => {
		expect(zeitraumText({ faellig: null })).toBeNull();
		expect(zeitraumText({ faellig: '2026-10-21' })).toBe('21.10.2026');
		expect(zeitraumText({ faellig: '2026-10-21', faelligZeit: '10:00' })).toBe('21.10.2026 10:00');
		expect(zeitraumText({ faellig: '2026-10-21', vonTag: '2026-10-19' })).toBe('Mo 19.10. – Mi 21.10.');
		expect(zeitraumText({ faellig: '2026-10-21', faelligZeit: '16:00', vonTag: '2026-10-19', vonZeit: '07:30' })).toBe('Mo 19.10. 07:30 – Mi 21.10. 16:00');
		expect(zeitraumText({ faellig: '2026-10-21', faelligZeit: '12:00', vonTag: '2026-10-21', vonZeit: '08:00' })).toBe('Mi 21.10. 08:00 – 12:00');
	});

	it('Mitarbeiter des Auftrags stehen als Vorschlag oben, alle bleiben wählbar', () => {
		const alle = [
			{ id: 'a', name: 'Ali' },
			{ id: 'm', name: 'Murat' },
			{ id: 's', name: 'Sabine' }
		];
		expect(personenMitVorschlag(alle, [])).toEqual(alle);
		expect(personenMitVorschlag(alle, [{ id: 's', name: 'Sabine' }])).toEqual([
			{ id: 's', name: 'Sabine', gruppe: 'Am Auftrag' },
			{ id: 'a', name: 'Ali', gruppe: 'Weitere Mitarbeiter' },
			{ id: 'm', name: 'Murat', gruppe: 'Weitere Mitarbeiter' }
		]);
	});

	it('Vorlage aufteilen: nur fehlende (Standard) oder alle; Titelvergleich ohne Groß/klein und Leerzeichen', () => {
		const vorlage = [{ titel: 'Fliesen legen' }, { titel: 'Silikon  fugen' }, { titel: 'Abnahme' }];
		const vorhanden = ['silikon fugen ', 'Material bestellen'];
		expect(titelSchluessel(' Silikon   Fugen ')).toBe('silikon fugen');
		const f = vorlageAufteilen(vorlage, vorhanden, 'fehlende');
		expect(f.neu.map((t) => t.titel)).toEqual(['Fliesen legen', 'Abnahme']);
		expect(f.doppelt.map((t) => t.titel)).toEqual(['Silikon  fugen']);
		const a = vorlageAufteilen(vorlage, vorhanden, 'alle');
		expect(a.neu).toHaveLength(3);
		expect(a.doppelt).toHaveLength(1);
		expect(vorlageAufteilen(vorlage, [], 'fehlende').neu).toHaveLength(3);
	});
});
