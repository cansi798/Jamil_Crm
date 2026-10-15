import { fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { systemAbfrage } from '$lib/server/db';
import { hashePasswort, pruefePasswort } from '$lib/server/auth/passwort';
import { pruefeVersuch, zuruecksetzen } from '$lib/server/auth/ratelimit';
import { neueSitzung, setzeSitzungsCookie } from '$lib/server/auth/sitzung';

/** Eine einzige Meldung für alle Fehlgründe, damit nicht erkennbar ist, ob die E-Mail existiert. */
const FALSCH = 'E-Mail oder Passwort ist falsch.';
const ZU_OFT = 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.';
const MAX_EMAIL = 254;
const MAX_PASSWORT = 1024;

/**
 * Hash eines zufälligen Passworts mit denselben Parametern wie echte Hashes. Wird bei unbekannter E-Mail
 * geprüft, damit die Antwortzeit nicht verrät, ob es das Konto gibt. Wird schon beim Laden des Moduls berechnet.
 */
const dummyHash: Promise<string> = hashePasswort(randomBytes(24).toString('base64url'));
dummyHash.catch(() => {}); // Fehler tauchen beim Await in der Aktion auf, nicht als unbehandelte Ablehnung

export const load: PageServerLoad = ({ locals }) => {
	if (locals.nutzer) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const emailRoh = form.get('email');
		const passwort = form.get('passwort');
		if (
			typeof emailRoh !== 'string' ||
			typeof passwort !== 'string' ||
			emailRoh.trim() === '' ||
			passwort === '' ||
			emailRoh.length > MAX_EMAIL ||
			passwort.length > MAX_PASSWORT
		) {
			return fail(400, { fehler: FALSCH, email: '' });
		}
		const email = emailRoh.trim().toLowerCase();

		if (!pruefeVersuch(email).erlaubt) return fail(429, { fehler: ZU_OFT, email });

		const [konto] = await systemAbfrage(
			(sql) => sql`select * from app.anmeldung_finden(${email}::public.citext)`
		);
		// Bei unbekannter E-Mail trotzdem einen Hash prüfen (gleicher Aufwand, gleiche Antwort).
		const passt = await pruefePasswort(konto ? konto.passwort_hash : await dummyHash, passwort);
		if (!konto || !passt || !konto.aktiv) return fail(400, { fehler: FALSCH, email });

		// Hinweis Stufe 1a/Task 6: totp_aktiv wird dort ausgewertet (zweiter Faktor vor Vollsitzung).
		zuruecksetzen(email);
		const token = await neueSitzung(konto.id);
		setzeSitzungsCookie(cookies, token);
		redirect(303, '/');
	}
};
