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

export type Navigation = {
	/** Hauptbereiche: unten in der Leiste (schmal) bzw. oben in der Seitenleiste (breit). */
	haupt: NavEintrag[];
	/** Verwaltung u. Ä.: auf schmalen Bildschirmen hinter „Mehr“, in der Seitenleiste direkt sichtbar. */
	mehr: NavEintrag[];
};

type NavNutzer = { istAdmin: boolean; betriebId: string | null; rechte: readonly string[] };

/** `extras.nextcloud`: Nextcloud-Anbindung ist auf diesem Server eingerichtet (NEXTCLOUD_URL). */
export function baueNavigation(nutzer: NavNutzer, module: readonly string[], extras: { nextcloud?: boolean } = {}): Navigation {
	const hat = (recht: string) => nutzer.rechte.includes(recht);
	const haupt: NavEintrag[] = [{ name: 'Start', href: '/', symbol: 'start' }];
	const mehr: NavEintrag[] = [];

	if (nutzer.betriebId) {
		const auftraegeLesen = module.includes('auftraege') && (hat('auftraege.lesen') || hat('auftraege.alle_lesen'));
		if (module.includes('kunden') && hat('kunden.lesen')) {
			haupt.push({ name: 'Kunden', href: '/kunden', symbol: 'kunden' });
		}
		if (auftraegeLesen) {
			haupt.push({ name: 'Aufträge', href: '/auftraege', symbol: 'auftraege' });
		}
		// Plantafel: wer plant oder alle Aufträge sieht. Monteure (nur eigene Aufträge) sehen ihre Einsätze auf „Start“.
		if (module.includes('plantafel') && (hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen'))) {
			haupt.push({ name: 'Plantafel', href: '/plantafel', symbol: 'plantafel' });
		}
		// Angebote bestehen aus Preisen: nur mit `angebote.bearbeiten` UND `preise.sehen` (Monteur nie)
		if (module.includes('angebote') && hat('angebote.bearbeiten') && hat('preise.sehen')) {
			haupt.push({ name: 'Angebote', href: '/angebote', symbol: 'angebote' });
		}
		if (auftraegeLesen) {
			mehr.push({ name: 'To-dos', href: '/todos', symbol: 'todos' });
			// Auftragskarte mit Route (Wunsch Jamil msg 2602) – Monteure sehen nur ihre Aufträge
			mehr.push({ name: 'Karte', href: '/karte', symbol: 'plantafel' });
			mehr.push({ name: 'Auftrags-Vorlagen', href: '/auftrag-vorlagen', symbol: 'todos' });
		}
		// Zeiterfassung (Wunsch Jamil msgs 2770–2774): eigene Zeiten bzw. alle (Chef/Büro), Tätigkeiten ohne Auftrag
		if (module.includes('zeiterfassung') && (hat('zeiten.erfassen') || hat('zeiten.verwalten'))) {
			mehr.push({ name: 'Zeiten', href: '/zeiten', symbol: 'abwesenheiten' });
		}
		if (module.includes('zeiterfassung') && hat('zeiten.verwalten')) {
			mehr.push({ name: 'Tätigkeiten ohne Auftrag', href: '/einstellungen/zeiterfassung', symbol: 'todos' });
		}
		// Nachkalkulation (Plan/Ist): Preise + alle Aufträge (Chef/Büro)
		if (module.includes('zeiterfassung') && hat('preise.sehen') && hat('auftraege.alle_lesen')) {
			mehr.push({ name: 'Nachkalkulation', href: '/auswertung/nachkalkulation', symbol: 'katalog' });
		}
		if (module.includes('plantafel') && hat('plantafel.bearbeiten')) {
			mehr.push({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten', symbol: 'abwesenheiten' });
		}
		if (module.includes('katalog') && (hat('katalog.bearbeiten') || hat('angebote.bearbeiten'))) {
			mehr.push({ name: 'Katalog', href: '/katalog', symbol: 'katalog' });
		}
		// Angebots-Vorlagen enthalten Preise: wie Angebote nur mit `angebote.bearbeiten` UND `preise.sehen`
		if (module.includes('angebote') && hat('angebote.bearbeiten') && hat('preise.sehen')) {
			mehr.push({ name: 'Angebots-Vorlagen', href: '/angebot-vorlagen', symbol: 'angebote' });
		}
		// Kalkulation / Stundensatz: Gehälter sind vertraulich – „Preise sehen“ UND „Einstellungen“ (Chef)
		if (module.includes('katalog') && hat('preise.sehen') && hat('einstellungen')) {
			mehr.push({ name: 'Kalkulation', href: '/kalkulation', symbol: 'katalog' });
		}
		// Protokoll-Vorlagen (frei gestaltbare Formulare, Wunsch Jamil msg 2649): Chef/Büro
		if (module.includes('protokolle') && hat('protokolle.vorlagen_bearbeiten')) {
			mehr.push({ name: 'Protokoll-Vorlagen', href: '/einstellungen/protokoll-vorlagen', symbol: 'angebote' });
		}
		// Online-Buchung (Wunsch Jamil msgs 2684/2686): Dienste, Buchungslinks, Arbeitszeiten
		if (module.includes('auftraege') && module.includes('plantafel') && hat('buchung.verwalten')) {
			mehr.push({ name: 'Online-Buchung', href: '/einstellungen/online-buchung', symbol: 'plantafel' });
		}
		if (hat('benutzer.verwalten')) {
			mehr.push({ name: 'Benutzer', href: '/einstellungen/benutzer', symbol: 'benutzer' });
			// Nextcloud-Anbindung (optional): Konten verknüpfen, Abgleich-Status
			if (extras.nextcloud) mehr.push({ name: 'Nextcloud', href: '/einstellungen/nextcloud', symbol: 'benutzer' });
		}
		if (hat('einstellungen')) {
			mehr.push({ name: 'Rollen', href: '/einstellungen/rollen', symbol: 'rollen' });
			// Briefkopf und Logo (für Angebote): Betriebsdaten, ohne Modulbindung
			mehr.push({ name: 'Briefkopf', href: '/einstellungen/briefkopf', symbol: 'briefkopf' });
			// Automatisches Nachfassen (Angebote/Rechnungen): Stufen, Mail-Vorlagen, Signatur – Chef/Admin
			if (module.includes('angebote')) mehr.push({ name: 'Nachfassen', href: '/einstellungen/nachfassen', symbol: 'angebote' });
			// Kundenportal (AGB-Link) und Auftragsbestätigung automatisch (Jamil msg 2778)
			if (module.includes('angebote')) mehr.push({ name: 'Kundenportal & Auftragsbestätigung', href: '/einstellungen/kundenportal', symbol: 'angebote' });
			// Auftragsquellen und ihre Auswertung (Wunsch Jamil msg 2593)
			if (module.includes('auftraege')) {
				mehr.push({ name: 'Auftragsquellen', href: '/einstellungen/quellen', symbol: 'auftraege' });
				mehr.push({ name: 'Auswertung Auftragsquellen', href: '/auswertung/quellen', symbol: 'auftraege' });
			}
		}
	} else if (nutzer.istAdmin) {
		mehr.push({ name: 'Plattform-Verwaltung', href: '/admin', symbol: 'admin' });
	}
	return { haupt, mehr };
}

/** Ist `href` die aktuelle Seite bzw. ein Bereich, in dem sie liegt? „/“ nur exakt. */
export function istAktiv(href: string | null, pfad: string): boolean {
	if (!href) return false;
	if (href === '/') return pfad === '/';
	return pfad === href || pfad.startsWith(href + '/');
}
