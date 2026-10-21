import { describe, expect, it } from 'vitest';
import { schnellzugriff } from '../../src/lib/schnellzugriff';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const nutzer = (rechte: readonly string[]) => ({ betriebId: 'b1', rechte });
const ids = (r: ReturnType<typeof schnellzugriff>) => r.map((e) => e.id);

describe('schnellzugriff (Jamil msgs 3078/3079)', () => {
	it('Chef und Büro: alle fünf Einträge in fester Reihenfolge mit Zielen', () => {
		const chef = schnellzugriff(nutzer(VORLAGEN.chef), ALLE_MODULE);
		expect(ids(chef)).toEqual(['sprache', 'kunde', 'auftrag', 'termin', 'aufgabe']);
		expect(chef.map((e) => e.href)).toEqual([null, '/kunden/neu', '/auftraege/neu', '/plantafel?neu=1', '/todos?neu=1']);
		expect(ids(schnellzugriff(nutzer(VORLAGEN.buero), ALLE_MODULE))).toEqual(ids(chef));
	});

	it('Monteur (Standard): nichts – kein Knopf', () => {
		expect(schnellzugriff(nutzer(VORLAGEN.monteur), ALLE_MODULE)).toEqual([]);
	});

	it('jeder Eintrag nur mit Modul UND Recht', () => {
		expect(ids(schnellzugriff(nutzer(['sprache.nutzen']), ALLE_MODULE))).toEqual(['sprache']);
		expect(ids(schnellzugriff(nutzer(['sprache.nutzen']), ['kunden']))).toEqual([]);
		expect(ids(schnellzugriff(nutzer(['kunden.bearbeiten', 'plantafel.bearbeiten']), ALLE_MODULE))).toEqual(['kunde', 'termin']);
		// Aufgabe braucht zusätzlich ein Lese-Recht für Aufträge (sonst ist die Aufgaben-Seite gesperrt)
		expect(ids(schnellzugriff(nutzer(['auftraege.bearbeiten']), ALLE_MODULE))).toEqual(['auftrag']);
		expect(ids(schnellzugriff(nutzer(['auftraege.bearbeiten', 'auftraege.lesen']), ALLE_MODULE))).toEqual(['auftrag', 'aufgabe']);
		expect(ids(schnellzugriff(nutzer(VORLAGEN.chef), ALLE_MODULE.filter((m) => m !== 'sprache' && m !== 'plantafel')))).toEqual([
			'kunde',
			'auftrag',
			'aufgabe'
		]);
	});

	it('Plattform-Admin ohne Betrieb: nichts', () => {
		expect(schnellzugriff({ betriebId: null, rechte: [...VORLAGEN.chef] }, ALLE_MODULE)).toEqual([]);
	});
});
