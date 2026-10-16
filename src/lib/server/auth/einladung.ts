import { systemAbfrage } from '../db';
import { hashePasswort } from './passwort';
import { hashe, TOKEN_MUSTER } from './sitzung';

/**
 * Annahme einer Einladung ohne Anmeldung. Läuft nur über `systemAbfrage` (Rolle `crm_auth`) und die
 * SECURITY-DEFINER-Funktionen `app.einladung_pruefen` / `app.einladung_annehmen`, adressiert über den SHA-256 des
 * Tokens aus dem Link (nie über eine frei wählbare Benutzer- oder Betriebs-ID).
 */

export const PASSWORT_MIN = 10;
export const PASSWORT_MAX = 1024;
export const NAME_MAX = 100;
export const MELDUNG_UNGUELTIG = 'Diese Einladung ist nicht mehr gültig.';

export type EinladungsDaten = { email: string; betrieb: string };

/** E-Mail und Betrieb einer gültigen Einladung, sonst `null` (unbekannt, abgelaufen, benutzt, Betrieb gesperrt …). */
export async function einladungsDaten(token: string): Promise<EinladungsDaten | null> {
	if (!TOKEN_MUSTER.test(token)) return null;
	const [z] = await systemAbfrage(
		(sql) => sql`select email::text as email, betrieb from app.einladung_pruefen(${hashe(token)}::bytea)`
	);
	return z ? { email: z.email, betrieb: z.betrieb } : null;
}

/** Prüft Name und Passwort; liefert eine deutsche Meldung oder `null`, wenn alles passt. */
export function pruefeAnnahmeEingaben(name: unknown, passwort: unknown, wiederholung: unknown): string | null {
	if (typeof name !== 'string' || name.trim() === '' || name.trim().length > NAME_MAX) {
		return `Bitte Ihren Namen angeben (höchstens ${NAME_MAX} Zeichen).`;
	}
	if (typeof passwort !== 'string' || passwort.length < PASSWORT_MIN) {
		return `Das Passwort muss mindestens ${PASSWORT_MIN} Zeichen lang sein.`;
	}
	if (passwort.length > PASSWORT_MAX) return `Das Passwort darf höchstens ${PASSWORT_MAX} Zeichen lang sein.`;
	if (passwort !== wiederholung) return 'Die beiden Passwörter stimmen nicht überein.';
	return null;
}

export type Annahme = { art: 'ok'; benutzerId: string } | { art: 'ungueltig' } | { art: 'grenze' };

/**
 * Nimmt die Einladung an (Eingaben vorher mit `pruefeAnnahmeEingaben` prüfen). Das Passwort wird erst gehasht
 * (Argon2id), wenn die Einladung gültig ist – so kostet ein erfundener Link keine Rechenzeit. Die Datenbank prüft
 * Gültigkeit und Benutzergrenze dann noch einmal atomar.
 */
export async function nimmEinladungAn(token: string, name: string, passwort: string): Promise<Annahme> {
	if (!(await einladungsDaten(token))) return { art: 'ungueltig' };
	const passwortHash = await hashePasswort(passwort);
	try {
		const [z] = await systemAbfrage(
			(sql) =>
				sql`select app.einladung_annehmen(${hashe(token)}::bytea, ${name.trim()}, ${passwortHash}) as id`
		);
		return z?.id ? { art: 'ok', benutzerId: z.id } : { art: 'ungueltig' };
	} catch (e) {
		const f = e as { code?: string; message?: string };
		if (f.code === 'P0001' && f.message === 'benutzergrenze') return { art: 'grenze' };
		throw e;
	}
}
