/**
 * Navigation der App-Hülle – ohne Serverbezug, damit sie testbar und in Komponenten nutzbar ist.
 * Ein Eintrag erscheint nur, wenn der Tarif das Modul enthält UND der Benutzer das Recht hat. Die Oberfläche blendet
 * damit nur aus; geprüft wird immer serverseitig in Seiten und API.
 */

export type Symbol = 'start' | 'kunden' | 'plantafel' | 'mehr' | 'benutzer' | 'rollen' | 'admin';

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
		if (module.includes('kunden') && hat('kunden.lesen')) {
			haupt.push({ name: 'Kunden', href: '/kunden', symbol: 'kunden' });
		}
		// Plantafel kommt mit Plan 1b; sichtbar für alle, die dort planen oder ihre Aufträge sehen würden.
		if (
			module.includes('plantafel') &&
			(hat('plantafel.bearbeiten') || hat('auftraege.alle_lesen') || hat('auftraege.lesen'))
		) {
			haupt.push({ name: 'Plantafel', href: null, symbol: 'plantafel', hinweis: 'bald verfügbar' });
		}
		if (hat('benutzer.verwalten')) {
			mehr.push({ name: 'Benutzer', href: '/einstellungen/benutzer', symbol: 'benutzer' });
		}
		if (hat('einstellungen')) {
			mehr.push({ name: 'Rollen', href: '/einstellungen/rollen', symbol: 'rollen' });
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
