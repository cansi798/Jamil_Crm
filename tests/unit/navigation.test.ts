import { describe, expect, it } from 'vitest';
import { baueNavigation } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const betriebsNutzer = (rechte: readonly string[]) => ({ istAdmin: false, betriebId: 'b1', rechte });
const namen = (eintraege: { name: string }[]) => eintraege.map((e) => e.name);

describe('baueNavigation', () => {
	it('Büro: Start, Kunden, Plantafel (bald verfügbar); keine Verwaltung', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Plantafel']);
		expect(nav.haupt[0]).toMatchObject({ href: '/' });
		expect(nav.haupt[1]).toMatchObject({ href: '/kunden' });
		// Plantafel ist noch kein Link (Plan 1b)
		expect(nav.haupt[2]).toMatchObject({ href: null, hinweis: 'bald verfügbar' });
		expect(nav.mehr).toEqual([]);
	});

	it('Chef: zusätzlich Benutzer und Rollen unter „Mehr“', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Plantafel']);
		expect(nav.mehr).toEqual([
			expect.objectContaining({ name: 'Benutzer', href: '/einstellungen/benutzer' }),
			expect.objectContaining({ name: 'Rollen', href: '/einstellungen/rollen' })
		]);
	});

	it('nur „benutzer.verwalten“ ohne „einstellungen“: Benutzer ja, Rollen nein', () => {
		const nav = baueNavigation(betriebsNutzer(['kunden.lesen', 'benutzer.verwalten']), ALLE_MODULE);
		expect(namen(nav.mehr)).toEqual(['Benutzer']);
	});

	it('Monteur: Kunden (lesen) und Plantafel (eigene Aufträge)', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Plantafel']);
		expect(nav.mehr).toEqual([]);
	});

	it('Eintrag nur mit Modul UND Recht', () => {
		// Recht ohne Modul
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.chef), ['auftraege']).haupt)).toEqual(['Start']);
		// Modul ohne Recht
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.bearbeiten']), ALLE_MODULE).haupt)).toEqual(['Start']);
	});

	it('Plattform-Admin: nur Start und die Plattform-Verwaltung, nie fachliche Einträge', () => {
		const nav = baueNavigation({ istAdmin: true, betriebId: null, rechte: VORLAGEN.chef }, ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start']);
		expect(nav.mehr).toEqual([expect.objectContaining({ name: 'Plattform-Verwaltung', href: '/admin' })]);
	});

	it('Admin-Link nie für Betriebsnutzer, auch wenn istAdmin fälschlich gesetzt ist', () => {
		const nav = baueNavigation({ istAdmin: true, betriebId: 'b1', rechte: [] }, ALLE_MODULE);
		expect(namen(nav.mehr)).not.toContain('Plattform-Verwaltung');
	});
});
