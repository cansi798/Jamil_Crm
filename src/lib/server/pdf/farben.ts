import { farbTokens, kontrast } from '../../farbe';

/**
 * Farben der PDFs (Prüfbericht 21.11.2026, Can 23:21): dieselbe Hausfarbe wie die App – die Farbe des Betriebs bzw. das
 * Logo-Beige #c3a56f als Standard (`farbTokens` aus src/lib/farbe.ts) – statt des alten Navy #05346b. Lesbarkeit wie in
 * der App:
 * - `akzentText`: Hausfarbe als SCHRIFT auf Weiß (Firmenname, Titel), so weit abgedunkelt, dass ≥ 4,6 : 1 erreicht ist
 *   (Logo-Beige → #7f6b48);
 * - `flaeche`: zarte Tönung für Tabellenkopf/Bänder, darauf immer die dunkle Grundschrift;
 * - `primaer` + `primaerAuf`: die originale Hausfarbe als Fläche, Schrift darauf weiß oder fast schwarz (wie die Knöpfe).
 */
export type PdfFarben = { akzentText: string; flaeche: string; linie: string; primaer: string; primaerAuf: string };

export function pdfFarben(farbe: string | null | undefined): PdfFarben {
	const t = farbTokens(farbe);
	return {
		akzentText: t['--ui-akzent-text'],
		flaeche: t['--ui-akzent-zart'],
		linie: t['--ui-akzent-rand'],
		primaer: t['--ui-primaer'],
		primaerAuf: t['--ui-primaer-auf']
	};
}

/** Für Tests: Kontrast der Akzentschrift auf Weiß. */
export const akzentKontrast = (f: PdfFarben) => kontrast(f.akzentText, '#ffffff');
