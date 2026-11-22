/** Erscheinungsbild des Portals je Betrieb (Migration 096, msg 2953) – leer = Standard */
export type PortalMarke = { dunkel: string | null; hintergrund: string | null; titelSchrift: 'montserrat' | 'inter'; textSchrift: 'inter' | 'opensans'; titelGross: boolean };

const SCHRIFT = { montserrat: "'Montserrat', 'Inter', system-ui, sans-serif", inter: "'Inter', system-ui, sans-serif", opensans: "'Open Sans', 'Inter', system-ui, sans-serif" };

/** CSS-Variablen des Portals (Farben, Schriften) – gleich im Portal und in der Vorschau der Einstellungen. */
export function portalMarkeStil(m: PortalMarke): string[] {
	return [
		`--pt-dunkel: ${m.dunkel ?? '#2d2c2e'}`,
		`--pt-grund: ${m.hintergrund ?? '#f6f4f0'}`,
		`--pt-titel: ${SCHRIFT[m.titelSchrift]}`,
		`--pt-text: ${SCHRIFT[m.textSchrift]}`,
		`--ui-schrift-titel: ${SCHRIFT[m.titelSchrift]}`,
		`--pt-gross: ${m.titelGross ? 'uppercase' : 'none'}`
	];
}

/** Erscheinungsbild aus einer Zeile von app.betrieb_profil (Spalten dunkel_farbe, hintergrund_farbe, titel_schrift,
 * text_schrift, titel_gross) – gleich für Kundenportal und Online-Buchung (msg 3662). */
export function markeAusProfil(b: Record<string, unknown> | null | undefined): PortalMarke {
	return {
		dunkel: typeof b?.dunkel_farbe === 'string' ? b.dunkel_farbe : null,
		hintergrund: typeof b?.hintergrund_farbe === 'string' ? b.hintergrund_farbe : null,
		titelSchrift: b?.titel_schrift === 'inter' ? 'inter' : 'montserrat',
		textSchrift: b?.text_schrift === 'opensans' ? 'opensans' : 'inter',
		titelGross: b?.titel_gross === true
	};
}
