import { erlaubterWechsel, STATUS, type AuftragStatus } from './auftrag-status';

/**
 * Zustand des Auftrags-Boards im Browser – ohne Svelte und ohne Serverbezug, damit es testbar bleibt.
 * Verschieben ist nur in die Nachbarspalte erlaubt (Statuskette, wie auf dem Server).
 */

export type BoardSpalte<K extends { id: string; status: AuftragStatus }> = {
	status: AuftragStatus;
	anzahl: number;
	karten: K[];
};

/**
 * Darf eine Karte von `von` nach `nach` gezogen werden? Ein Schritt in der Statuskette – übersprungene Status der
 * Auftragsquelle (`uebersprungen`, Jamil msg 3703) zählen dabei nicht: Ziel ist der nächste bzw. vorige GELTENDE Status.
 */
export const zielErlaubt = (von: AuftragStatus, nach: AuftragStatus, uebersprungen: readonly string[] = []): boolean =>
	nach !== von &&
	(nach === naechsterGeltenderStatus(von, uebersprungen) ||
		nach === vorigerGeltenderStatus(von, uebersprungen) ||
		(erlaubterWechsel(von, nach) && !statusUebersprungen(nach, uebersprungen)));

/** Mögliche Ziele für das Menü „Status ändern“: zurück und weiter (falls vorhanden; übersprungene Status ausgelassen). */
export function moeglicheZiele(s: AuftragStatus, uebersprungen: readonly string[] = []): { richtung: 'zurueck' | 'weiter'; status: AuftragStatus }[] {
	const ziele: { richtung: 'zurueck' | 'weiter'; status: AuftragStatus }[] = [];
	const zurueck = vorigerGeltenderStatus(s, uebersprungen);
	const weiter = naechsterGeltenderStatus(s, uebersprungen);
	if (zurueck) ziele.push({ richtung: 'zurueck', status: zurueck });
	if (weiter) ziele.push({ richtung: 'weiter', status: weiter });
	return ziele;
}

/**
 * Karte `id` in die Spalte `nach` verschieben (oben einsortiert) – liefert neue Spalten (unverändert, wenn die Karte
 * fehlt oder der Wechsel nicht erlaubt ist). Die Anzahl beider Spalten wird angepasst.
 */
export function verschiebeKarte<K extends { id: string; status: AuftragStatus; quelleUebersprungen?: readonly string[] }>(
	spalten: BoardSpalte<K>[],
	id: string,
	nach: AuftragStatus
): BoardSpalte<K>[] {
	const quelle = spalten.find((s) => s.karten.some((k) => k.id === id));
	const karte = quelle?.karten.find((k) => k.id === id);
	if (!quelle || !karte || !zielErlaubt(karte.status, nach, karte.quelleUebersprungen) || !spalten.some((s) => s.status === nach)) return spalten;
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
 * Untergruppen in den Spalten „Anfrage“ bis „In Arbeit“ (Jamil msgs 3601, 3655, 3658–3660, 3685) – nur Anzeige, der Status
 * bleibt. Namen nach EINER Logik (msg 3685, A/B): offene Gruppe = nächste Aufgabe (Infinitiv, „Termin vereinbaren“),
 * erledigte Gruppe = erreichter Stand (Partizip desselben Verbs, „Termin vereinbart“); „In Arbeit“ ist eine Kette offener
 * Aufgaben. Kurz, damit sie in die schmalen Board-Spalten passen.
 *
 * VORLÄUFIGE Zuordnung (msg 3685, C/D: „Die Logik, wann ein Auftrag automatisch weiterrutscht, sage ich dir noch. Bitte
 * nichts selbst erfinden.“) – bis Jamil die Regeln festlegt, bleibt es so, ohne neue Automatik:
 * - Anfrage: „Termin vereinbart“, sobald es irgendeinen Termin gibt (auch einen vergangenen).
 * - Angebot: „Angebot erstellt“ erst, wenn ein Angebot an den Kunden verschickt ist (auch angenommen/abgelehnt);
 *   ein Entwurf zählt noch nicht.
 * - Beauftragt: „Umsetzung geplant“, wenn ein kommender oder gerade laufender Termin der Art Montage oder Wartung
 *   eingetragen ist (Besichtigung und vergangene Termine zählen nicht – neue Termine haben standardmäßig die Art „Montage“).
 * - In Arbeit: „Arbeiten durchführen“ → „Qualität prüfen“ → „Endabnahme durchführen“ – von Hand im Auftrag unter der
 *   Statusleiste (Feld `arbeitsstand`, Migration 111); jeder Statuswechsel setzt auf „Arbeiten durchführen“ zurück.
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
		{ id: 'mit_angebot', titel: 'Angebot erstellt', erledigt: true }
	],
	beauftragt: [
		{ id: 'planung', titel: 'Umsetzung planen', erledigt: false },
		{ id: 'umsetzung', titel: 'Umsetzung geplant', erledigt: true }
	],
	in_arbeit: [
		{ id: 'arbeiten', titel: 'Arbeiten durchführen', erledigt: false },
		{ id: 'qualitaet', titel: 'Qualität prüfen', erledigt: false },
		{ id: 'abnahme', titel: 'Endabnahme durchführen', erledigt: false }
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

/**
 * Ablauf je Auftragsquelle (Jamil msg 3703, Konzept `docs/konzept-anfragequellen.md` Etappe 2): Die SCHRITTE sind die
 * offenen Untergruppen (nächste Aufgabe). Je Quelle kann jeder Schritt „gilt“ oder „überspringen“; gespeichert werden nur
 * die übersprungenen (`auftrag_quellen.uebersprungen`, Migration 112). Leer = alles gilt = genau das bisherige Verhalten.
 * Ein Status ist übersprungen, wenn ALLE seine Schritte übersprungen sind (Anfrage, Angebot und Beauftragt haben je einen,
 * In Arbeit hat drei). Abgenommen und Abgerechnet haben keine Schritte und gelten immer.
 */
export const ABLAUF_SCHRITTE = (Object.entries(UNTERGRUPPEN) as [AuftragStatus, UntergruppeInfo[]][]).flatMap(([status, gruppen]) =>
	gruppen.filter((g) => !g.erledigt).map((g) => ({ id: g.id, titel: g.titel, status }))
);
export const istAblaufSchritt = (w: unknown): w is Untergruppe => typeof w === 'string' && ABLAUF_SCHRITTE.some((x) => x.id === w);

export function statusUebersprungen(s: AuftragStatus, uebersprungen: readonly string[] = []): boolean {
	const schritte = ABLAUF_SCHRITTE.filter((x) => x.status === s);
	return schritte.length > 0 && schritte.every((x) => uebersprungen.includes(x.id));
}
/** Nächster bzw. voriger Status, der für diese Quelle gilt (oder `null` am Ende der Kette). */
export function naechsterGeltenderStatus(s: AuftragStatus, uebersprungen: readonly string[] = []): AuftragStatus | null {
	return STATUS.slice(STATUS.indexOf(s) + 1).find((x) => !statusUebersprungen(x, uebersprungen)) ?? null;
}
export function vorigerGeltenderStatus(s: AuftragStatus, uebersprungen: readonly string[] = []): AuftragStatus | null {
	return [...STATUS.slice(0, STATUS.indexOf(s))].reverse().find((x) => !statusUebersprungen(x, uebersprungen)) ?? null;
}
/** Startstatus eines neuen Auftrags: „Anfrage“, außer die Quelle überspringt sie – dann der erste geltende Status. */
export const startStatus = (uebersprungen: readonly string[] = []): AuftragStatus =>
	statusUebersprungen('anfrage', uebersprungen) ? (naechsterGeltenderStatus('anfrage', uebersprungen) ?? 'anfrage') : 'anfrage';

/**
 * Untergruppe eines Auftrags. Mit `quelleUebersprungen`: Ein übersprungener Schritt erscheint nicht – in „In Arbeit“
 * steht der Auftrag dann im nächsten geltenden Schritt (sonst im vorigen); gibt es im Status keinen geltenden Schritt
 * mehr (der Auftrag steht z. B. noch aus der Zeit vor der Einstellung oder durch eine bestehende Kopplung in einem
 * übersprungenen Status), ist das Ergebnis `null` – Board und Liste zeigen ihn dann unter „Schritt übersprungen“.
 */
export function untergruppe(a: {
	status: AuftragStatus;
	hatTermin?: boolean;
	hatUmsetzungstermin?: boolean;
	angebotInfo?: { status: string } | null;
	arbeitsstand?: string | null;
	quelleUebersprungen?: readonly string[];
}): Untergruppe | null {
	const roh = rohUntergruppe(a);
	const ueb = a.quelleUebersprungen ?? [];
	if (!roh || !ueb.includes(roh)) return roh;
	const kette = (UNTERGRUPPEN[a.status] ?? []).filter((g) => !g.erledigt).map((g) => g.id);
	const i = kette.indexOf(roh);
	return kette.slice(i + 1).find((x) => !ueb.includes(x)) ?? [...kette.slice(0, i)].reverse().find((x) => !ueb.includes(x)) ?? null;
}
/** Steht der Auftrag in einem Status mit Untergruppen, deren Schritt für seine Quelle übersprungen ist? */
export const schrittUebersprungen = (a: Parameters<typeof untergruppe>[0]): boolean => !!UNTERGRUPPEN[a.status] && untergruppe(a) === null;
export const UEBERSPRUNGEN_TITEL = 'Schritt übersprungen';

function rohUntergruppe(a: Parameters<typeof untergruppe>[0]): Untergruppe | null {
	if (a.status === 'anfrage') return a.hatTermin ? 'termin' : 'neu';
	if (a.status === 'angebot') return a.angebotInfo ? 'mit_angebot' : 'ohne_angebot';
	if (a.status === 'beauftragt') return a.hatUmsetzungstermin ? 'umsetzung' : 'planung';
	if (a.status === 'in_arbeit') return istArbeitsstand(a.arbeitsstand) ? a.arbeitsstand : 'arbeiten';
	return null;
}
