/**
 * Farben der Auftragsquellen (Wunsch Jamil msgs 2670/2672): je Eintrag frei wählbar (Einstellungen → Auftragsquellen),
 * sinnvolle Vorgaben für die Startliste, Schriftfarbe automatisch hell oder dunkel (gut lesbar).
 */

export const STANDARD_QUELLEN_FARBEN: Record<string, string> = {
	website: '#0f6cbd',
	hornbach: '#e8730c',
	obi: '#c50f1f',
	empfehlung: '#107c10',
	zeitung: '#605e5c',
	myhammer: '#8764b8',
	telefon: '#038387',
	sonstiges: '#8a8886'
};

/** Weitere Farben für neue Einträge (der Reihe nach). */
export const FARB_PALETTE = ['#0f6cbd', '#e8730c', '#107c10', '#8764b8', '#038387', '#c239b3', '#986f0b', '#c50f1f', '#4f6bed', '#605e5c'];

export const istFarbe = (w: unknown): w is string => typeof w === 'string' && /^#[0-9a-f]{6}$/i.test(w);

/** Vorgabe: bekannte Namen (Startliste) feste Farbe, sonst aus der Palette nach Position. */
export function standardFarbe(name: string, position = 0): string {
	return STANDARD_QUELLEN_FARBEN[name.trim().toLowerCase()] ?? FARB_PALETTE[Math.abs(position) % FARB_PALETTE.length];
}

/** Relative Leuchtdichte nach WCAG. */
function leuchtdichte(hex: string): number {
	const kanal = (i: number) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
}

/** Schriftfarbe auf dem Etikett: weiß oder fast schwarz – je nachdem, was mehr Kontrast hat. */
export function schriftAuf(hex: string): '#ffffff' | '#1c1f23' {
	if (!istFarbe(hex)) return '#1c1f23';
	const l = leuchtdichte(hex);
	const zuWeiss = 1.05 / (l + 0.05);
	const zuDunkel = (l + 0.05) / (leuchtdichte('#1c1f23') + 0.05);
	return zuWeiss >= zuDunkel ? '#ffffff' : '#1c1f23';
}
