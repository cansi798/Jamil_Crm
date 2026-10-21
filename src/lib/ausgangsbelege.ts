/**
 * Ausgangsbelege (Jamil msgs 2948, 3054–3056): gemeinsame Regeln aller Reiter (Angebote, Auftragsbestätigungen,
 * Rechnungen). Alle Reiter benutzen denselben Seitenaufbau (`components/ausgangsbelege/BelegSeite.svelte`) und
 * dieselben Adressen-Parameter `suche`, `status`, `zeitraum` – damit jeder Reiter gleich aussieht und sich gleich
 * bedienen lässt („Einheitlichkeit“, docs/design-regeln.md).
 */
import type { ZeitraumArt } from './kennzahlen';

export const BELEG_ARTEN = [
	{ wert: 'angebote', text: 'Angebote' },
	{ wert: 'auftragsbestaetigungen', text: 'Auftragsbestätigungen' },
	{ wert: 'rechnungen', text: 'Rechnungen' }
] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number]['wert'];

/** Ein Platzhalter für alle Reiter – die Suche findet überall Nummer, Auftrag (Nummer/Titel) und Kunde. */
export const BELEG_SUCHE_PLATZHALTER = 'Nummer, Auftrag oder Kunde';

export type BelegFilter = { suche: string | null; status: string | null; zeitraum: ZeitraumArt };

export const belegPfad = (art: BelegArt) => `/ausgangsbelege/${art}`;

/** Suchbegriff aus der Adresse: getrimmt, höchstens 100 Zeichen, leer → null. */
export const belegSuche = (url: URL): string | null => url.searchParams.get('suche')?.trim().slice(0, 100) || null;

/**
 * Adresse eines Reiters mit dem aktuellen Filter; `o` überschreibt Status/Zeitraum (`status: null` hebt ihn auf).
 * Standardwerte (kein Status, Zeitraum „monat“) bleiben aus der Adresse heraus.
 */
export function belegLink(art: BelegArt, f: BelegFilter, o: { status?: string | null; zeitraum?: ZeitraumArt } = {}): string {
	const p = new URLSearchParams();
	if (f.suche) p.set('suche', f.suche);
	const st = o.status === undefined ? f.status : o.status;
	if (st) p.set('status', st);
	const z = o.zeitraum ?? f.zeitraum;
	if (z !== 'monat') p.set('zeitraum', z);
	const q = p.toString();
	return q ? `${belegPfad(art)}?${q}` : belegPfad(art);
}

/** Muster für `ilike` (Sonderzeichen % _ \ werden wörtlich gesucht). */
export const suchMuster = (s: string | null | undefined): string | null =>
	s?.trim() ? `%${s.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
