import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { VORSITZUNG_COOKIE, vorsitzungsDaten } from '$lib/server/auth/vorsitzung';
import { verarbeiteCode } from '$lib/server/auth/code-aktion';

/** Zweiter Schritt der Anmeldung für Konten mit aktivem TOTP: Code aus der Authenticator-App. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (locals.nutzer) redirect(303, '/');
	const token = cookies.get(VORSITZUNG_COOKIE);
	const daten = token ? await vorsitzungsDaten(token) : null;
	if (!daten) redirect(303, '/anmelden?hinweis=abgelaufen');
	if (daten.gesperrt) redirect(303, '/anmelden?hinweis=gesperrt');
	if (!daten.totpAktiv) redirect(303, '/konto/zwei-faktor');
	return {};
};

export const actions: Actions = {
	default: (event) => verarbeiteCode(event, 'anmelden')
};
