import type { Handle } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	loescheSitzungsCookie,
	pruefeSitzungMitStatus,
	setzeSitzungsCookie
} from '$lib/server/auth/sitzung';

/**
 * Liest das Sitzungs-Cookie und setzt `locals.nutzer` (oder `null`). Hat die Datenbank die Sitzung verlängert
 * (höchstens einmal pro Tag), wird auch das Cookie mit frischer Laufzeit neu gesetzt – sonst liefe es im Browser
 * trotz gleitender Verlängerung 30 Tage nach der Anmeldung ab.
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.nutzer = null;
	const token = event.cookies.get(COOKIE_NAME);
	if (token) {
		const ergebnis = await pruefeSitzungMitStatus(token);
		if (ergebnis) {
			event.locals.nutzer = ergebnis.nutzer;
			if (ergebnis.verlaengert) setzeSitzungsCookie(event.cookies, token);
		} else {
			loescheSitzungsCookie(event.cookies);
		}
	}
	return resolve(event);
};
