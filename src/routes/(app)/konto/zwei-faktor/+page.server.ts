import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { bereiteEinrichtungVor, VORSITZUNG_COOKIE, vorsitzungsDaten } from '$lib/server/auth/vorsitzung';
import { verarbeiteCode } from '$lib/server/auth/code-aktion';

/** Geheimnis in 4er-Gruppen, damit es sich beim Abtippen leichter lesen lässt. */
const gruppiere = (geheimnis: string) => geheimnis.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * Pflicht-Einrichtung der Zwei-Faktor-Anmeldung (Chef, Plattform-Admin). Erreichbar nur mit Vor-Sitzung:
 * nach dem Passwort, aber vor dem ersten Code. Ein aktives Geheimnis wird nie angezeigt.
 */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (locals.nutzer) redirect(303, '/');
	const token = cookies.get(VORSITZUNG_COOKIE);
	const daten = token ? await vorsitzungsDaten(token) : null;
	if (!token || !daten) redirect(303, '/anmelden?hinweis=abgelaufen');
	if (daten.gesperrt) redirect(303, '/anmelden?hinweis=gesperrt');
	if (daten.totpAktiv) redirect(303, '/anmelden/zweiter-faktor');
	const einrichtung = await bereiteEinrichtungVor(token);
	if (!einrichtung) redirect(303, '/anmelden?hinweis=abgelaufen');
	return { qr: einrichtung.qr, geheimnis: gruppiere(einrichtung.geheimnis), email: daten.email };
};

export const actions: Actions = {
	default: (event) => verarbeiteCode(event, 'einrichten')
};
