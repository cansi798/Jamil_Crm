import { describe, expect, it } from 'vitest';
import { baueNavigation } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const betriebsNutzer = (rechte: readonly string[]) => ({ istAdmin: false, betriebId: 'b1', rechte });
const namen = (eintraege: { name: string }[]) => eintraege.map((e) => e.name);

describe('baueNavigation', () => {
	it('Büro: Start, Kunden, Aufträge, Plantafel, Angebote; unter „Mehr“ To-dos, Vorlagen, Abwesenheiten, Katalog, keine Verwaltung', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Plantafel', 'Angebote']);
		expect(nav.haupt[4]).toMatchObject({ href: '/angebote', symbol: 'angebote' });
		expect(nav.haupt[0]).toMatchObject({ href: '/' });
		expect(nav.haupt[1]).toMatchObject({ href: '/kunden' });
		expect(nav.haupt[2]).toMatchObject({ href: '/auftraege', symbol: 'auftraege' });
		// Plantafel ist jetzt ein Link (Plan 1b), ohne „bald verfügbar“
		expect(nav.haupt[3]).toMatchObject({ href: '/plantafel', symbol: 'plantafel' });
		expect(nav.haupt[3].hinweis).toBeUndefined();
		expect(nav.mehr).toEqual([
			expect.objectContaining({ name: 'To-dos', href: '/todos', symbol: 'todos' }),
			expect.objectContaining({ name: 'Karte', href: '/karte' }),
			expect.objectContaining({ name: 'Auftrags-Vorlagen', href: '/auftrag-vorlagen' }),
			expect.objectContaining({ name: 'Zeiten', href: '/zeiten' }),
			expect.objectContaining({ name: 'Tätigkeiten ohne Auftrag', href: '/einstellungen/zeiterfassung' }),
			expect.objectContaining({ name: 'Nachkalkulation', href: '/auswertung/nachkalkulation' }),
			expect.objectContaining({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten' }),
			expect.objectContaining({ name: 'Katalog', href: '/katalog', symbol: 'katalog' }),
			expect.objectContaining({ name: 'Angebots-Vorlagen', href: '/angebot-vorlagen', symbol: 'angebote' }),
			expect.objectContaining({ name: 'Protokoll-Vorlagen', href: '/einstellungen/protokoll-vorlagen' })
		]);
	});

	it('Chef: Haupt Start, Kunden, Aufträge, Plantafel, Angebote; „Mehr“ mit To-dos, Vorlagen, Abwesenheiten, Katalog, Benutzer, Rollen, Briefkopf', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Plantafel', 'Angebote']);
		expect(namen(nav.mehr)).toEqual(['To-dos', 'Karte', 'Auftrags-Vorlagen', 'Zeiten', 'Tätigkeiten ohne Auftrag', 'Nachkalkulation', 'Abwesenheiten', 'Katalog', 'Angebots-Vorlagen', 'Kalkulation', 'Protokoll-Vorlagen', 'Online-Buchung', 'Benutzer', 'Rollen', 'Briefkopf', 'Nachfassen', 'Kundenportal & Auftragsbestätigung', 'Auftragsquellen', 'Auswertung Auftragsquellen']);
		expect(nav.mehr).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'Benutzer', href: '/einstellungen/benutzer' }),
				expect.objectContaining({ name: 'Rollen', href: '/einstellungen/rollen' })
			])
		);
	});

	it('Monteur (kunden.lesen, auftraege.lesen): Start, Kunden, Aufträge; To-dos und Vorlagen unter „Mehr“; keine Plantafel', () => {
		const nav = baueNavigation(betriebsNutzer(['kunden.lesen', 'auftraege.lesen']), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge']);
		expect(namen(nav.mehr)).toEqual(['To-dos', 'Karte', 'Auftrags-Vorlagen']);
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE).haupt)).toEqual(['Start', 'Kunden', 'Aufträge']);
	});

	it('Tarif ohne Modul plantafel: keine Plantafel und keine Abwesenheiten; ohne auftraege keine Aufträge/To-dos/Vorlagen', () => {
		const ohnePlantafel = ALLE_MODULE.filter((m) => m !== 'plantafel');
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ohnePlantafel);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Angebote']);
		expect(namen(nav.mehr)).toEqual(['To-dos', 'Karte', 'Auftrags-Vorlagen', 'Zeiten', 'Tätigkeiten ohne Auftrag', 'Nachkalkulation', 'Katalog', 'Angebots-Vorlagen', 'Kalkulation', 'Protokoll-Vorlagen', 'Benutzer', 'Rollen', 'Briefkopf', 'Nachfassen', 'Kundenportal & Auftragsbestätigung', 'Auftragsquellen', 'Auswertung Auftragsquellen']);
		const ohneAuftraege = ALLE_MODULE.filter((m) => m !== 'auftraege');
		const n2 = baueNavigation(betriebsNutzer(VORLAGEN.chef), ohneAuftraege);
		expect(namen(n2.haupt)).toEqual(['Start', 'Kunden', 'Plantafel', 'Angebote']);
		expect(namen(n2.mehr)).toEqual(['Zeiten', 'Tätigkeiten ohne Auftrag', 'Nachkalkulation', 'Abwesenheiten', 'Katalog', 'Angebots-Vorlagen', 'Kalkulation', 'Protokoll-Vorlagen', 'Benutzer', 'Rollen', 'Briefkopf', 'Nachfassen', 'Kundenportal & Auftragsbestätigung']);
	});

	it('Angebots-Vorlagen nur mit Modul angebote, angebote.bearbeiten UND preise.sehen (enthalten Preise)', () => {
		const mit = (rechte: string[], module = ALLE_MODULE) => namen(baueNavigation(betriebsNutzer(rechte), module).mehr);
		expect(mit(['angebote.bearbeiten', 'preise.sehen'])).toContain('Angebots-Vorlagen');
		expect(mit(['angebote.bearbeiten'])).not.toContain('Angebots-Vorlagen');
		expect(mit(['preise.sehen'])).not.toContain('Angebots-Vorlagen');
		expect(mit(['angebote.bearbeiten', 'preise.sehen'], ALLE_MODULE.filter((m) => m !== 'angebote'))).not.toContain('Angebots-Vorlagen');
	});

	it('Kalkulation nur mit Modul katalog, preise.sehen UND einstellungen (Gehälter)', () => {
		const mit = (rechte: string[], module = ALLE_MODULE) => namen(baueNavigation(betriebsNutzer(rechte), module).mehr);
		expect(mit(['preise.sehen', 'einstellungen'])).toContain('Kalkulation');
		expect(mit(['preise.sehen'])).not.toContain('Kalkulation');
		expect(mit(['einstellungen'])).not.toContain('Kalkulation');
		expect(mit(['preise.sehen', 'einstellungen'], ALLE_MODULE.filter((m) => m !== 'katalog'))).not.toContain('Kalkulation');
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE).mehr)).not.toContain('Kalkulation');
	});

	it('Plantafel nur mit plantafel.bearbeiten oder auftraege.alle_lesen; Abwesenheiten nur mit plantafel.bearbeiten', () => {
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).haupt)).toEqual([
			'Start',
			'Aufträge',
			'Plantafel'
		]);
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).mehr)).toEqual(['To-dos', 'Karte', 'Auftrags-Vorlagen']);
		const planer = baueNavigation(betriebsNutzer(['plantafel.bearbeiten']), ALLE_MODULE);
		expect(namen(planer.haupt)).toEqual(['Start', 'Plantafel']);
		expect(namen(planer.mehr)).toEqual(['Abwesenheiten']);
	});

	it('Angebote (Haupt) nur mit Modul angebote UND angebote.bearbeiten UND preise.sehen; Katalog (Mehr) mit katalog.bearbeiten oder angebote.bearbeiten; Briefkopf nur mit einstellungen', () => {
		const ohneAngebote = ALLE_MODULE.filter((m) => m !== 'angebote');
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.chef), ohneAngebote).haupt)).not.toContain('Angebote');
		expect(namen(baueNavigation(betriebsNutzer(['angebote.bearbeiten']), ALLE_MODULE).haupt)).toEqual(['Start']);
		expect(namen(baueNavigation(betriebsNutzer(['angebote.bearbeiten']), ALLE_MODULE).mehr)).toEqual(['Katalog']);
		expect(namen(baueNavigation(betriebsNutzer(['angebote.bearbeiten', 'preise.sehen']), ALLE_MODULE).haupt)).toEqual(['Start', 'Angebote']);
		expect(namen(baueNavigation(betriebsNutzer(['katalog.bearbeiten']), ALLE_MODULE).mehr)).toEqual(['Katalog']);
		const ohneKatalog = ALLE_MODULE.filter((m) => m !== 'katalog');
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.chef), ohneKatalog).mehr)).not.toContain('Katalog');
		expect(namen(baueNavigation(betriebsNutzer(['einstellungen']), ALLE_MODULE).mehr)).toEqual(['Rollen', 'Briefkopf', 'Nachfassen', 'Kundenportal & Auftragsbestätigung', 'Auftragsquellen', 'Auswertung Auftragsquellen']);
		// Monteur: nichts davon
		const monteur = baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE);
		for (const name of ['Angebote', 'Katalog', 'Briefkopf']) {
			expect(namen(monteur.haupt), name).not.toContain(name);
			expect(namen(monteur.mehr), name).not.toContain(name);
		}
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
