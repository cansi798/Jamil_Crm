import type { RequestHandler } from './$types';
import { COOKIE_NAME, loescheSitzung, loescheSitzungsCookie } from '$lib/server/auth/sitzung';

/** Beendet die Sitzung: Eintrag in der Datenbank löschen, Cookie entfernen, zur Anmeldeseite. */
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	if (token) await loescheSitzung(token);
	loescheSitzungsCookie(cookies);
	return new Response(null, { status: 303, headers: { location: '/anmelden' } });
};
