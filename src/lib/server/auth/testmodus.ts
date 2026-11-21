import { randomBytes } from 'node:crypto';
import { systemAbfrage } from '../db';
import { hashe, SITZUNG_SEKUNDEN } from './sitzung';

/**
 * Testmodus der Vorschau (Wunsch Can + Jamil, 16.10.2026): Anmeldung nur mit Benutzername, ohne Passwort und
 * ohne zweiten Faktor – nur wenn `CRM_TESTMODUS=1` gesetzt ist und nur für Test-Konten (E-Mail auf „.test“).
 * Die Datenbankfunktion `app.test_anmeldung` prüft die .test-Einschränkung noch einmal selbst und lässt Plattform-Admins
 * nie ohne Passwort herein (Migration 127).
 */
export function testmodusAktiv(env: Record<string, string | undefined> = process.env): boolean {
	return env.CRM_TESTMODUS === '1';
}

const LOKAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Start-Prüfung (Prüfbericht 21.11.2026): Der Testmodus darf nur lokal laufen (ORIGIN localhost/127.0.0.1) – ein
 * Produktionsserver mit versehentlich gesetztem CRM_TESTMODUS=1 startet NICHT. Ausnahme nur bewusst: Die öffentliche
 * Vorschau (crm.waybuild-software.de) nennt ihre Adresse in CRM_TESTMODUS_ORIGIN (setzt scripts/start-vorschau.sh;
 * mehrere Adressen mit Komma). Liefert eine Fehlermeldung oder null.
 */
export function testmodusStartFehler(env: Record<string, string | undefined> = process.env): string | null {
	if (!testmodusAktiv(env)) return null;
	const origin = (env.ORIGIN ?? '').trim().replace(/\/$/, '');
	if (origin === '' || LOKAL.test(origin)) return null;
	const erlaubt = (env.CRM_TESTMODUS_ORIGIN ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
	if (erlaubt.includes(origin)) return null;
	return `CRM_TESTMODUS=1 ist nur lokal erlaubt (ORIGIN localhost/127.0.0.1) – ORIGIN ist ${origin}. Für die Vorschau die Adresse in CRM_TESTMODUS_ORIGIN eintragen, im Betrieb CRM_TESTMODUS entfernen.`;
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
