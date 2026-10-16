import { describe, expect, it } from 'vitest';
import { baueNavigation } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const betriebsNutzer = (rechte: readonly string[]) => ({ istAdmin: false, betriebId: 'b1', rechte });
const namen = (eintraege: { name: string }[]) => eintraege.map((e) => e.name);

describe('baueNavigation', () => {
	it('Büro: Start, Kunden, Aufträge, Plantafel; unter „Mehr“ To-dos und Abwesenheiten, keine Verwaltung', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Plantafel']);
		expect(nav.haupt[0]).toMatchObject({ href: '/' });
		expect(nav.haupt[1]).toMatchObject({ href: '/kunden' });
		expect(nav.haupt[2]).toMatchObject({ href: '/auftraege', symbol: 'auftraege' });
		// Plantafel ist jetzt ein Link (Plan 1b), ohne „bald verfügbar“
		expect(nav.haupt[3]).toMatchObject({ href: '/plantafel', symbol: 'plantafel' });
		expect(nav.haupt[3].hinweis).toBeUndefined();
		expect(nav.mehr).toEqual([
			expect.objectContaining({ name: 'To-dos', href: '/todos', symbol: 'todos' }),
			expect.objectContaining({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten' })
		]);
	});

	it('Chef: Haupt Start, Kunden, Aufträge, Plantafel; „Mehr“ mit To-dos, Abwesenheiten, Benutzer, Rollen', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Plantafel']);
		expect(namen(nav.mehr)).toEqual(['To-dos', 'Abwesenheiten', 'Benutzer', 'Rollen']);
		expect(nav.mehr).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'Benutzer', href: '/einstellungen/benutzer' }),
				expect.objectContaining({ name: 'Rollen', href: '/einstellungen/rollen' })
			])
		);
	});

	it('Monteur (kunden.lesen, auftraege.lesen): Start, Kunden, Aufträge; To-dos unter „Mehr“; keine Plantafel', () => {
		const nav = baueNavigation(betriebsNutzer(['kunden.lesen', 'auftraege.lesen']), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge']);
		expect(namen(nav.mehr)).toEqual(['To-dos']);
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE).haupt)).toEqual(['Start', 'Kunden', 'Aufträge']);
	});

	it('Tarif ohne Modul plantafel: keine Plantafel und keine Abwesenheiten; ohne auftraege keine Aufträge/To-dos', () => {
		const ohnePlantafel = ALLE_MODULE.filter((m) => m !== 'plantafel');
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ohnePlantafel);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge']);
		expect(namen(nav.mehr)).toEqual(['To-dos', 'Benutzer', 'Rollen']);
		const ohneAuftraege = ALLE_MODULE.filter((m) => m !== 'auftraege');
		const n2 = baueNavigation(betriebsNutzer(VORLAGEN.chef), ohneAuftraege);
		expect(namen(n2.haupt)).toEqual(['Start', 'Kunden', 'Plantafel']);
		expect(namen(n2.mehr)).toEqual(['Abwesenheiten', 'Benutzer', 'Rollen']);
	});

	it('Plantafel nur mit plantafel.bearbeiten oder auftraege.alle_lesen; Abwesenheiten nur mit plantafel.bearbeiten', () => {
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).haupt)).toEqual([
			'Start',
			'Aufträge',
			'Plantafel'
		]);
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).mehr)).toEqual(['To-dos']);
		const planer = baueNavigation(betriebsNutzer(['plantafel.bearbeiten']), ALLE_MODULE);
		expect(namen(planer.haupt)).toEqual(['Start', 'Plantafel']);
		expect(namen(planer.mehr)).toEqual(['Abwesenheiten']);
	});

	it('nur „benutzer.verwalten“ ohne „einstellungen“: Benutzer ja, Rollen nein', () => {
		const nav = baueNavigation(betriebsNutzer(['kunden.lesen', 'benutzer.verwalten']), ALLE_MODULE);
		expect(namen(nav.mehr)).toEqual(['Benutzer']);
	});

	it('Eintrag nur mit Modul UND Recht', () => {
		// Recht ohne Modul
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.chef), ['katalog']).haupt)).toEqual(['Start']);
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
