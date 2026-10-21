/**
 * Gespeicherte Ansichten (Jamil msgs 2830, 2921) – ohne Server, auch im Browser.
 * Nicht gespeichert werden Parameter, die nur „wo bin ich gerade“ beschreiben: der angezeigte Tag der Plantafel bzw.
 * Tag/Monat der Zeiten – eine Ansicht soll immer vom heutigen Tag bzw. aktuellen Monat ausgehen.
 */
export const OHNE_PARAMETER: Record<string, readonly string[]> = {
	plantafel: ['tag'],
	zeiten: ['tag', 'monat']
};

/**
 * Marker „ausdrücklich keine Filter“ (`?alle=1`): Die Filterleisten setzen ihn, wenn alles abgewählt ist – so
 * unterscheidet sich das vom ersten Besuch (leere Adresse), bei dem die Standard-Ansicht greift. Nie gespeichert.
 */
export const OHNE_FILTER = 'alle';

/** Query ohne „?“, ohne leere Werte und ohne die ausgenommenen Parameter der Seite. */
export function filterQuery(seite: string, q: string): string {
	const ohne = new Set([...(OHNE_PARAMETER[seite] ?? []), OHNE_FILTER]);
	const aus = new URLSearchParams();
	for (const [k, v] of new URLSearchParams(q.replace(/^\?/, ''))) if (v !== '' && !ohne.has(k)) aus.append(k, v);
	return aus.toString();
}

/** Vergleichsschlüssel (Reihenfolge egal) – „ist diese Ansicht gerade offen?“. */
export function querySchluessel(seite: string, q: string): string {
	return [...new URLSearchParams(filterQuery(seite, q))].map(([k, v]) => `${k}=${v}`).sort().join('&');
}
