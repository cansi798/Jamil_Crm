/**
 * Rechnungen und Zahlungsstand (Lexware Phase 3) – rein, ohne Datenbank, auch im Browser nutzbar.
 * Plan: docs/superpowers/plans/2026-11-15-lexware-phase3.md, Entscheidungen 5, 6, 8.
 */

export const ZAHL_STATUS = ['vorbereitet', 'wartet', 'fehler', 'entwurf', 'offen', 'teilbezahlt', 'ueberfaellig', 'bezahlt', 'storniert'] as const;
export type ZahlStatus = (typeof ZAHL_STATUS)[number];
export const istZahlStatus = (w: unknown): w is ZahlStatus => typeof w === 'string' && (ZAHL_STATUS as readonly string[]).includes(w);

export const ZAHL_STATUS_NAMEN: Record<ZahlStatus, string> = {
	vorbereitet: 'In Lexware fertigstellen',
	wartet: 'Wird in Lexware angelegt',
	fehler: 'Fehler (prüfen)',
	entwurf: 'Entwurf in Lexware',
	offen: 'Offen',
	teilbezahlt: 'Teilweise bezahlt',
	ueberfaellig: 'Überfällig',
	bezahlt: 'Bezahlt',
	storniert: 'Storniert'
};
/** CSS-Klasse der Status-Pill (gleiche Farben wie bei Angeboten). */
export const ZAHL_STATUS_KLASSE: Record<ZahlStatus, string> = {
	vorbereitet: 's-entwurf',
	wartet: 's-entwurf',
	fehler: 's-abgelehnt',
	entwurf: 's-entwurf',
	offen: 's-versendet',
	teilbezahlt: 's-versendet',
	ueberfaellig: 's-abgelehnt',
	bezahlt: 's-angenommen',
	storniert: 's-abgelehnt'
};

/** Filter der Liste „Offene Rechnungen“ (offen = alles, was noch Geld bringt). */
export const RECHNUNG_FILTER = ['offen', 'ueberfaellig', 'teilbezahlt', 'bezahlt', 'entwurf', 'alle'] as const;
export type RechnungFilter = (typeof RECHNUNG_FILTER)[number];
export const istRechnungFilter = (w: unknown): w is RechnungFilter => typeof w === 'string' && (RECHNUNG_FILTER as readonly string[]).includes(w);
export const passtFilter = (s: ZahlStatus, f: RechnungFilter): boolean =>
	f === 'alle' ? true : f === 'offen' ? s === 'offen' || s === 'teilbezahlt' || s === 'ueberfaellig' : s === f;

export type ZahlEingabe = {
	phase: 'vorbereitet' | 'wartet' | 'angelegt' | 'fehler';
	/** voucherStatus aus Lexware (Spiegel) oder null */
	status: string | null;
	bruttoCent: number | null;
	offenCent: number | null;
	faellig: string | null;
};

/**
 * Zahlstatus aus Phase und Lexware-Spiegel: storniert > Entwurf > bezahlt > überfällig > teilweise bezahlt > offen.
 * Überfällig auch, wenn Lexware (noch) „open“ meldet, die Fälligkeit aber vorbei ist (Abgleich nachts).
 */
export function zahlStatus(r: ZahlEingabe, heute: string): ZahlStatus {
	if (r.phase !== 'angelegt' || !r.status) return r.phase === 'angelegt' ? 'wartet' : r.phase;
	const s = r.status;
	if (s === 'voided') return 'storniert';
	if (s === 'draft') return 'entwurf';
	if (s === 'paid' || s === 'paidoff' || (r.offenCent !== null && r.offenCent <= 0)) return 'bezahlt';
	if (s === 'overdue' || (r.faellig !== null && r.faellig < heute)) return 'ueberfaellig';
	if (r.offenCent !== null && r.bruttoCent !== null && r.offenCent < r.bruttoCent) return 'teilbezahlt';
	return 'offen';
}

/** Tage zwischen zwei Tagen (b − a). */
export function tageZwischen(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Verzugszinsen § 288 BGB (nur als Hinweis, Plan Entscheidung 6): Verbraucher 5, sonst 9 Prozentpunkte über dem
 * Basiszins; taggenau (Tage/365) ab dem Tag nach der Fälligkeit bis heute; nie negativ, auf Cent gerundet.
 */
export function verzugszinsenCent(e: { offenCent: number; faellig: string; heute: string; basiszinsHundertstel: number; firma: boolean }): { cent: number; tage: number; prozent: number } {
	const tage = Math.max(0, tageZwischen(e.faellig, e.heute));
	const prozent = Math.max(0, e.basiszinsHundertstel / 100 + (e.firma ? 9 : 5));
	const cent = e.offenCent > 0 && tage > 0 ? Math.round((e.offenCent * prozent * tage) / (100 * 365)) : 0;
	return { cent, tage, prozent };
}

/** Abschlag: fester Betrag in Cent oder Prozent vom Auftrag (brutto), auf Cent gerundet. */
export function abschlagBetrag(gesamtBruttoCent: number, e: { cent?: number | null; prozent?: number | null }): number {
	if (e.cent !== null && e.cent !== undefined) return Math.max(0, Math.round(e.cent));
	const p = Math.min(100, Math.max(0, e.prozent ?? 0));
	return Math.round((gesamtBruttoCent * p) / 100);
}

/** Schlussrechnung: Gesamt minus gezahlte/gestellte Abschläge (nicht stornierte), nie negativ. */
export function schlussBetrag(gesamtBruttoCent: number, abschlaege: readonly { bruttoCent: number; storniert?: boolean }[]): { restCent: number; abschlaegeCent: number } {
	const abschlaegeCent = abschlaege.filter((a) => !a.storniert).reduce((s, a) => s + a.bruttoCent, 0);
	return { restCent: Math.max(0, gesamtBruttoCent - abschlaegeCent), abschlaegeCent };
}

export const RECHNUNG_ART_NAMEN: Record<'rechnung' | 'teil' | 'abschlag' | 'schluss', string> = {
	rechnung: 'Rechnung',
	teil: 'Teilrechnung',
	abschlag: 'Abschlagsrechnung',
	schluss: 'Schlussrechnung'
};

export const MAHNSTUFE_NAMEN = ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung', '3. Mahnung'] as const;
