import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	einladungsDaten,
	MELDUNG_UNGUELTIG,
	nimmEinladungAn,
	pruefeAnnahmeEingaben
} from '$lib/server/auth/einladung';

/**
 * Einladung annehmen (ohne Anmeldung): Name und Passwort festlegen. Gültig ist eine Einladung 7 Tage und nur einmal;
 * ob sie abgelaufen, benutzt oder unbekannt ist, wird nicht unterschieden.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	// Der Link enthält ein Geheimnis: nicht zwischenspeichern, nicht als Referrer weitergeben.
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
	const daten = await einladungsDaten(params.token);
	if (!daten) return { gueltig: false as const };
	return { gueltig: true as const, email: daten.email, betrieb: daten.betrieb };
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const form = await request.formData();
		const name = form.get('name');
		const passwort = form.get('passwort');
		const fehler = pruefeAnnahmeEingaben(name, passwort, form.get('passwort2'));
		const nameWert = typeof name === 'string' ? name.slice(0, 200) : '';
		if (fehler) return fail(400, { fehler, name: nameWert, ungueltig: false });

		const ergebnis = await nimmEinladungAn(params.token, name as string, passwort as string);
		if (ergebnis.art === 'ungueltig') return fail(410, { fehler: MELDUNG_UNGUELTIG, name: '', ungueltig: true });
		if (ergebnis.art === 'grenze') {
			return fail(409, {
				fehler:
					'Der Betrieb hat die Benutzergrenze seines Tarifs erreicht. Bitte wenden Sie sich an die Person, die Sie eingeladen hat.',
				name: nameWert,
				ungueltig: false
			});
		}
		redirect(303, '/anmelden?hinweis=eingerichtet');
	}
};
