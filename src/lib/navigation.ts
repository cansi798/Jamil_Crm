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

/** `titel` ist NICHT sichtbar (Jamil #7191) – nur Screenreader-Label des Blocks. */
export type NavGruppe = { id: string; titel: string; eintraege: NavEintrag[] };

export type Navigation = {
	/** Hauptbereich (immer sichtbar, Teil von „Operativ“): Start, Kunden, Aufträge, Ausgangsbelege, Plantafel, Karte, Aufgaben (Jamil msg 2815). */
	haupt: NavEintrag[];
	/** Die vier Blöcke unter dem Hauptbereich ohne sichtbaren Titel (Operativ/Verwaltung/Administrativ/Konfiguration, Jamil #7191); nur Blöcke mit Einträgen. */
	gruppen: NavGruppe[];
	/** Alle Block-Einträge flach (z. B. für die Brotkrume und „Mehr“-Erkennung). */
	mehr: NavEintrag[];
};

type NavNutzer = { istAdmin: boolean; betriebId: string | null; rechte: readonly string[] };

/** Am Handy unten so viele Hauptbereiche, der Rest steht unter „Mehr“. */
export const MOBIL_HAUPT = 4;

/** `extras.nextcloud`: Nextcloud-Anbindung ist auf diesem Server eingerichtet (NEXTCLOUD_URL). */
export function baueNavigation(nutzer: NavNutzer, module: readonly string[], extras: { nextcloud?: boolean } = {}): Navigation {
	const hat = (recht: string) => nutzer.rechte.includes(recht);
	const haupt: NavEintrag[] = [{ name: 'Start', href: '/', symbol: 'start' }];
	// Vier Blöcke OHNE sichtbare Überschrift (Jamil #7191); die Titel dienen nur als Screenreader-Label, getrennt
	// werden die Blöcke optisch durch eine feine Trennlinie:
	//   Operativ      – das tägliche Arbeiten (Hauptbereich oben + eigene Zeiten)
	//   Verwaltung    – Vorlagen, Katalog/Kalkulation, nachgelagerte Belege, Partner
	//   Administrativ – Auswertung, Personal, Organisation
	//   Konfiguration – Einstellungen, Stammdaten, Technik, Benutzer/Rollen
	// Zuordnung ist fachlich; die Rechte-/Modul-Prüfung je Eintrag bleibt unverändert, damit nichts erscheint, das der
	// Nutzer nicht darf. Einträge erscheinen nur mit Modul UND Recht; leere Blöcke werden nicht gezeigt.
	const g: Record<'operativ' | 'verwaltung' | 'administrativ' | 'konfiguration', NavEintrag[]> = {
		operativ: [],
		verwaltung: [],
		administrativ: [],
		konfiguration: []
	};

	if (nutzer.betriebId) {
		const auftraegeLesen = module.includes('auftraege') && (hat('auftraege.lesen') || hat('auftraege.alle_lesen'));
		const angeboteMitPreisen = module.includes('angebote') && hat('angebote.bearbeiten') && hat('preise.sehen');

		// ── Operativ (Hauptbereich): feste Reihenfolge von Jamil (msg 2815); dies ist der mobile Leisten-Inhalt
		if (module.includes('kunden') && hat('kunden.lesen')) haupt.push({ name: 'Kunden', href: '/kunden', symbol: 'kunden' });
		if (auftraegeLesen) haupt.push({ name: 'Aufträge', href: '/auftraege', symbol: 'auftraege' });
		// Ausgangsbelege (Jamil msg 2948, früher „Angebote“): Reiter Angebote, Auftragsbestätigungen, Rechnungen.
		// Belege enthalten Preise: nur mit `angebote.bearbeiten` UND `preise.sehen` (Monteur nie)
		if (angeboteMitPreisen) haupt.push({ name: 'Ausgangsbelege', href: '/ausgangsbelege', symbol: 'angebote' });
		// Plantafel: wer plant oder alle Aufträge sieht. Monteure sehen ihre Einsätze auf „Start“.
		if (module.includes('plantafel') && (hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen'))) {
			haupt.push({ name: 'Plantafel', href: '/plantafel', symbol: 'plantafel' });
		}
		if (auftraegeLesen) {
			// Auftragskarte mit Route (Wunsch Jamil msg 2602) – Monteure sehen nur ihre Aufträge
			haupt.push({ name: 'Karte', href: '/karte', symbol: 'plantafel' });
			haupt.push({ name: 'Aufgaben', href: '/todos', symbol: 'todos' });
		}
		// Die eigene Arbeitszeit gehört zum täglichen Arbeiten (Operativ), direkt unter dem Hauptbereich
		if (module.includes('zeiterfassung') && (hat('zeiterfassung.nutzen') || hat('zeiterfassung.alle_sehen'))) {
			g.operativ.push({ name: 'Zeiten', href: '/zeiten', symbol: 'abwesenheiten' });
		}

		// ── Verwaltung: Vorlagen, Katalog/Kalkulation, nachgelagerte Belege, Partner
		if (auftraegeLesen) g.verwaltung.push({ name: 'Auftrags-Vorlagen', href: '/auftrag-vorlagen', symbol: 'todos' });
		if (angeboteMitPreisen) g.verwaltung.push({ name: 'Angebots-Vorlagen', href: '/angebot-vorlagen', symbol: 'angebote' });
		if (module.includes('protokolle') && hat('protokolle.vorlagen_bearbeiten')) {
			// EIN Menüpunkt für Protokoll- und Aufmaß-Vorlagen (Jamil msgs 3533/3535) mit zwei Reitern; die Aufmaß-Seite
			// (/einstellungen/aufmass-vorlagen) gehört über AUCH_AKTIV dazu – markiert ist immer genau dieser eine Eintrag (msg 3085)
			g.verwaltung.push({ name: 'Protokoll- & Aufmaß-Vorlagen', href: '/einstellungen/protokoll-vorlagen', symbol: 'angebote' });
		}
		// E-Mail-Vorlagen an einem Ort (Jamil msg 2789)
		if (hat('vorlagen.verwalten')) g.verwaltung.push({ name: 'E-Mail-Vorlagen', href: '/einstellungen/mail-vorlagen', symbol: 'angebote' });
		if (module.includes('katalog') && (hat('katalog.bearbeiten') || hat('angebote.bearbeiten'))) {
			g.verwaltung.push({ name: 'Katalog', href: '/katalog', symbol: 'katalog' });
		}
		// Kalkulation / Stundensatz: Gehälter sind vertraulich – „Preise sehen“ UND „Einstellungen“ (Chef)
		if (module.includes('katalog') && hat('preise.sehen') && hat('einstellungen')) {
			g.verwaltung.push({ name: 'Kalkulation', href: '/kalkulation', symbol: 'katalog' });
		}
		// Nachfassen (Angebote), Mahnstufen und Rechnungs-Erinnerung sind die nachgelagerten Belegprozesse
		if (hat('einstellungen') && module.includes('angebote')) g.verwaltung.push({ name: 'Nachfassen', href: '/einstellungen/nachfassen', symbol: 'angebote' });
		if (module.includes('lexware') && hat('mahnungen.verwalten')) g.verwaltung.push({ name: 'Mahnungen', href: '/einstellungen/mahnungen', symbol: 'angebote' });
		// Erinnerung „Rechnung erstellen“ bei Abnahme – wer sie bekommt (Jamil msg 6530)
		if (module.includes('auftraege') && hat('einstellungen')) g.verwaltung.push({ name: 'Erinnerung Rechnung', href: '/einstellungen/rechnung-erinnerung', symbol: 'angebote' });
		// Partner (Auftraggeber, Subunternehmer, Lieferanten, msgs 2856/3089)
		if (module.includes('auftraege') && hat('partner.verwalten')) g.verwaltung.push({ name: 'Partner', href: '/partner', symbol: 'kunden' });

		// ── Administrativ: Auswertungen, dann Personal/Organisation
		// Kennzahlen-Cockpit (Jamil msg 2858): über den ganzen Betrieb, deshalb „Alle Aufträge ansehen“
		if (module.includes('auftraege') && hat('auftraege.alle_lesen')) g.administrativ.push({ name: 'Kennzahlen', href: '/auswertung/kennzahlen', symbol: 'katalog' });
		if (module.includes('zeiterfassung') && hat('preise.sehen') && hat('auftraege.alle_lesen')) {
			g.administrativ.push({ name: 'Nachkalkulation', href: '/auswertung/nachkalkulation', symbol: 'katalog' });
		}
		if (module.includes('plantafel') && (hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen'))) {
			g.administrativ.push({ name: 'Auslastung', href: '/plantafel/auslastung', symbol: 'plantafel' });
		}
		if (hat('einstellungen') && module.includes('auftraege')) {
			g.administrativ.push({ name: 'Auswertung Auftragsquellen', href: '/auswertung/quellen', symbol: 'auftraege' });
		}
		// Kennzahlen einstellen (Jamil msg 2946): bei den Auswertungen, weil es deren Inhalt steuert
		if (module.includes('auftraege') && hat('kennzahlen.verwalten')) g.administrativ.push({ name: 'Kennzahlen einstellen', href: '/einstellungen/kennzahlen', symbol: 'katalog' });
		// Personal/Organisation: Abwesenheiten und Kolonnen (Plantafel-Planung)
		if (module.includes('plantafel') && hat('plantafel.bearbeiten')) {
			g.administrativ.push({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten', symbol: 'abwesenheiten' });
			g.administrativ.push({ name: 'Kolonnen', href: '/plantafel/kolonnen', symbol: 'benutzer' });
		}

		// ── Konfiguration: Kundenweg-Einstellungen, Firmenprofil/Technik, Benutzer/Rollen
		// Auftragsquellen und Terminarten/Online-Buchung steuern, wie Anfragen und Termine entstehen
		if (hat('einstellungen') && module.includes('auftraege')) g.konfiguration.push({ name: 'Auftragsquellen', href: '/einstellungen/quellen', symbol: 'auftraege' });
		// Terminarten (Jamil msg 3074): eine Liste für Plantafel und Online-Buchung (früher „Dienste“ unter Online-Buchung)
		if (module.includes('auftraege') && module.includes('plantafel') && hat('buchung.verwalten')) {
			g.konfiguration.push({ name: 'Terminarten', href: '/einstellungen/terminarten', symbol: 'plantafel' });
			// Online-Buchung (Wunsch Jamil msgs 2684/2686): Buchungen, Arbeitszeiten, Datenschutz/Einbetten
			g.konfiguration.push({ name: 'Online-Buchung', href: '/einstellungen/online-buchung', symbol: 'plantafel' });
		}
		// Leitfaden beim Termin (Jamil msgs 4302/4304, 4340): erster Termin beim Kunden
		if (hat('einstellungen') && module.includes('plantafel')) g.konfiguration.push({ name: 'Leitfaden beim Termin', href: '/einstellungen/leitfaden', symbol: 'todos' });
		// Kundenportal & Auftragsbestätigung (seit msg 3534 auch „Leistungen für Bestandskunden“)
		if (hat('einstellungen') && module.includes('angebote')) g.konfiguration.push({ name: 'Kundenportal & Auftragsbestätigung', href: '/einstellungen/kundenportal', symbol: 'angebote' });
		// Firmenprofil und Technik
		if (hat('einstellungen')) g.konfiguration.push({ name: 'Funktionen & Automatisierungen', href: '/einstellungen/funktionen', symbol: 'angebote' });
		// Briefkopf und Logo (für Angebote): Betriebsdaten, ohne Modulbindung
		if (hat('einstellungen')) g.konfiguration.push({ name: 'Briefkopf / Firmenprofil', href: '/einstellungen/briefkopf', symbol: 'briefkopf' });
		// Postfach für den Mailversand des CRM (Plan Lexware Phase 1): Angebote, AB, Rechnungen gehen aus dem CRM hinaus
		if (hat('einstellungen')) g.konfiguration.push({ name: 'E-Mail-Versand', href: '/einstellungen/mail', symbol: 'briefkopf' });
		// Lexware Office (Tarif XL) als Belegsystem: Schlüssel, Rückmeldungen, Kunden-Abgleich
		if (hat('einstellungen') && module.includes('lexware')) g.konfiguration.push({ name: 'Lexware verbinden', href: '/einstellungen/lexware', symbol: 'angebote' });
		if (hat('erinnerungen.nutzen')) g.konfiguration.push({ name: 'Erinnerungen', href: '/konto/benachrichtigungen', symbol: 'todos' });
		// Handy-Abgleich der eigenen Aufgaben per CalDAV (Jamil msgs 2964/2980): wer Aufgaben sieht
		if (auftraegeLesen) g.konfiguration.push({ name: 'Handy verbinden', href: '/konto/handy', symbol: 'todos' });
		// Was ist neu (Jamil msg 3423): für alle Benutzer eines Betriebs
		g.konfiguration.push({ name: 'Was ist neu', href: '/neu', symbol: 'start' });
		// Benutzeradministration (msg 2819)
		if (hat('benutzer.verwalten')) {
			g.konfiguration.push({ name: 'Benutzer', href: '/einstellungen/benutzer', symbol: 'benutzer' });
			// Nextcloud-Anbindung (optional): Konten verknüpfen, Abgleich-Status
			if (extras.nextcloud) g.konfiguration.push({ name: 'Nextcloud', href: '/einstellungen/nextcloud', symbol: 'benutzer' });
		}
		if (hat('einstellungen')) g.konfiguration.push({ name: 'Rollen', href: '/einstellungen/rollen', symbol: 'rollen' });
	} else if (nutzer.istAdmin) {
		g.konfiguration.push({ name: 'Plattform-Verwaltung', href: '/admin', symbol: 'admin' });
	}
	// Titel NICHT sichtbar (Jamil #7191) – nur als Screenreader-Label der Blöcke
	const TITEL: Record<string, string> = {
		operativ: 'Operativ',
		verwaltung: 'Verwaltung',
		administrativ: 'Administrativ',
		konfiguration: 'Konfiguration'
	};
	const gruppen = Object.entries(g)
		.filter(([, e]) => e.length > 0)
		.map(([id, eintraege]) => ({ id, titel: TITEL[id], eintraege }));
	return { haupt, gruppen, mehr: gruppen.flatMap((x) => x.eintraege) };
}

/** Bereiche, zu denen weitere Pfade gehören: ein einzelnes Angebot (/angebote/<id>) liegt in „Ausgangsbelege“. */
const AUCH_AKTIV: Record<string, readonly string[]> = { '/ausgangsbelege': ['/angebote'], '/einstellungen/protokoll-vorlagen': ['/einstellungen/aufmass-vorlagen'] };

/** Liegt `pfad` in einem Bereich, der zu `href` gehört? „/“ nur exakt. Mehrere Einträge können zutreffen
 * (z. B. „Plantafel“ und „Abwesenheiten“ für /plantafel/abwesenheiten) – markiert wird nur `aktiverEintrag`. */
export function istAktiv(href: string | null, pfad: string): boolean {
	if (!href) return false;
	if (href === '/') return pfad === '/';
	return [href, ...(AUCH_AKTIV[href] ?? [])].some((h) => pfad === h || pfad.startsWith(h + '/'));
}

/**
 * Ist `pfad` die Startseite des Bereichs `href` – genau dessen Adresse oder eine gleichrangige Reiter-Adresse aus AUCH_AKTIV
 * (z. B. /einstellungen/aufmass-vorlagen zu „Protokoll- & Aufmaß-Vorlagen“)? Dort steht der Titel schon in der Kopfleiste,
 * die h1 wird nur für Screenreader behalten (Jamil msgs 3060, 3569).
 */
export function istBereichsStart(href: string | null, pfad: string): boolean {
	if (!href) return false;
	const h = href.split('?')[0];
	return h === pfad || (AUCH_AKTIV[h] ?? []).some((x) => x === pfad && !x.startsWith('/angebote'));
}

/**
 * Der EINE markierte Eintrag für `pfad` (Jamil msg 3085: nie zwei Menüpunkte gleichzeitig): unter allen zutreffenden
 * Einträgen der genaueste, d. h. der mit dem längsten Pfad. `null`, wenn keiner passt.
 */
export function aktiverEintrag<T extends { href: string | null }>(eintraege: readonly T[], pfad: string): T | null {
	let bester: T | null = null;
	for (const e of eintraege) {
		if (e.href && istAktiv(e.href, pfad) && (!bester || e.href.length > bester.href!.length)) bester = e;
	}
	return bester;
}
