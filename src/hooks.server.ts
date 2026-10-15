import type { Handle } from '@sveltejs/kit';
import { COOKIE_NAME, loescheSitzungsCookie, pruefeSitzung } from '$lib/server/auth/sitzung';

/** Liest das Sitzungs-Cookie und setzt `locals.nutzer` (oder `null`). */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.nutzer = null;
	const token = event.cookies.get(COOKIE_NAME);
	if (token) {
		const nutzer = await pruefeSitzung(token);
		if (nutzer) event.locals.nutzer = nutzer;
		else loescheSitzungsCookie(event.cookies);
	}
	return resolve(event);
};
