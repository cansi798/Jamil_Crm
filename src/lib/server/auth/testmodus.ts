import { randomBytes } from 'node:crypto';
import { systemAbfrage } from '../db';
import { hashe, SITZUNG_SEKUNDEN } from './sitzung';

/**
 * Testmodus der Vorschau (Wunsch Can + Jamil, 16.10.2026): Anmeldung nur mit Benutzername, ohne Passwort und
 * ohne zweiten Faktor – nur wenn `CRM_TESTMODUS=1` gesetzt ist und nur für Test-Konten (E-Mail auf „.test“).
 * Die Datenbankfunktion `app.test_anmeldung` prüft die .test-Einschränkung noch einmal selbst.
 */
export function testmodusAktiv(env: Record<string, string | undefined> = process.env): boolean {
	return env.CRM_TESTMODUS === '1';
}

/** Kurzer Benutzername → E-Mail des Test-Kontos („can.chef“ → can.chef@bauwelt.test, „can.admin“ → …@crm.test). */
export function testEmail(eingabe: string): string | null {
	const e = eingabe.trim().toLowerCase();
	if (e.length === 0 || e.length > 254) return null;
	if (e.includes('@')) return /^[^@\s]+@[^@\s]+\.test$/.test(e) ? e : null;
	if (!/^[a-z0-9._-]+$/.test(e)) return null;
	return e === 'admin' || e.endsWith('.admin') ? `${e}@crm.test` : `${e}@bauwelt.test`;
}

/** Volle Sitzung für ein Test-Konto; `null`, wenn die Datenbank ablehnt (kein Test-Konto, inaktiv, gesperrt). */
export async function testAnmelden(benutzerId: string): Promise<string | null> {
	const token = randomBytes(32).toString('base64url');
	const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
	const [z] = await systemAbfrage(
		(sql) => sql`select app.test_anmeldung(${benutzerId}::uuid, ${hashe(token)}::bytea, ${ablauf}::timestamptz) as ok`
	);
	return z?.ok === true ? token : null;
}
