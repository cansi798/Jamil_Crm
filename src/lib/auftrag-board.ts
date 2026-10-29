import { erlaubterWechsel, naechsterStatus, vorigerStatus, type AuftragStatus } from './auftrag-status';

/**
 * Zustand des Auftrags-Boards im Browser – ohne Svelte und ohne Serverbezug, damit es testbar bleibt.
 * Verschieben ist nur in die Nachbarspalte erlaubt (Statuskette, wie auf dem Server).
 */

export type BoardSpalte<K extends { id: string; status: AuftragStatus }> = {
	status: AuftragStatus;
	anzahl: number;
	karten: K[];
};

/** Darf eine Karte von `von` nach `nach` gezogen werden? (Gleiche Spalte ist kein Wechsel.) */
export const zielErlaubt = (von: AuftragStatus, nach: AuftragStatus): boolean => erlaubterWechsel(von, nach);

/** Mögliche Ziele für das Menü „Status ändern“: zurück und weiter (falls vorhanden). */
export function moeglicheZiele(s: AuftragStatus): { richtung: 'zurueck' | 'weiter'; status: AuftragStatus }[] {
	const ziele: { richtung: 'zurueck' | 'weiter'; status: AuftragStatus }[] = [];
	const zurueck = vorigerStatus(s);
	const weiter = naechsterStatus(s);
	if (zurueck) ziele.push({ richtung: 'zurueck', status: zurueck });
	if (weiter) ziele.push({ richtung: 'weiter', status: weiter });
	return ziele;
}

/**
 * Karte `id` in die Spalte `nach` verschieben (oben einsortiert) – liefert neue Spalten (unverändert, wenn die Karte
 * fehlt oder der Wechsel nicht erlaubt ist). Die Anzahl beider Spalten wird angepasst.
 */
export function verschiebeKarte<K extends { id: string; status: AuftragStatus }>(
	spalten: BoardSpalte<K>[],
	id: string,
	nach: AuftragStatus
): BoardSpalte<K>[] {
	const quelle = spalten.find((s) => s.karten.some((k) => k.id === id));
	const karte = quelle?.karten.find((k) => k.id === id);
	if (!quelle || !karte || !zielErlaubt(karte.status, nach) || !spalten.some((s) => s.status === nach)) return spalten;
	const verschoben = { ...karte, status: nach };
	return spalten.map((s) => {
		if (s === quelle) return { ...s, anzahl: Math.max(0, s.anzahl - 1), karten: s.karten.filter((k) => k.id !== id) };
		if (s.status === nach) return { ...s, anzahl: s.anzahl + 1, karten: [verschoben, ...s.karten] };
		return s;
	});
}

/**
 * Felder einer Karte mit der Fassung vom Server überschreiben (z. B. nach erfolgreichem Statuswechsel); Felder, die
 * der Server dort nicht liefert (nächster Termin, Angebotswert), bleiben erhalten.
 */
export function aktualisiereKarte<K extends { id: string; status: AuftragStatus }>(
	spalten: BoardSpalte<K>[],
	neu: Partial<K> & { id: string }
): BoardSpalte<K>[] {
	return spalten.map((s) => ({ ...s, karten: s.karten.map((k) => (k.id === neu.id ? { ...k, ...neu } : k)) }));
}

/** Kurzadresse für die Kachel: „Straße, Ort“ ohne PLZ (aus „Straße, PLZ Ort“). */
export function kurzAdresse(adresse: string | null): string | null {
	if (!adresse) return null;
	return adresse.replace(/(^|,\s*)\d{4,5}\s+/, '$1').trim() || null;
}

/** Initialen eines Namens für die Mitarbeiter-Chips („Max Muster“ → „MM“). */
export function initialen(name: string): string {
	const teile = name.trim().split(/\s+/).filter(Boolean);
	if (teile.length === 0) return '?';
	const erste = teile[0].charAt(0);
	const letzte = teile.length > 1 ? teile[teile.length - 1].charAt(0) : '';
	return (erste + letzte).toUpperCase();
}

/** Farbe je Status (Board-Spalten und Farbpunkte im Status-Menü). */
export const STATUS_FARBEN: Record<AuftragStatus, string> = {
	anfrage: 'var(--m365-text-leicht)',
	angebot: 'var(--m365-warnung)',
	beauftragt: 'var(--m365-primaer)',
	in_arbeit: 'var(--m365-erfolg)',
	abgenommen: '#8764b8',
	abgerechnet: 'var(--m365-text-leise)'
};

/**
 * Untergruppen in den Spalten „Anfrage“ bis „In Arbeit“ (Jamil msgs 3601, 3655, 3658–3660) – nur Anzeige, der Status bleibt.
 * Einheitliche Benennung: Offene Gruppen heißen nach der nächsten Aufgabe („Termin vereinbaren“), erledigte nach dem
 * erreichten Stand („Termin vereinbart“).
 * - Anfrage: „Termin vereinbaren“ (noch kein Termin) und „Termin vereinbart“ (mindestens ein Termin eingeplant – egal ob er
 *   schon war; „vereinbart“ reicht).
 * - Angebot: „Angebot erstellen“ und „Angebot erhalten“ (ein Angebot ist an den Kunden verschickt; Entwürfe zählen nicht,
 *   angenommene/abgelehnte zählen als erhalten).
 * - Beauftragt: „Planung durchführen“ und „Termin zur Umsetzung bestätigt“ (ein kommender oder gerade laufender Termin
 *   der Art Montage oder Wartung ist eingetragen; eine Besichtigung zählt nicht, vergangene Termine auch nicht – Termine
 *   haben standardmäßig die Art „Montage“. Ein eigenes „bestätigt“-Feld gibt es nicht: der eingetragene Termin gilt als
 *   bestätigt).
 * - In Arbeit: „Arbeiten durchführen“ → „Qualitätsprüfung durchführen“ → „Endabnahme mit Kunden durchführen“ – dafür
 *   gibt es keine vorhandenen Daten, darum das Feld `arbeitsstand` am Auftrag (Migration 111), im Auftrag einstellbar.
 *   Nach der Endabnahme folgt wie bisher der Status „Abgenommen“.
 * `erledigt` = erreichter Stand (grünes Kennzeichen in der Liste), sonst nächste Aufgabe (graues Kennzeichen).
 */
export type Untergruppe = 'neu' | 'termin' | 'ohne_angebot' | 'mit_angebot' | 'planung' | 'umsetzung' | 'arbeiten' | 'qualitaet' | 'abnahme';
type UntergruppeInfo = { id: Untergruppe; titel: string; erledigt: boolean };
export const UNTERGRUPPEN: Partial<Record<AuftragStatus, UntergruppeInfo[]>> = {
	anfrage: [
		{ id: 'neu', titel: 'Termin vereinbaren', erledigt: false },
		{ id: 'termin', titel: 'Termin vereinbart', erledigt: true }
	],
	angebot: [
		{ id: 'ohne_angebot', titel: 'Angebot erstellen', erledigt: false },
		{ id: 'mit_angebot', titel: 'Angebot erhalten', erledigt: true }
	],
	beauftragt: [
		{ id: 'planung', titel: 'Planung durchführen', erledigt: false },
		{ id: 'umsetzung', titel: 'Termin zur Umsetzung bestätigt', erledigt: true }
	],
	in_arbeit: [
		{ id: 'arbeiten', titel: 'Arbeiten durchführen', erledigt: false },
		{ id: 'qualitaet', titel: 'Qualitätsprüfung durchführen', erledigt: false },
		{ id: 'abnahme', titel: 'Endabnahme mit Kunden durchführen', erledigt: false }
	]
};
const ALLE_UNTERGRUPPEN = Object.values(UNTERGRUPPEN).flat() as UntergruppeInfo[];
export const UNTERGRUPPE_TITEL = Object.fromEntries(ALLE_UNTERGRUPPEN.map((g) => [g.id, g.titel])) as Record<Untergruppe, string>;
/** Erreichter Stand (grünes Kennzeichen) statt nächster Aufgabe (graues Kennzeichen). */
export const untergruppeErledigt = (u: Untergruppe): boolean => ALLE_UNTERGRUPPEN.some((g) => g.id === u && g.erledigt);

/** Gespeicherter Arbeitsstand (Migration 111); leer = „Arbeiten durchführen“. */
export const ARBEITSSTAENDE = ['qualitaet', 'abnahme'] as const;
export type Arbeitsstand = (typeof ARBEITSSTAENDE)[number];
export const istArbeitsstand = (w: unknown): w is Arbeitsstand => typeof w === 'string' && (ARBEITSSTAENDE as readonly string[]).includes(w);

export function untergruppe(a: {
	status: AuftragStatus;
	hatTermin?: boolean;
	hatUmsetzungstermin?: boolean;
	angebotInfo?: { status: string } | null;
	arbeitsstand?: string | null;
}): Untergruppe | null {
	if (a.status === 'anfrage') return a.hatTermin ? 'termin' : 'neu';
	if (a.status === 'angebot') return a.angebotInfo ? 'mit_angebot' : 'ohne_angebot';
	if (a.status === 'beauftragt') return a.hatUmsetzungstermin ? 'umsetzung' : 'planung';
	if (a.status === 'in_arbeit') return istArbeitsstand(a.arbeitsstand) ? a.arbeitsstand : 'arbeiten';
	return null;
}
