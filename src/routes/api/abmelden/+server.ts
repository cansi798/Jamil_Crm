import type { RequestHandler } from './$types';
import { COOKIE_NAME, loescheSitzung, loescheSitzungsCookie } from '$lib/server/auth/sitzung';
import { loescheVorsitzungsCookie, VORSITZUNG_COOKIE } from '$lib/server/auth/vorsitzung';

/** Beendet die Sitzung: Eintrag in der Datenbank löschen, Cookie entfernen, zur Anmeldeseite. */
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	if (token) await loescheSitzung(token);
	loescheSitzungsCookie(cookies);
	// eine angefangene Anmeldung (Vor-Sitzung) endet ebenfalls
	const vor = cookies.get(VORSITZUNG_COOKIE);
	if (vor) await loescheSitzung(vor);
	loescheVorsitzungsCookie(cookies);
	return new Response(null, { status: 303, headers: { location: '/anmelden' } });
};
