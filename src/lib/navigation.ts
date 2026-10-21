/**
 * Navigation der App-Hülle – ohne Serverbezug, damit sie testbar und in Komponenten nutzbar ist.
 * Ein Eintrag erscheint nur, wenn der Tarif das Modul enthält UND der Benutzer das Recht hat. Die Oberfläche blendet
 * damit nur aus; geprüft wird immer serverseitig in Seiten und API.
 */

export type Symbol =
	| 'start'
	| 'kunden'
	| 'auftraege'
	| 'plantafel'
	| 'todos'
	| 'abwesenheiten'
	| 'angebote'
	| 'katalog'
	| 'briefkopf'
	| 'mehr'
	| 'benutzer'
	| 'rollen'
	| 'admin';

export type NavEintrag = {
	name: string;
	/** `null`: noch nicht verfügbar (wird ohne Link angezeigt). */
	href: string | null;
	symbol: Symbol;
	/** Zusatz unter dem Namen, z. B. „bald verfügbar“. */
	hinweis?: string;
};

export type NavGruppe = { id: string; titel: string; eintraege: NavEintrag[] };

export type Navigation = {
	/** Hauptbereich (immer offen): Start, Kunden, Aufträge, Angebote, Plantafel, Karte, Aufgaben (Jamil msg 2815). */
	haupt: NavEintrag[];
	/** Gruppen unter dem Hauptbereich, je einklappbar (Jamil msgs 2819, 2826); nur Gruppen mit Einträgen. */
	gruppen: NavGruppe[];
	/** Alle Gruppen-Einträge flach (z. B. für die Brotkrume und „Mehr“-Erkennung). */
	mehr: NavEintrag[];
};

type NavNutzer = { istAdmin: boolean; betriebId: string | null; rechte: readonly string[] };

/** Am Handy unten so viele Hauptbereiche, der Rest steht unter „Mehr“. */
export const MOBIL_HAUPT = 4;

/** `extras.nextcloud`: Nextcloud-Anbindung ist auf diesem Server eingerichtet (NEXTCLOUD_URL). */
export function baueNavigation(nutzer: NavNutzer, module: readonly string[], extras: { nextcloud?: boolean } = {}): Navigation {
	const hat = (recht: string) => nutzer.rechte.includes(recht);
	const haupt: NavEintrag[] = [{ name: 'Start', href: '/', symbol: 'start' }];
	const g: Record<string, NavEintrag[]> = { vorlagen: [], stammdaten: [], personal: [], auswertungen: [], automatisierung: [], benutzer: [] };

	if (nutzer.betriebId) {
		const auftraegeLesen = module.includes('auftraege') && (hat('auftraege.lesen') || hat('auftraege.alle_lesen'));
		const angeboteMitPreisen = module.includes('angebote') && hat('angebote.bearbeiten') && hat('preise.sehen');
		// Hauptbereich in der Reihenfolge von Jamil (msg 2815)
		if (module.includes('kunden') && hat('kunden.lesen')) haupt.push({ name: 'Kunden', href: '/kunden', symbol: 'kunden' });
		if (auftraegeLesen) haupt.push({ name: 'Aufträge', href: '/auftraege', symbol: 'auftraege' });
		// Angebote bestehen aus Preisen: nur mit `angebote.bearbeiten` UND `preise.sehen` (Monteur nie)
		if (angeboteMitPreisen) haupt.push({ name: 'Angebote', href: '/angebote', symbol: 'angebote' });
		// Plantafel: wer plant oder alle Aufträge sieht. Monteure sehen ihre Einsätze auf „Start“.
		if (module.includes('plantafel') && (hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen'))) {
			haupt.push({ name: 'Plantafel', href: '/plantafel', symbol: 'plantafel' });
		}
		if (auftraegeLesen) {
			// Auftragskarte mit Route (Wunsch Jamil msg 2602) – Monteure sehen nur ihre Aufträge
			haupt.push({ name: 'Karte', href: '/karte', symbol: 'plantafel' });
			haupt.push({ name: 'Aufgaben', href: '/todos', symbol: 'todos' });
		}

		// Vorlagen
		if (auftraegeLesen) g.vorlagen.push({ name: 'Auftrags-Vorlagen', href: '/auftrag-vorlagen', symbol: 'todos' });
		if (angeboteMitPreisen) g.vorlagen.push({ name: 'Angebots-Vorlagen', href: '/angebot-vorlagen', symbol: 'angebote' });
		if (module.includes('protokolle') && hat('protokolle.vorlagen_bearbeiten')) {
			g.vorlagen.push({ name: 'Protokoll-Vorlagen', href: '/einstellungen/protokoll-vorlagen', symbol: 'angebote' });
			// Aufmaß-Vorlagen (Jamil msg 2842): gleicher Baukasten, eigene Liste
			g.vorlagen.push({ name: 'Aufmaß-Vorlagen', href: '/einstellungen/protokoll-vorlagen?art=aufmass', symbol: 'katalog' });
		}
		// E-Mail-Vorlagen an einem Ort (Jamil msg 2789)
		if (hat('vorlagen.verwalten')) g.vorlagen.push({ name: 'E-Mail-Vorlagen', href: '/einstellungen/mail-vorlagen', symbol: 'angebote' });

		// Stammdaten & Kalkulation
		if (module.includes('katalog') && (hat('katalog.bearbeiten') || hat('angebote.bearbeiten'))) {
			g.stammdaten.push({ name: 'Katalog', href: '/katalog', symbol: 'katalog' });
		}
		// Partner (Jamil msg 2856): Auftraggeber, Subunternehmer, Lieferanten
		if (module.includes('auftraege') && hat('partner.verwalten')) g.stammdaten.push({ name: 'Partner', href: '/partner', symbol: 'kunden' });
		// Kalkulation / Stundensatz: Gehälter sind vertraulich – „Preise sehen“ UND „Einstellungen“ (Chef)
		if (module.includes('katalog') && hat('preise.sehen') && hat('einstellungen')) {
			g.stammdaten.push({ name: 'Kalkulation', href: '/kalkulation', symbol: 'katalog' });
		}
		if (hat('einstellungen') && module.includes('auftraege')) g.stammdaten.push({ name: 'Auftragsquellen', href: '/einstellungen/quellen', symbol: 'auftraege' });
		// Briefkopf und Logo (für Angebote): Betriebsdaten, ohne Modulbindung
		if (hat('einstellungen')) g.stammdaten.push({ name: 'Briefkopf / Firmenprofil', href: '/einstellungen/briefkopf', symbol: 'briefkopf' });

		// Personal & Zeiten
		if (module.includes('zeiterfassung') && (hat('zeiterfassung.nutzen') || hat('zeiterfassung.alle_sehen'))) {
			g.personal.push({ name: 'Zeiten', href: '/zeiten', symbol: 'abwesenheiten' });
		}
		if (module.includes('plantafel') && hat('plantafel.bearbeiten')) {
			g.personal.push({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten', symbol: 'abwesenheiten' });
			g.personal.push({ name: 'Kolonnen', href: '/plantafel/kolonnen', symbol: 'benutzer' });
		}

		// Auswertungen
		// Kennzahlen-Cockpit (Jamil msg 2858): über den ganzen Betrieb, deshalb „Alle Aufträge ansehen“
		if (module.includes('auftraege') && hat('auftraege.alle_lesen')) g.auswertungen.push({ name: 'Kennzahlen', href: '/auswertung/kennzahlen', symbol: 'katalog' });
		if (module.includes('zeiterfassung') && hat('preise.sehen') && hat('auftraege.alle_lesen')) {
			g.auswertungen.push({ name: 'Nachkalkulation', href: '/auswertung/nachkalkulation', symbol: 'katalog' });
		}
		if (module.includes('plantafel') && (hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen'))) {
			g.auswertungen.push({ name: 'Auslastung', href: '/plantafel/auslastung', symbol: 'plantafel' });
		}
		if (hat('einstellungen') && module.includes('auftraege')) {
			g.auswertungen.push({ name: 'Auswertung Auftragsquellen', href: '/auswertung/quellen', symbol: 'auftraege' });
		}

		// Automatisierung
		if (hat('einstellungen') && module.includes('angebote')) {
			g.automatisierung.push({ name: 'Nachfassen', href: '/einstellungen/nachfassen', symbol: 'angebote' });
			g.automatisierung.push({ name: 'Kundenportal & Auftragsbestätigung', href: '/einstellungen/kundenportal', symbol: 'angebote' });
		}
		// Online-Buchung (Wunsch Jamil msgs 2684/2686): Dienste, Buchungslinks, Arbeitszeiten
		if (module.includes('auftraege') && module.includes('plantafel') && hat('buchung.verwalten')) {
			g.automatisierung.push({ name: 'Online-Buchung', href: '/einstellungen/online-buchung', symbol: 'plantafel' });
		}
		if (hat('erinnerungen.nutzen')) g.automatisierung.push({ name: 'Erinnerungen', href: '/konto/benachrichtigungen', symbol: 'todos' });

		// Benutzeradministration (msg 2819)
		if (hat('benutzer.verwalten')) {
			g.benutzer.push({ name: 'Benutzer', href: '/einstellungen/benutzer', symbol: 'benutzer' });
			// Nextcloud-Anbindung (optional): Konten verknüpfen, Abgleich-Status
			if (extras.nextcloud) g.benutzer.push({ name: 'Nextcloud', href: '/einstellungen/nextcloud', symbol: 'benutzer' });
		}
		if (hat('einstellungen')) g.benutzer.push({ name: 'Rollen', href: '/einstellungen/rollen', symbol: 'rollen' });
	} else if (nutzer.istAdmin) {
		g.benutzer.push({ name: 'Plattform-Verwaltung', href: '/admin', symbol: 'admin' });
	}
	const TITEL: Record<string, string> = {
		vorlagen: 'Vorlagen',
		stammdaten: 'Stammdaten & Kalkulation',
		personal: 'Personal & Zeiten',
		auswertungen: 'Auswertungen',
		automatisierung: 'Automatisierung',
		benutzer: nutzer.betriebId ? 'Benutzeradministration' : 'Plattform'
	};
	const gruppen = Object.entries(g)
		.filter(([, e]) => e.length > 0)
		.map(([id, eintraege]) => ({ id, titel: TITEL[id], eintraege }));
	return { haupt, gruppen, mehr: gruppen.flatMap((x) => x.eintraege) };
}

/** Ist `href` die aktuelle Seite bzw. ein Bereich, in dem sie liegt? „/“ nur exakt. */
export function istAktiv(href: string | null, pfad: string): boolean {
	if (!href) return false;
	if (href === '/') return pfad === '/';
	return pfad === href || pfad.startsWith(href + '/');
}
