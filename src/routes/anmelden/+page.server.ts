import { fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { systemAbfrage } from '$lib/server/db';
import { hashePasswort, pruefePasswort } from '$lib/server/auth/passwort';
import { pruefeVersuch, zuruecksetzen } from '$lib/server/auth/ratelimit';
import { COOKIE_NAME, loescheSitzung, setzeSitzungsCookie } from '$lib/server/auth/sitzung';
import {
	loescheVorsitzungsCookie,
	meldeAn,
	setzeVorsitzungsCookie,
	VORSITZUNG_COOKIE
} from '$lib/server/auth/vorsitzung';
import { testAnmelden, testEmail, testmodusAktiv } from '$lib/server/auth/testmodus';
import { nextcloud } from '$lib/server/nextcloud/konfig';

/** Eine einzige Meldung für alle Fehlgründe, damit nicht erkennbar ist, ob die E-Mail existiert. */
const FALSCH = 'E-Mail oder Passwort ist falsch.';
const TEST_FALSCH = 'Diesen Test-Benutzer gibt es nicht. Beispiele: can.chef, jamil.buero, can.monteur, jamil.admin';
const ZU_OFT = 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.';
const MAX_EMAIL = 254;
const MAX_PASSWORT = 1024;
const ZU_VIELE_CODES =
	'Zu viele falsche Bestätigungscodes. Bitte in 15 Minuten erneut versuchen.';

/** Hinweise, mit denen die Seiten der Zwei-Faktor-Anmeldung hierher zurückleiten (feste Liste, kein freier Text). */
const HINWEISE: Record<string, string> = {
	abgelaufen: 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.',
	gesperrt: ZU_VIELE_CODES,
	eingerichtet: 'Ihr Konto ist eingerichtet. Bitte melden Sie sich jetzt an.',
	// „Mit Nextcloud anmelden“ (optional, siehe src/lib/server/nextcloud)
	'nextcloud-unbekannt':
		'Ihr Nextcloud-Konto ist mit keinem CRM-Benutzer verknüpft. Bitte wenden Sie sich an die Person, die bei Ihnen die Benutzer verwaltet.',
	'nextcloud-verweigert': 'Die Anmeldung über Nextcloud ist für dieses Konto nicht möglich.',
	'nextcloud-abgelaufen': 'Die Anmeldung über Nextcloud ist abgelaufen. Bitte erneut versuchen.',
	'nextcloud-abgebrochen': 'Die Anmeldung über Nextcloud wurde abgebrochen.',
	'nextcloud-zu-oft': ZU_OFT,
	'nextcloud-fehler': 'Die Anmeldung über Nextcloud hat nicht geklappt. Bitte später erneut versuchen oder mit E-Mail und Passwort anmelden.'
};

/**
 * Hash eines zufälligen Passworts mit denselben Parametern wie echte Hashes. Wird bei unbekannter E-Mail
 * geprüft, damit die Antwortzeit nicht verrät, ob es das Konto gibt. Wird schon beim Laden des Moduls berechnet.
 */
const dummyHash: Promise<string> = hashePasswort(randomBytes(24).toString('base64url'));
dummyHash.catch(() => {}); // Fehler tauchen beim Await in der Aktion auf, nicht als unbehandelte Ablehnung

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.nutzer) redirect(303, '/');
	const hinweis = url.searchParams.get('hinweis') ?? '';
	return { hinweis: Object.hasOwn(HINWEISE, hinweis) ? HINWEISE[hinweis] : null, testmodus: testmodusAktiv(), nextcloud: !!nextcloud()?.anmeldung };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const emailRoh = form.get('email');
		const passwort = form.get('passwort') ?? '';

		// Testmodus (nur Vorschau, CRM_TESTMODUS=1): ohne Passwort → Anmeldung nur mit Benutzername, ohne 2FA,
		// ausschließlich für Test-Konten (*.test). Mit Passwort läuft der normale Weg weiter unten.
		if (testmodusAktiv() && passwort === '' && typeof emailRoh === 'string') {
			const testAdresse = testEmail(emailRoh);
			const anzeige = emailRoh.trim().slice(0, MAX_EMAIL);
			if (!testAdresse) return fail(400, { fehler: TEST_FALSCH, email: anzeige });
			if (!pruefeVersuch(testAdresse).erlaubt) return fail(429, { fehler: ZU_OFT, email: anzeige });
			const [konto] = await systemAbfrage(
				(sql) => sql`select * from app.anmeldung_finden(${testAdresse}::public.citext)`
			);
			const token = konto && konto.aktiv ? await testAnmelden(konto.id) : null;
			if (!token) return fail(400, { fehler: TEST_FALSCH, email: anzeige });
			zuruecksetzen(testAdresse);
			for (const name of [COOKIE_NAME, VORSITZUNG_COOKIE]) {
				const alt = cookies.get(name);
				if (alt) await loescheSitzung(alt);
			}
			loescheVorsitzungsCookie(cookies);
			setzeSitzungsCookie(cookies, token);
			redirect(303, '/');
		}

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

		// Die Datenbank entscheidet: volle Sitzung, oder – bei Pflicht-2FA bzw. aktivem TOTP – nur eine Vor-Sitzung,
		// die erst nach gültigem Code zur Sitzung wird. Gesperrter Betrieb/inaktives Konto: dieselbe neutrale Meldung.
		const weiter = await meldeAn(konto.id);
		if (weiter.art === 'verweigert') return fail(400, { fehler: FALSCH, email });
		if (weiter.art === 'gesperrt') return fail(429, { fehler: ZU_VIELE_CODES, email });
		zuruecksetzen(email);
		// Bestand an Sitzungen nicht anwachsen lassen: noch vorhandene alte Sitzungen dieses Browsers beenden.
		for (const name of [COOKIE_NAME, VORSITZUNG_COOKIE]) {
			const alt = cookies.get(name);
			if (alt) await loescheSitzung(alt);
		}
		if (weiter.art === 'sitzung') {
			loescheVorsitzungsCookie(cookies);
			setzeSitzungsCookie(cookies, weiter.token);
			redirect(303, '/');
		}
		setzeVorsitzungsCookie(cookies, weiter.token);
		redirect(303, weiter.art === 'code' ? '/anmelden/zweiter-faktor' : '/konto/zwei-faktor');
	}
};
