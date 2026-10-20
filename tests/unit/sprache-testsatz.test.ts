import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { AKTIONEN, pruefeAktion } from '../../src/lib/server/sprache/aktionen';
import { AUDIO_ORDNER, bewerte, ladeTestsatz } from '../sprache/bewertung';

describe('Testsatz 50 Sprachbefehle', () => {
	const satz = ladeTestsatz();

	it('Zusammensetzung laut Plan: 58 Befehle, je ≥ 7 pro Aktion, 5 mehrdeutige, 4 nicht unterstützte', () => {
		expect(satz.befehle).toHaveLength(58);
		expect(satz.befehle.map((b) => b.nr)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
		// Abnahme-Testsatz der Stufe 1d (mit Audio): die damaligen sieben Aktionen; neuere Aktionen prüft
		// tests/unit/sprache-neu.test.ts (Text), bis echte Aufnahmen dazukommen
		const STUFE_1D = AKTIONEN.slice(0, 7);
		expect(STUFE_1D).toEqual(['kunde_anlegen', 'auftrag_anlegen', 'todo_anlegen', 'einsatz_anlegen', 'einsatz_verschieben', 'angebot_entwurf', 'protokoll_ausfuellen']);
		for (const a of STUFE_1D) expect(satz.befehle.filter((b) => b.erwartet.aktion === a).length, a).toBeGreaterThanOrEqual(7);
		expect(satz.befehle.filter((b) => b.mehrdeutig)).toHaveLength(5);
		expect(satz.befehle.filter((b) => b.erwartet.aktion === 'unbekannt')).toHaveLength(4);
		expect(new Set(satz.befehle.map((b) => b.text)).size).toBe(58);
	});

	it('zu jedem Befehl gibt es eine Audiodatei (WAV, 16 kHz mono, klein)', () => {
		for (const b of satz.befehle) {
			const datei = join(AUDIO_ORDNER, b.audio);
			expect(existsSync(datei), datei).toBe(true);
			expect(statSync(datei).size).toBeLessThan(400 * 1024);
		}
	});

	it('erwartete Werte sind gültige Aktionen (Schema)', () => {
		for (const b of satz.befehle) {
			if (b.erwartet.aktion === 'unbekannt') continue;
			expect(AKTIONEN as readonly string[]).toContain(b.erwartet.aktion);
		}
	});

	it('Bewertung: Aktion + Kernfelder; Texte enthalten, Zeiten genau, Listen vollständig', () => {
		const soll = { aktion: 'auftrag_anlegen', felder: { titel: 'Badsanierung', 'kunde.name': 'Müller', 'start.wochentag': 'montag', mitarbeiter: ['Ali', 'Mehmet'] } };
		const gut = { aktion: 'auftrag_anlegen', daten: { titel: 'Badsanierung im OG', kunde: { name: 'Familie Müller' }, start: { tag: 'wochentag', wochentag: 'montag' }, mitarbeiter: ['Mehmet', 'Ali'] } };
		expect(bewerte(soll, gut)).toEqual({ treffer: true, abweichungen: [] });
		expect(bewerte(soll, { ...gut, aktion: 'todo_anlegen' }).treffer).toBe(false);
		expect(bewerte(soll, { ...gut, daten: { ...gut.daten, mitarbeiter: ['Ali'] } }).abweichungen).toEqual(['mitarbeiter: ["Ali"] statt ["Ali","Mehmet"]']);
		expect(bewerte(soll, { ...gut, daten: { ...gut.daten, start: { tag: 'wochentag', wochentag: 'dienstag' } } }).treffer).toBe(false);
		expect(bewerte({ aktion: 'kunde_anlegen', felder: { nachname: 'Weißenböck' } }, { aktion: 'kunde_anlegen', daten: { art: 'privat', nachname: 'Weissenböck' } }).treffer).toBe(true);
	});

	it('Plausibilität des Messwerkzeugs: FakeKi erreicht auf dem Textsatz ≥ 90 %', async () => {
		const ki = new FakeKi();
		let treffer = 0;
		const fehl: string[] = [];
		for (const b of satz.befehle) {
			const ist = await ki.aktionAusText(b.text, { heute: satz.heute, wochentag: satz.wochentag });
			pruefeAktion(ist);
			const e = bewerte(b.erwartet, ist);
			if (e.treffer) treffer++;
			else fehl.push(`${b.nr} ${b.text}: ${e.abweichungen.join('; ')}`);
		}
		expect(treffer / satz.befehle.length, fehl.join('\n')).toBeGreaterThanOrEqual(0.9);
	});
});
