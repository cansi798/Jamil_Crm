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

export function baueNavigation(nutzer: NavNutzer, module: readonly string[]): Navigation {
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
		if (auftraegeLesen) {
			mehr.push({ name: 'To-dos', href: '/todos', symbol: 'todos' });
		}
		if (module.includes('plantafel') && hat('plantafel.bearbeiten')) {
			mehr.push({ name: 'Abwesenheiten', href: '/plantafel/abwesenheiten', symbol: 'abwesenheiten' });
		}
		if (hat('benutzer.verwalten')) {
			mehr.push({ name: 'Benutzer', href: '/einstellungen/benutzer', symbol: 'benutzer' });
		}
		if (hat('einstellungen')) {
			mehr.push({ name: 'Rollen', href: '/einstellungen/rollen', symbol: 'rollen' });
			// Briefkopf und Logo (für Angebote): Betriebsdaten, ohne Modulbindung
			mehr.push({ name: 'Briefkopf', href: '/einstellungen/briefkopf', symbol: 'briefkopf' });
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
