import { describe, expect, it } from 'vitest';
import { aktiverEintrag, baueNavigation, istAktiv, istBereichsStart, MOBIL_HAUPT } from '../../src/lib/navigation';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { MODULE } from '../../src/lib/tarife';

const ALLE_MODULE = [...MODULE];
const betriebsNutzer = (rechte: readonly string[]) => ({ istAdmin: false, betriebId: 'b1', rechte });
const namen = (eintraege: { name: string }[]) => eintraege.map((e) => e.name);
// „Was ist neu“ (msg 3423) steht bei allen Benutzern eines Betriebs – hier ausgeblendet, eigener Test unten
const gruppen = (nav: ReturnType<typeof baueNavigation>) =>
	Object.fromEntries(nav.gruppen.map((g) => [g.titel, namen(g.eintraege).filter((n) => n !== 'Was ist neu')]).filter(([, e]) => e.length > 0));

describe('baueNavigation – vier Blöcke ohne sichtbare Überschrift (Jamil #7191)', () => {
	it('Chef: Hauptbereich (Operativ) in fester Reihenfolge, dann Verwaltung/Administrativ/Konfiguration', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE, { nextcloud: true });
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Ausgangsbelege', 'Plantafel', 'Karte', 'Aufgaben']);
		// Vier Blöcke in fester Reihenfolge; die Titel sind nur Screenreader-Label, nicht sichtbar
		expect(nav.gruppen.map((g) => g.titel)).toEqual(['Operativ', 'Verwaltung', 'Administrativ', 'Konfiguration']);
		expect(gruppen(nav)).toEqual({
			// Operativ = Hauptbereich oben + die eigene Arbeitszeit
			Operativ: ['Zeiten'],
			// Verwaltung = Vorlagen, Katalog/Kalkulation, nachgelagerte Belege, Partner
			Verwaltung: ['Auftrags-Vorlagen', 'Angebots-Vorlagen', 'Protokoll- & Aufmaß-Vorlagen', 'E-Mail-Vorlagen', 'Katalog', 'Kalkulation', 'Nachfassen', 'Mahnungen', 'Erinnerung Rechnung', 'Partner'],
			// Administrativ = Auswertungen, dann Personal/Organisation
			Administrativ: ['Kennzahlen', 'Nachkalkulation', 'Auslastung', 'Auswertung Auftragsquellen', 'Kennzahlen einstellen', 'Abwesenheiten', 'Kolonnen'],
			// Konfiguration = Kundenweg-Einstellungen, Firmenprofil/Technik, Benutzer/Rollen (ohne „Was ist neu“, s. Helfer)
			Konfiguration: ['Auftragsquellen', 'Terminarten', 'Online-Buchung', 'Leitfaden beim Termin', 'Kundenportal & Auftragsbestätigung', 'Funktionen & Automatisierungen', 'Briefkopf / Firmenprofil', 'E-Mail-Versand', 'Lexware verbinden', 'Erinnerungen', 'Handy verbinden', 'Benutzer', 'Nextcloud', 'Rollen']
		});
		expect(namen(nav.mehr)).not.toContain('Leistungen für Bestandskunden');
		expect(nav.mehr).toEqual(nav.gruppen.flatMap((g) => g.eintraege));
		expect(nav.haupt[1]).toMatchObject({ href: '/kunden' });
		expect(nav.haupt.find((e) => e.name === 'Aufgaben')).toMatchObject({ href: '/todos' });
	});

	it('Büro: ohne Kalkulation, Rollen, Benutzer, Online-Buchung, Nachfassen-Einstellungen', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.buero), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Ausgangsbelege', 'Plantafel', 'Karte', 'Aufgaben']);
		const g = gruppen(nav);
		expect(g['Operativ']).toEqual(['Zeiten']);
		// Büro hat keine „einstellungen“/„buchung.verwalten“ → in Konfiguration bleiben nur persönliche Punkte
		expect(g['Konfiguration']).toEqual(['Erinnerungen', 'Handy verbinden']);
		expect(g['Administrativ']).toEqual(['Kennzahlen', 'Nachkalkulation', 'Auslastung', 'Abwesenheiten', 'Kolonnen']);
		expect(g['Verwaltung']).toContain('Partner');
		expect(namen(nav.mehr)).not.toContain('Kalkulation');
		expect(namen(nav.mehr)).not.toContain('Online-Buchung');
		expect(namen(nav.mehr)).not.toContain('Terminarten');
		expect(namen(nav.mehr)).not.toContain('Rollen');
		expect(namen(nav.mehr)).not.toContain('Benutzer');
	});

	it('Monteur: Start, Kunden, Aufträge, Karte, Aufgaben; nur Operativ (Zeiten), Verwaltung (Auftrags-Vorlagen), Konfiguration (persönlich); nie Preise', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE);
		expect(namen(nav.haupt)).toEqual(['Start', 'Kunden', 'Aufträge', 'Karte', 'Aufgaben']);
		expect(gruppen(nav)).toEqual({ Operativ: ['Zeiten'], Verwaltung: ['Auftrags-Vorlagen'], Konfiguration: ['Erinnerungen', 'Handy verbinden'] });
		for (const name of ['Ausgangsbelege', 'Katalog', 'Briefkopf / Firmenprofil', 'Kalkulation', 'Nachkalkulation']) {
			expect(namen([...nav.haupt, ...nav.mehr]), name).not.toContain(name);
		}
	});

	it('Handy verbinden (CalDAV, msgs 2964/2980) für alle, die Aufgaben sehen – in „Konfiguration“, nur mit Modul Aufträge', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE))['Konfiguration']).toEqual(['Handy verbinden']);
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE.filter((m) => m !== 'auftraege')).mehr)).not.toContain('Handy verbinden');
		expect(namen(baueNavigation(betriebsNutzer(['kunden.lesen']), ALLE_MODULE).mehr)).not.toContain('Handy verbinden');
	});

	it('Benutzer/Rollen in „Konfiguration“: benutzer.verwalten → Benutzer, einstellungen → Rollen', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['benutzer.verwalten']), ALLE_MODULE))).toEqual({ Konfiguration: ['Benutzer'] });
		expect(gruppen(baueNavigation(betriebsNutzer(['einstellungen']), ALLE_MODULE))['Konfiguration']).toContain('Rollen');
		expect(namen(baueNavigation(betriebsNutzer(['benutzer.verwalten']), ALLE_MODULE).mehr)).not.toContain('Rollen');
	});

	it('Kennzahlen (msg 2858) zuerst in „Administrativ“, nur mit „Alle Aufträge ansehen“', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE))['Administrativ']).toEqual(['Kennzahlen', 'Auslastung']);
		expect(gruppen(baueNavigation(betriebsNutzer(['auftraege.lesen']), ALLE_MODULE))['Administrativ']).toBeUndefined();
	});

	it('E-Mail-Vorlagen (msg 2789) nur mit vorlagen.verwalten, in „Verwaltung“', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['vorlagen.verwalten']), ALLE_MODULE))).toEqual({ Verwaltung: ['E-Mail-Vorlagen'] });
		expect(namen(baueNavigation(betriebsNutzer(VORLAGEN.monteur), ALLE_MODULE).mehr)).not.toContain('E-Mail-Vorlagen');
	});

	it('Ausgangsbelege, Angebots-Vorlagen nur mit angebote.bearbeiten UND preise.sehen; Kalkulation nur mit preise.sehen UND einstellungen', () => {
		const mit = (rechte: string[], module = ALLE_MODULE) => baueNavigation(betriebsNutzer(rechte), module);
		expect(namen(mit(['angebote.bearbeiten']).haupt)).toEqual(['Start']);
		expect(namen(mit(['angebote.bearbeiten']).mehr)).toEqual(['Katalog', 'Was ist neu']);
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen']).haupt)).toEqual(['Start', 'Ausgangsbelege']);
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen']).mehr)).toContain('Angebots-Vorlagen');
		expect(namen(mit(['angebote.bearbeiten', 'preise.sehen'], ALLE_MODULE.filter((m) => m !== 'angebote')).haupt)).toEqual(['Start']);
		expect(namen(mit(['preise.sehen', 'einstellungen']).mehr)).toContain('Kalkulation');
		expect(namen(mit(['einstellungen']).mehr)).not.toContain('Kalkulation');
		expect(namen(mit(['preise.sehen', 'einstellungen'], ALLE_MODULE.filter((m) => m !== 'katalog')).mehr)).not.toContain('Kalkulation');
	});

	it('Plantafel nur mit plantafel.bearbeiten oder auftraege.alle_lesen; Abwesenheiten/Kolonnen (Administrativ) nur mit plantafel.bearbeiten', () => {
		expect(namen(baueNavigation(betriebsNutzer(['auftraege.alle_lesen']), ALLE_MODULE).haupt)).toEqual(['Start', 'Aufträge', 'Plantafel', 'Karte', 'Aufgaben']);
		const planer = baueNavigation(betriebsNutzer(['plantafel.bearbeiten']), ALLE_MODULE);
		expect(namen(planer.haupt)).toEqual(['Start', 'Plantafel']);
		expect(gruppen(planer)['Administrativ']).toEqual(['Auslastung', 'Abwesenheiten', 'Kolonnen']);
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

	it('Partner (msg 3089) in „Verwaltung“, nur mit Modul Aufträge und partner.verwalten', () => {
		expect(gruppen(baueNavigation(betriebsNutzer(['partner.verwalten']), ALLE_MODULE))).toEqual({ Verwaltung: ['Partner'] });
		expect(namen(baueNavigation(betriebsNutzer(['partner.verwalten']), ALLE_MODULE.filter((m) => m !== 'auftraege')).mehr)).not.toContain('Partner');
	});

	it('Protokoll- & Aufmaß-Vorlagen (msgs 3085, 3535): EIN Menüpunkt, beide Reiter-Adressen markieren genau ihn', () => {
		const nav = baueNavigation(betriebsNutzer(VORLAGEN.chef), ALLE_MODULE);
		const alle = [...nav.haupt, ...nav.mehr];
		const name = (pfad: string) => aktiverEintrag(alle, pfad)?.name ?? null;
		expect(nav.mehr.find((e) => e.name === 'Protokoll- & Aufmaß-Vorlagen')?.href).toBe('/einstellungen/protokoll-vorlagen');
		expect(namen(nav.mehr)).not.toContain('Aufmaß-Vorlagen');
		for (const pfad of ['/einstellungen/aufmass-vorlagen', '/einstellungen/aufmass-vorlagen/2f1c0b3e-0000-4000-8000-000000000001', '/einstellungen/protokoll-vorlagen', '/einstellungen/protokoll-vorlagen/2f1c0b3e-0000-4000-8000-000000000001']) {
			expect(name(pfad), pfad).toBe('Protokoll- & Aufmaß-Vorlagen');
			expect(alle.filter((e) => istAktiv(e.href, pfad)).length, pfad).toBe(1);
		}
		expect(name('/einstellungen/mail-vorlagen/neu')).toBe('E-Mail-Vorlagen');
	});

	it('Bereichs-Startseite (Titel nur in der Kopfleiste, msgs 3060, 3569): auch der Reiter „Aufmaße“', () => {
		expect(istBereichsStart('/einstellungen/protokoll-vorlagen', '/einstellungen/protokoll-vorlagen')).toBe(true);
		expect(istBereichsStart('/einstellungen/protokoll-vorlagen', '/einstellungen/aufmass-vorlagen')).toBe(true);
		expect(istBereichsStart('/einstellungen/protokoll-vorlagen', '/einstellungen/aufmass-vorlagen/2f1c0b3e-0000-4000-8000-000000000001')).toBe(false);
		expect(istBereichsStart('/ausgangsbelege', '/angebote')).toBe(false);
		expect(istBereichsStart(null, '/')).toBe(false);
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

	it('Was ist neu (msg 3423): für jeden Benutzer eines Betriebs (in „Konfiguration“), nicht für die Plattform-Verwaltung', () => {
		expect(namen(baueNavigation(betriebsNutzer([]), ALLE_MODULE).mehr)).toContain('Was ist neu');
		expect(namen(baueNavigation({ istAdmin: true, betriebId: null, rechte: [] }, ALLE_MODULE).mehr)).not.toContain('Was ist neu');
	});

	it('Funktionen & Automatisierungen nur mit „Einstellungen“', () => {
		expect(namen(baueNavigation(betriebsNutzer(['einstellungen']), ALLE_MODULE).mehr)).toContain('Funktionen & Automatisierungen');
		expect(namen(baueNavigation(betriebsNutzer(['kunden.lesen']), ALLE_MODULE).mehr)).not.toContain('Funktionen & Automatisierungen');
	});
});
