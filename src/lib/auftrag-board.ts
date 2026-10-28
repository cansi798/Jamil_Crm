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
 * Untergruppen in den Spalten „Anfrage“ und „Angebot“ (Jamil, Sprachnachricht msg 3601) – nur Anzeige, der Status bleibt:
 * - Anfrage: „Neu“ (noch kein Termin) und „Termin vereinbart“ (mindestens ein Termin eingeplant – egal ob er schon war;
 *   „vereinbart“ reicht, er muss nicht stattgefunden haben).
 * - Angebot: „Noch kein Angebot“ und „Angebot erhalten“ (ein Angebot ist an den Kunden verschickt; Entwürfe zählen nicht,
 *   angenommene/abgelehnte zählen als erhalten).
 */
export type Untergruppe = 'neu' | 'termin' | 'ohne_angebot' | 'mit_angebot';
export const UNTERGRUPPEN: Partial<Record<AuftragStatus, { id: Untergruppe; titel: string }[]>> = {
	anfrage: [
		{ id: 'neu', titel: 'Neu' },
		{ id: 'termin', titel: 'Termin vereinbart' }
	],
	angebot: [
		{ id: 'ohne_angebot', titel: 'Noch kein Angebot' },
		{ id: 'mit_angebot', titel: 'Angebot erhalten' }
	]
};
export const UNTERGRUPPE_TITEL: Record<Untergruppe, string> = { neu: 'Neu', termin: 'Termin vereinbart', ohne_angebot: 'Noch kein Angebot', mit_angebot: 'Angebot erhalten' };

export function untergruppe(a: { status: AuftragStatus; hatTermin?: boolean; angebotInfo?: { status: string } | null }): Untergruppe | null {
	if (a.status === 'anfrage') return a.hatTermin ? 'termin' : 'neu';
	if (a.status === 'angebot') return a.angebotInfo ? 'mit_angebot' : 'ohne_angebot';
	return null;
}
