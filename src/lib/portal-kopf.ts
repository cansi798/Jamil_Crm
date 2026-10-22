import { kontrast } from './farbe';

/**
 * Welches Logo steht im Kopf des Kundenportals (Jamil msgs 3088, 3126)? Entscheidend ist die tatsächliche Kopffarbe
 * (Einstellungen → Briefkopf → „Dunkle Farbe (Kopf)“) – sie kann auch hell sein:
 * - heller Kopf: das normale Logo, ohne Feld (nur wenn es keins gibt: die helle Variante auf dunklem Feld)
 * - dunkler Kopf: die helle Variante ohne Feld (nur wenn es keine gibt: das normale Logo auf weißem Feld)
 */
export type PortalLogo = { variante: 'briefkopf' | 'dunkel'; feld: 'weiss' | 'dunkel' | null };

export const STANDARD_KOPF = '#2d2c2e';

/** Heller Kopf = weiße Schrift wäre schlecht lesbar (Kontrast unter 3 : 1). */
export const kopfIstHell = (farbe: string | null | undefined) => kontrast(farbe || STANDARD_KOPF, '#ffffff') < 3;

export function portalLogo(kopfFarbe: string | null | undefined, hat: { briefkopf: boolean; dunkel: boolean }): PortalLogo | null {
	if (kopfIstHell(kopfFarbe)) {
		if (hat.briefkopf) return { variante: 'briefkopf', feld: null };
		return hat.dunkel ? { variante: 'dunkel', feld: 'dunkel' } : null;
	}
	if (hat.dunkel) return { variante: 'dunkel', feld: null };
	return hat.briefkopf ? { variante: 'briefkopf', feld: 'weiss' } : null;
}
