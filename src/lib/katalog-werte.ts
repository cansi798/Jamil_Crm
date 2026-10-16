/**
 * Gewerke und Einheiten des Leistungskatalogs – ohne Serverbezug (Formulare, Filter, Positionen-Editor).
 * Entspricht den Prüfungen in Migration 013 (`app.einheit`, Gewerk-Check).
 */

export const GEWERKE = ['bad_sanitaer', 'fliesen', 'maler', 'trockenbau'] as const;
export type Gewerk = (typeof GEWERKE)[number];

export const GEWERK_NAMEN: Record<Gewerk, string> = {
	bad_sanitaer: 'Bad/Sanitär',
	fliesen: 'Fliesen',
	maler: 'Maler',
	trockenbau: 'Trockenbau'
};

export const istGewerk = (w: unknown): w is Gewerk => typeof w === 'string' && (GEWERKE as readonly string[]).includes(w);

export const EINHEITEN = ['Stk', 'm²', 'm', 'lfm', 'm³', 'h', 'psch', 'kg', 'l'] as const;
export type Einheit = (typeof EINHEITEN)[number];

export const istEinheit = (w: unknown): w is Einheit => typeof w === 'string' && (EINHEITEN as readonly string[]).includes(w);
