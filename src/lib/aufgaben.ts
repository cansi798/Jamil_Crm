import { tagDeutsch, tagKurz } from './zeit';

/**
 * Gemeinsame Helfer für Aufgaben (Browser und Server): Zeitraum als Text, Mitarbeiter-Auswahl mit Vorschlägen und
 * „Aufgaben-Vorlage übernehmen“ (Jamil msgs 2975/2977/2978).
 */

export type Zeitraum = { faellig: string | null; faelligZeit?: string | null; vonTag?: string | null; vonZeit?: string | null };

/** „20.10.2026“, „20.10.2026 10:00“ oder „Mo 20.10. – Mi 22.10.“ (mit Uhrzeiten, falls gesetzt); ohne Datum null. */
export function zeitraumText(z: Zeitraum): string | null {
	if (!z.faellig) return null;
	if (!z.vonTag) return `${tagDeutsch(z.faellig)}${z.faelligZeit ? ` ${z.faelligZeit}` : ''}`;
	const von = `${tagKurz(z.vonTag)}${z.vonZeit ? ` ${z.vonZeit}` : ''}`;
	const bis = z.vonTag === z.faellig ? (z.faelligZeit ?? '') : `${tagKurz(z.faellig)}${z.faelligZeit ? ` ${z.faelligZeit}` : ''}`;
	return bis ? `${von} – ${bis}` : von;
}

type Person = { id: string; name: string };

/**
 * Personen für die Mitarbeiter-Auswahl einer Auftrags-Aufgabe: Jeder Mitarbeiter des Betriebs ist wählbar (Jamil
 * msg 2978); die dem Auftrag zugewiesenen stehen als Vorschlag oben.
 */
export function personenMitVorschlag(alle: Person[], amAuftrag: Person[]): (Person & { gruppe?: string })[] {
	const ids = new Set(amAuftrag.map((p) => p.id));
	const oben = alle.filter((p) => ids.has(p.id));
	if (oben.length === 0) return alle;
	return [...oben.map((p) => ({ ...p, gruppe: 'Am Auftrag' })), ...alle.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, gruppe: 'Weitere Mitarbeiter' }))];
}

/** Titel zum Vergleichen (gleiche Aufgabe = gleicher Titel, ohne Groß/klein und Leerzeichen-Unterschiede). */
export const titelSchluessel = (titel: string) => titel.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');

export type VorlageModus = 'fehlende' | 'alle';
export const VORLAGE_MODI: readonly VorlageModus[] = ['fehlende', 'alle'];
export const istVorlageModus = (w: unknown): w is VorlageModus => w === 'fehlende' || w === 'alle';

/**
 * Welche Vorlagen-Aufgaben kommen dazu? `doppelt`: Titel, die am Auftrag schon eine Aufgabe haben. Mit „fehlende“
 * (Standard) fallen sie weg, mit „alle“ kommen sie trotzdem dazu.
 */
export function vorlageAufteilen<T extends { titel: string }>(
	vorlage: readonly T[],
	vorhandeneTitel: readonly string[],
	modus: VorlageModus
): { neu: T[]; doppelt: T[] } {
	const da = new Set(vorhandeneTitel.map(titelSchluessel));
	const doppelt = vorlage.filter((t) => da.has(titelSchluessel(t.titel)));
	return { neu: modus === 'alle' ? [...vorlage] : vorlage.filter((t) => !da.has(titelSchluessel(t.titel))), doppelt };
}
