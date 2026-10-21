import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { anmelden, cookieOptionen, PORTAL_COOKIE } from '$lib/server/portal-zugang';
import { ipVon } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';

/**
 * Passwort für das Kundenportal (Jamil msg 3037): `POST /portal/<Token>/anmelden` mit `passwort`. Erfolg → Cookie nur
 * für diesen Link, zurück zum Portal; sonst zurück zur Passwort-Seite mit allgemeiner Meldung (`?anmeldung=…`).
 */
export const POST: RequestHandler = async (event) => {
	const token = event.params.token;
	let f: FormData;
	try {
		f = await event.request.formData();
	} catch {
		error(400, 'Ungültige Anfrage.');
	}
	let r;
	try {
		r = await anmelden(token, f.get('passwort'), ipVon(event));
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
	if (r.ok) {
		event.cookies.set(PORTAL_COOKIE, r.wert, cookieOptionen(token, r.ablauf));
		redirect(303, `/portal/${token}`);
	}
	if (r.grund === 'ungueltig') error(404, 'Dieser Link ist nicht (mehr) gültig. Bitte wenden Sie sich an Ihren Handwerksbetrieb.');
	redirect(303, `/portal/${token}?anmeldung=${r.grund}`);
};
