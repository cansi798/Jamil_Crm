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
	// Reihenfolge = Reihenfolge im Menü: zuerst der Weg des Kunden (Jamil msg 3423), dann Vorlagen, Team, Auswertungen, Allgemeines
	const g: Record<string, NavEintrag[]> = { anfrage: [], angebot: [], auftrag: [], danach: [], vorlagen: [], personal: [], auswertungen: [], allgemein: [], benutzer: [] };

	if (nutzer.betriebId) {
		const auftraegeLesen = module.includes('auftraege') && (hat('auftraege.lesen') || hat('auftraege.alle_lesen'));
		const angeboteMitPreisen = module.includes('angebote') && hat('angebote.bearbeiten') && hat('preise.sehen');
		// Hauptbereich in der Reihenfolge von Jamil (msg 2815)
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

		// Vorlagen
		if (auftraegeLesen) g.vorlagen.push({ name: 'Auftrags-Vorlagen', href: '/auftrag-vorlagen', symbol: 'todos' });
		if (angeboteMitPreisen) g.vorlagen.push({ name: 'Angebots-Vorlagen', href: '/angebot-vorlagen', symbol: 'angebote' });
		if (module.includes('protokolle') && hat('protokolle.vorlagen_bearbeiten')) {
			g.vorlagen.push({ name: 'Protokoll-Vorlagen', href: '/einstellungen/protokoll-vorlagen', symbol: 'angebote' });
			// Aufmaß-Vorlagen (Jamil msg 2842): gleicher Baukasten, eigene Liste – mit eigenem Pfad, damit im Menü nur
			// „Aufmaß-Vorlagen“ markiert ist und nicht auch „Protokoll-Vorlagen“ (Jamil msg 3085)
			g.vorlagen.push({ name: 'Aufmaß-Vorlagen', href: '/einstellungen/aufmass-vorlagen', symbol: 'katalog' });
		}
		// E-Mail-Vorlagen an einem Ort (Jamil msg 2789)
		if (hat('vorlagen.verwalten')) g.vorlagen.push({ name: 'E-Mail-Vorlagen', href: '/einstellungen/mail-vorlagen', symbol: 'angebote' });

		// Der Weg des Kunden (Jamil msg 3423): Einstellungen stehen dort, wo der Kunde sie erlebt –
		// 1. Anfrage: Woher kommt der Auftrag, wie kommen Termine zustande
		if (hat('einstellungen') && module.includes('auftraege')) g.anfrage.push({ name: 'Auftragsquellen', href: '/einstellungen/quellen', symbol: 'auftraege' });
		// Terminarten (Jamil msg 3074): eine Liste für Plantafel und Online-Buchung (früher „Dienste“ unter Online-Buchung)
		if (module.includes('auftraege') && module.includes('plantafel') && hat('buchung.verwalten')) {
			g.anfrage.push({ name: 'Terminarten', href: '/einstellungen/terminarten', symbol: 'plantafel' });
			// Online-Buchung (Wunsch Jamil msgs 2684/2686): Buchungen, Arbeitszeiten, Datenschutz/Einbetten
			g.anfrage.push({ name: 'Online-Buchung', href: '/einstellungen/online-buchung', symbol: 'plantafel' });
		}
		// 2. Angebot: Katalog, Kalkulation, Nachfassen
		if (module.includes('katalog') && (hat('katalog.bearbeiten') || hat('angebote.bearbeiten'))) {
			g.angebot.push({ name: 'Katalog', href: '/katalog', symbol: 'katalog' });
		}
		// Kalkulation / Stundensatz: Gehälter sind vertraulich – „Preise sehen“ UND „Einstellungen“ (Chef)
		if (module.includes('katalog') && hat('preise.sehen') && hat('einstellungen')) {
			g.angebot.push({ name: 'Kalkulation', href: '/kalkulation', symbol: 'katalog' });
		}
		if (hat('einstellungen') && module.includes('angebote')) g.angebot.push({ name: 'Nachfassen', href: '/einstellungen/nachfassen', symbol: 'angebote' });
		// 3. Auftrag: Kundenportal und Auftragsbestätigung
		if (hat('einstellungen') && module.includes('angebote')) g.auftrag.push({ name: 'Kundenportal & Auftragsbestätigung', href: '/einstellungen/kundenportal', symbol: 'angebote' });
		// 4. Abschluss & danach: Leistungen für Bestandskunden im Portal (Jamil msg 3408)
		if (hat('einstellungen') && module.includes('angebote')) g.danach.push({ name: 'Leistungen für Bestandskunden', href: '/einstellungen/bestandskunden', symbol: 'angebote' });

		// Team & Partner (Jamil msg 3089: Partner zu „Personal & Zeiten“, Gruppe umbenannt): Menschen, mit denen der Betrieb
		// arbeitet – eigenes Personal (Zeiten, Abwesenheiten, Kolonnen) und Partner (Auftraggeber, Subunternehmer, Lieferanten, msg 2856)
		if (module.includes('zeiterfassung') && (hat('zeiterfassung.nutzen') || hat('zeiterfassung.alle_sehen'))) {
			g.personal.push({ name: 'Zeiten', href: '/zeiten', symbol: 'abwesenheiten' });
		}
		if (module.includes('plantafel') && hat('plantafel.bearbeiten')) {
			g.personal.push({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten', symbol: 'abwesenheiten' });
			g.personal.push({ name: 'Kolonnen', href: '/plantafel/kolonnen', symbol: 'benutzer' });
		}
		if (module.includes('auftraege') && hat('partner.verwalten')) g.personal.push({ name: 'Partner', href: '/partner', symbol: 'kunden' });

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

		// Kennzahlen einstellen (Jamil msg 2946): bei den Auswertungen, weil es deren Inhalt steuert
		if (module.includes('auftraege') && hat('kennzahlen.verwalten')) g.auswertungen.push({ name: 'Kennzahlen einstellen', href: '/einstellungen/kennzahlen', symbol: 'katalog' });

		// Allgemein: Übersicht aller Automatisierungen, Firmenprofil, persönliche Einstellungen, Neuigkeiten
		if (hat('einstellungen')) g.allgemein.push({ name: 'Funktionen & Automatisierungen', href: '/einstellungen/funktionen', symbol: 'angebote' });
		// Briefkopf und Logo (für Angebote): Betriebsdaten, ohne Modulbindung
		if (hat('einstellungen')) g.allgemein.push({ name: 'Briefkopf / Firmenprofil', href: '/einstellungen/briefkopf', symbol: 'briefkopf' });
		if (hat('erinnerungen.nutzen')) g.allgemein.push({ name: 'Erinnerungen', href: '/konto/benachrichtigungen', symbol: 'todos' });
		// Handy-Abgleich der eigenen Aufgaben per CalDAV (Jamil msgs 2964/2980): wer Aufgaben sieht
		if (auftraegeLesen) g.allgemein.push({ name: 'Handy verbinden', href: '/konto/handy', symbol: 'todos' });
		// Was ist neu (Jamil msg 3423): für alle Benutzer eines Betriebs
		g.allgemein.push({ name: 'Was ist neu', href: '/neu', symbol: 'start' });

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
		anfrage: 'Anfrage',
		angebot: 'Angebot',
		auftrag: 'Auftrag',
		danach: 'Abschluss & danach',
		vorlagen: 'Vorlagen',
		personal: 'Team & Partner',
		auswertungen: 'Auswertungen',
		allgemein: 'Allgemein',
		benutzer: nutzer.betriebId ? 'Benutzeradministration' : 'Plattform'
	};
	const gruppen = Object.entries(g)
		.filter(([, e]) => e.length > 0)
		.map(([id, eintraege]) => ({ id, titel: TITEL[id], eintraege }));
	return { haupt, gruppen, mehr: gruppen.flatMap((x) => x.eintraege) };
}

/** Bereiche, zu denen weitere Pfade gehören: ein einzelnes Angebot (/angebote/<id>) liegt in „Ausgangsbelege“. */
const AUCH_AKTIV: Record<string, readonly string[]> = { '/ausgangsbelege': ['/angebote'] };

/** Liegt `pfad` in einem Bereich, der zu `href` gehört? „/“ nur exakt. Mehrere Einträge können zutreffen
 * (z. B. „Plantafel“ und „Abwesenheiten“ für /plantafel/abwesenheiten) – markiert wird nur `aktiverEintrag`. */
export function istAktiv(href: string | null, pfad: string): boolean {
	if (!href) return false;
	if (href === '/') return pfad === '/';
	return [href, ...(AUCH_AKTIV[href] ?? [])].some((h) => pfad === h || pfad.startsWith(h + '/'));
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
