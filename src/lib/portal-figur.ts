/**
 * Comic-Figuren im Kundenportal (Jamil msg 3113): statt Anfangsbuchstaben eine gezeichnete Figur je Person.
 * Die Rolle entscheidet die Figur – „Ihr persönlicher Projektbegleiter“ (Jamil msg 3120) bekommt die Büro-Figur (Hemd, Klemmbrett), Leute im
 * Außendienst die Monteur-Figur (Helm, Arbeitsjacke, Werkzeug). Die Anrede (Einstellungen → Benutzer) wählt die
 * männliche oder weibliche Fassung; ohne Anrede gilt die männliche Standardfigur.
 */

export type Anrede = 'herr' | 'frau';
export type FigurRolle = 'projektbegleiter' | 'monteur';
export type Figur = 'projektbegleiter' | 'projektbegleiterin' | 'monteur' | 'monteurin';

export const ANREDE_NAMEN: Record<Anrede, string> = { herr: 'Herr', frau: 'Frau' };

export const FIGUR_NAMEN: Record<Figur, string> = {
	projektbegleiter: 'Projektbegleiter',
	projektbegleiterin: 'Projektbegleiterin',
	monteur: 'Monteur',
	monteurin: 'Monteurin'
};

export function istAnrede(x: unknown): x is Anrede {
	return x === 'herr' || x === 'frau';
}

/** Figur aus Rolle und Anrede; unbekannte Anrede → männliche Standardfigur. */
export function figurFuer(rolle: FigurRolle, anrede: Anrede | null | undefined): Figur {
	const frau = anrede === 'frau';
	if (rolle === 'monteur') return frau ? 'monteurin' : 'monteur';
	return frau ? 'projektbegleiterin' : 'projektbegleiter';
}

/**
 * Rolle einer Person im Team des Auftrags: Wer alle Aufträge sieht (Chef, Büro), ist Projektbegleiter; alle anderen
 * (Monteure, eigene Außendienst-Rollen) sind Monteure – dieselbe Regel wie beim Start-Layout (`startRolle`).
 */
export function teamRolle(rechte: readonly string[] | null | undefined): FigurRolle {
	return rechte?.includes('auftraege.alle_lesen') ? 'projektbegleiter' : 'monteur';
}
