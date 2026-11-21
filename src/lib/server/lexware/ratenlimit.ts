import { systemAbfrage } from '../db';

/**
 * Ratenlimit für die Lexware-API: höchstens 2 Anfragen pro Sekunde je API-Schlüssel über alle Endpunkte
 * (https://developers.lexware.io/docs/ → „Rate Limiting“; darüber 429, die Anfrage wird nicht ausgeführt).
 * Wir halten sicherheitshalber 667 ms Abstand (≈ 1,5/s). Nach 429 wird der Schlüssel für die Wartezeit gesperrt.
 *
 * Prozessübergreifend (Prüfbericht 21.11.2026, Migration 129): Für Betriebe (Schlüssel = Betriebs-ID) vergibt die
 * Datenbank die Plätze (`app.lexware_takt_platz`) – so halten auch mehrere App-Prozesse zusammen das Limit ein.
 * Fällt die Datenbank aus, gilt der Abstand wenigstens im eigenen Prozess. Abstand 0 (nur Tests) bleibt im Prozess.
 */
export const STANDARD_ABSTAND_MS = 667;

const UUIDX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naechsterPlatz = new Map<string, number>();

function imProzess(key: string, abstandMs: number): number {
	const jetzt = Date.now();
	const platz = Math.max(jetzt, naechsterPlatz.get(key) ?? 0);
	naechsterPlatz.set(key, platz + abstandMs);
	return platz - jetzt;
}

export async function warteAufPlatz(key: string, abstandMs = STANDARD_ABSTAND_MS): Promise<void> {
	let warte: number;
	if (abstandMs > 0 && UUIDX.test(key)) {
		try {
			const [z] = await systemAbfrage((sql) => sql`select app.lexware_takt_platz(${key}::uuid, ${Math.round(abstandMs)}) as ms`);
			// eine Sperre aus diesem Prozess (429) gilt zusätzlich
			warte = Math.max(Number(z?.ms ?? 0), (naechsterPlatz.get(key) ?? 0) - Date.now());
		} catch {
			warte = imProzess(key, abstandMs);
		}
	} else warte = imProzess(key, abstandMs);
	if (warte > 0) await new Promise((r) => setTimeout(r, Math.min(warte, 120_000)));
}

/** Nach 429: diesen Schlüssel `ms` lang nicht benutzen (im Prozess und – für Betriebe – in der Datenbank). */
export function sperreKey(key: string, ms: number): void {
	naechsterPlatz.set(key, Math.max(naechsterPlatz.get(key) ?? 0, Date.now() + ms));
	if (UUIDX.test(key))
		void systemAbfrage((sql) => sql`select app.lexware_takt_sperren(${key}::uuid, ${Math.round(ms)})`).catch(() => undefined);
}

/** Nur für Tests. */
export function _ratenlimitLeeren(): void {
	naechsterPlatz.clear();
}
