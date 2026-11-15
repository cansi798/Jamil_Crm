/**
 * Ratenlimit für die Lexware-API: höchstens 2 Anfragen pro Sekunde je API-Schlüssel über alle Endpunkte
 * (https://developers.lexware.io/docs/ → „Rate Limiting“; darüber 429, die Anfrage wird nicht ausgeführt).
 * Wir halten sicherheitshalber 667 ms Abstand (≈ 1,5/s). Nach 429 wird der Schlüssel für die Wartezeit gesperrt.
 * Gilt je Prozess; der Hintergrund-Dienst läuft mit Datenbank-Sperre nur einmal (pg_try_advisory_lock).
 */
export const STANDARD_ABSTAND_MS = 667;

const naechsterPlatz = new Map<string, number>();

export async function warteAufPlatz(key: string, abstandMs = STANDARD_ABSTAND_MS): Promise<void> {
	const jetzt = Date.now();
	const platz = Math.max(jetzt, naechsterPlatz.get(key) ?? 0);
	naechsterPlatz.set(key, platz + abstandMs);
	if (platz > jetzt) await new Promise((r) => setTimeout(r, platz - jetzt));
}

/** Nach 429: diesen Schlüssel `ms` lang nicht benutzen. */
export function sperreKey(key: string, ms: number): void {
	naechsterPlatz.set(key, Math.max(naechsterPlatz.get(key) ?? 0, Date.now() + ms));
}

/** Nur für Tests. */
export function _ratenlimitLeeren(): void {
	naechsterPlatz.clear();
}
