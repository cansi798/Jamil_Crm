/**
 * Preisschutz: Wer das Recht `preise.sehen` nicht hat (z. B. Monteur), bekommt nirgends Preise. Die Dienste liefern
 * Preisfelder dann gar nicht erst aus (Felder fehlen, nicht `null`); `ohnePreise` ist das Sicherheitsnetz für
 * Antworten an solche Benutzer, `enthaeltPreisfeld` die Prüfung dafür (auch in Tests).
 */

export const PREISFELDER = ['lohnCent', 'materialCent', 'einzelpreisCent', 'summeCent', 'nettoCent', 'mwstCent', 'bruttoCent'] as const;

/** Spalten mit Preisen im Änderungsprotokoll (`vorher`/`nachher` sind Zeilen der Tabellen, snake_case). */
export const PREIS_SPALTEN = ['lohn_cent', 'material_cent', 'einzelpreis_cent'] as const;

const istObjekt = (w: unknown): w is Record<string, unknown> => w !== null && typeof w === 'object';

function enthaeltFeld(wert: unknown, felder: readonly string[], gesehen = new Set<unknown>()): boolean {
	if (!istObjekt(wert) || gesehen.has(wert)) return false;
	gesehen.add(wert);
	if (Array.isArray(wert)) return wert.some((w) => enthaeltFeld(w, felder, gesehen));
	for (const [k, v] of Object.entries(wert)) {
		if (felder.includes(k)) return true;
		if (enthaeltFeld(v, felder, gesehen)) return true;
	}
	return false;
}

function ohneFelder<T>(wert: T, felder: readonly string[]): T {
	if (!istObjekt(wert)) return wert;
	if (wert instanceof Date || wert instanceof Uint8Array) return wert;
	if (Array.isArray(wert)) return wert.map((w) => ohneFelder(w, felder)) as T;
	const neu: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(wert)) if (!felder.includes(k)) neu[k] = ohneFelder(v, felder);
	return neu as T;
}

/** Steckt irgendwo (rekursiv in Objekten und Listen) ein Preisfeld? */
export function enthaeltPreisfeld(wert: unknown): boolean {
	return enthaeltFeld(wert, PREISFELDER);
}

/** Kopie ohne Preisfelder (rekursiv); das Original bleibt unverändert. */
export function ohnePreise<T>(wert: T): T {
	return ohneFelder(wert, PREISFELDER);
}

/** Kopie ohne Preisspalten (für Einträge des Änderungsprotokolls). */
export function ohnePreisSpalten<T>(wert: T): T {
	return ohneFelder(wert, PREIS_SPALTEN);
}
