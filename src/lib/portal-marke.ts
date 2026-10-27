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
