import { describe, expect, it } from 'vitest';
import { aktiverEintrag, baueNavigation, istAktiv, MOBIL_HAUPT } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const betriebsNutzer = (rechte: readonly string[]) => ({ istAdmin: false, betriebId: 'b1', rechte });
const namen = (eintraege: { name: string }[]) => eintraege.map((e) => e.name);
const gruppen = (nav: ReturnType<typeof baueNavigation>) => Object.fromEntries(nav.gruppen.map((g) => [g.titel, namen(g.eintraege)]));

describe('baueNavigation (Jamil msgs 2815, 2819, 2826)', () => {
	it('Chef: Hauptbereich in fester Reihenfolge, Gruppen mit Einträgen; „Weitere Bereiche“ gibt es nicht mehr', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE, { nextcloud: true });
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Ausgangsbelege', 'Plantafel', 'Karte', 'Aufgaben']);
		expect(gruppen(nav)).toEqual({
			Vorlagen: ['Auftrags-Vorlagen', 'Angebots-Vorlagen', 'Protokoll-Vorlagen', 'Aufmaß-Vorlagen', 'E-Mail-Vorlagen'],
			'Stammdaten & Kalkulation': ['Katalog', 'Kalkulation', 'Auftragsquellen', 'Terminarten', 'Briefkopf / Firmenprofil'],
			'Team & Partner': ['Zeiten', 'Abwesenheiten', 'Kolonnen', 'Partner'],
			Auswertungen: ['Kennzahlen', 'Nachkalkulation', 'Auslastung', 'Auswertung Auftragsquellen', 'Kennzahlen einstellen'],
			Automatisierung: ['Nachfassen', 'Kundenportal & Auftragsbestätigung', 'Leistungen für Bestandskunden', 'Online-Buchung', 'Erinnerungen', 'Handy verbinden'],
			Benutzeradministration: ['Benutzer', 'Nextcloud', 'Rollen']
		});
		expect(nav.mehr).toEqual(nav.gruppen.flatMap((g) => g.eintraege));
		expect(nav.haupt[1]).toMatchObject({ href: '/kunden' });
		expect(nav.haupt.find((e) => e.name === 'Aufgaben')).toMatchObject({ href: '/todos' });
	});

	it('Büro: ohne Kalkulation, Rollen, Benutzer, Online-Buchung, Nachfassen-Einstellungen', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Ausgangsbelege', 'Plantafel', 'Karte', 'Aufgaben']);
		const g = gruppen(nav);
		expect(g['Benutzeradministration']).toBeUndefined();
		expect(g['Stammdaten & Kalkulation']).toEqual(['Katalog']);
		expect(g['Team & Partner']).toEqual(['Zeiten', 'Abwesenheiten', 'Kolonnen', 'Partner']);
		expect(namen(nav.mehr)).not.toContain('Kalkulation');
		expect(namen(nav.mehr)).not.toContain('Online-Buchung');
		expect(namen(nav.mehr)).not.toContain('Terminarten');
	});

	it('Monteur: Start, Kunden, Aufträge, Karte, Aufgaben; nur Auftrags-Vorlagen, Zeiten, Erinnerungen; nie Preise', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Karte', 'Aufgaben']);
		expect(gruppen(nav)).toEqual({ Vorlagen: ['Auftrags-Vorlagen'], 'Team & Partner': ['Zeiten'], Automatisierung: ['Erinnerungen', 'Handy verbinden'] });
		for (const name of ['Ausgangsbelege', 'Katalog', 'Briefkopf / Firmenprofil', 'Kalkulation', 'Nachkalkulation']) {
			expect(namen([...nav.haupt, ...nav.mehr]), name).not.toContain(name);
		}
	});

	it('Handy verbinden (CalDAV, msgs 2964/2980) für alle, die Aufgaben sehen – nur mit Modul Aufträge', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE))['Automatisierung']).toEqual(['Handy verbinden']);
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE.filter((m) => m !== 'auftraege')).mehr)).not.toContain('Handy verbinden');
		expect(namen(baueNavigation(betriebsNutzer(['kunden.lesen']), ALLE_MODULE).mehr)).not.toContain('Handy verbinden');
	});

	it('Benutzeradministration nur mit Rechten: benutzer.verwalten → Benutzer, einstellungen → Rollen', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['benutzer.verwalten']), ALLE_MODULE))).toEqual({ Benutzeradministration: ['Benutzer'] });
		expect(gruppen(baueNavigation(betriebsNutzer(['einstellungen']), ALLE_MODULE))['Benutzeradministration']).toEqual(['Rollen']);
	});

	it('Kennzahlen (msg 2858) zuerst in „Auswertungen“, nur mit „Alle Aufträge ansehen“', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE))['Auswertungen']).toEqual(['Kennzahlen', 'Auslastung']);
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE))['Auswertungen']).toBeUndefined();
	});

	it('E-Mail-Vorlagen (msg 2789) nur mit vorlagen.verwalten, in der Gruppe „Vorlagen“', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['vorlagen.verwalten']), ALLE_MODULE))).toEqual({ Vorlagen: ['E-Mail-Vorlagen'] });
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE).mehr)).not.toContain('E-Mail-Vorlagen');
	});

	it('Ausgangsbelege, Angebots-Vorlagen nur mit angebote.bearbeiten UND preise.sehen; Kalkulation nur mit preise.sehen UND einstellungen', () => {
		const mit = (rechte: string[], module = ALLE_MODULE) => baueNavigation(betriebsNutzer(rechte), module);
		expect(namen(mit(['angebote.bearbeiten']).haupt)).toEqual(['Start']);
		expect(namen(mit(['angebote.bearbeiten']).mehr)).toEqual(['Katalog']);
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen']).haupt)).toEqual(['Start', 'Ausgangsbelege']);
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen']).mehr)).toContain('Angebots-Vorlagen');
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen'], ALLE_MODULE.filter((m) => m !== 'angebote')).haupt)).toEqual(['Start']);
		expect(namen(mit(['preise.sehen', 'einstellungen']).mehr)).toContain('Kalkulation');
		expect(namen(mit(['einstellungen']).mehr)).not.toContain('Kalkulation');
		expect(namen(mit(['preise.sehen', 'einstellungen'], ALLE_MODULE.filter((m) => m !== 'katalog')).mehr)).not.toContain('Kalkulation');
	});

	it('Plantafel nur mit plantafel.bearbeiten oder auftraege.alle_lesen; Abwesenheiten/Kolonnen nur mit plantafel.bearbeiten', () => {
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).haupt)).toEqual(['Start', 'Aufträge', 'Plantafel', 'Karte', 'Aufgaben']);
		const planer = baueNavigation(betriebsNutzer(['plantafel.bearbeiten']), ALLE_MODULE);
		expect(namen(planer.haupt)).toEqual(['Start', 'Plantafel']);
		expect(gruppen(planer)['Team & Partner']).toEqual(['Abwesenheiten', 'Kolonnen']);
		const ohnePlantafel = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE.filter((m) => m !== 'plantafel'));
		expect(namen(ohnePlantafel.haupt)).not.toContain('Plantafel');
		expect(namen(ohnePlantafel.mehr)).not.toContain('Abwesenheiten');
	});

	it('Eintrag nur mit Modul UND Recht', () => {
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.chef), ['katalog']).haupt)).toEqual(['Start']);
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.bearbeiten']), ALLE_MODULE).haupt)).toEqual(['Start']);
	});

	it('Handy: die ersten Hauptbereiche unten, der Rest unter „Mehr“', () => {
		expect(MOBIL_HAUPT).toBe(4);
	});

	it('Plattform-Admin: nur Start und die Plattform-Verwaltung; nie für Betriebsnutzer', () => {
		const nav = baueNavigation({ istAdmin: true, betriebId: null, rechte: VORLAGEN.chef }, ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start']);
		expect(nav.mehr).toEqual([expect.objectContaining({ name: 'Plattform-Verwaltung', href: '/admin' })]);
		expect(namen(baueNavigation({ istAdmin: true, betriebId: 'b1', rechte: [] }, ALLE_MODULE).mehr)).not.toContain('Plattform-Verwaltung');
	});

	it('Ausgangsbelege (msg 2948): Eintrag /ausgangsbelege, aktiv auf allen Reitern und auf einem einzelnen Angebot', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		expect(nav.haupt.find((e) => e.name === 'Ausgangsbelege')?.href).toBe('/ausgangsbelege');
		for (const pfad of ['/ausgangsbelege/angebote', '/ausgangsbelege/auftragsbestaetigungen', '/ausgangsbelege/rechnungen', '/angebote/abc']) {
			expect(istAktiv('/ausgangsbelege', pfad), pfad).toBe(true);
		}
		expect(istAktiv('/ausgangsbelege', '/angebot-vorlagen')).toBe(false);
		expect(istAktiv('/auftraege', '/angebote/abc')).toBe(false);
	});

	it('Partner (msg 3089) in „Team & Partner“, nur mit Modul Aufträge und partner.verwalten', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['partner.verwalten']), ALLE_MODULE))).toEqual({ 'Team & Partner': ['Partner'] });
		expect(namen(baueNavigation(betriebsNutzer(['partner.verwalten']), ALLE_MODULE.filter((m) => m !== 'auftraege')).mehr)).not.toContain('Partner');
	});

	it('Aufmaß-Vorlagen (msg 3085): eigener Pfad – markiert ist nur „Aufmaß-Vorlagen“, nicht „Protokoll-Vorlagen“', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		const alle = [...nav.haupt, ...nav.mehr];
		const name = (pfad: string) => aktiverEintrag(alle, pfad)?.name ?? null;
		expect(nav.mehr.find((e) => e.name === 'Aufmaß-Vorlagen')?.href).toBe('/einstellungen/aufmass-vorlagen');
		expect(name('/einstellungen/aufmass-vorlagen')).toBe('Aufmaß-Vorlagen');
		expect(name('/einstellungen/aufmass-vorlagen/2f1c0b3e-0000-4000-8000-000000000001')).toBe('Aufmaß-Vorlagen');
		expect(name('/einstellungen/protokoll-vorlagen')).toBe('Protokoll-Vorlagen');
		expect(name('/einstellungen/protokoll-vorlagen/2f1c0b3e-0000-4000-8000-000000000001')).toBe('Protokoll-Vorlagen');
		expect(name('/einstellungen/mail-vorlagen/neu')).toBe('E-Mail-Vorlagen');
	});

	it('Jede Seite markiert genau EINEN Menüpunkt – keine Menü-Adresse mit Suchteil, der genaueste Eintrag gewinnt', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE, { nextcloud: true });
		const alle = [...nav.haupt, ...nav.mehr];
		for (const e of alle) {
			// ein „?…“ im Menü-Link kann die Markierung nicht unterscheiden (Pfad ohne Suchteil) – so entstand msg 3085
			expect(e.href, e.name).not.toContain('?');
			expect(aktiverEintrag(alle, e.href!)?.name, e.href!).toBe(e.name);
		}
		// Unterseiten: der genaueste Bereich, nicht zusätzlich der übergeordnete
		expect(aktiverEintrag(alle, '/plantafel/abwesenheiten')?.name).toBe('Abwesenheiten');
		expect(aktiverEintrag(alle, '/plantafel')?.name).toBe('Plantafel');
		expect(aktiverEintrag(alle, '/angebote/abc')?.name).toBe('Ausgangsbelege');
		expect(aktiverEintrag(alle, '/unbekannt')).toBeNull();
	});
});
