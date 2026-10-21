import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { entscheide, ladePortal } from '$lib/server/kundenportal-oeffentlich';
import { ipVon, OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';

/**
 * Kundenportal /portal/<Token> (ohne Anmeldung; Jamil msgs 2770–2774 Punkt 4, 2778): Auftragsstatus, nächste Termine
 * mit Zeitfenster, Vornamen, freigegebene Dokumente, Kontakt, Angebot online annehmen/ablehnen. Nie zwischenspeichern,
 * nicht indexieren, kein Referrer (der Link enthält das Token).
 */
export const load: PageServerLoad = async (event) => {
	// Ohne Portal-Passwort (msg 3037) nichts laden – das Layout zeigt die Passwort-Abfrage
	if (!event.locals.portalAngemeldet) error(401, 'Bitte geben Sie zuerst Ihr Passwort ein.');
	event.setHeaders({ ...OEFFENTLICHE_KOPFZEILEN });
	let seite;
	try {
		seite = await ladePortal(event.params.token, ipVon(event));
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
	if (!seite) error(404, 'Dieser Link ist nicht (mehr) gültig. Bitte wenden Sie sich an Ihren Handwerksbetrieb.');
	// Hausfarbe wie in der App (farbStil leitet Text-/Hell-Töne lesbar ab); ohne Angabe Gold wie das CRM
	return { token: event.params.token, seite, akzent: seite.betrieb.farbe ?? '#c3a56f' };
};

export const actions: Actions = {
	entscheiden: async (event) => {
		const f = await event.request.formData();
		const angebotId = f.get('angebotId');
		try {
			const r = await entscheide(event.params.token, angebotId, {
				entscheidung: f.get('entscheidung'),
				agb: f.get('agb'),
				grund: f.get('grund')
			}, ipVon(event));
			return { erledigt: r.status, angebotId };
		} catch (e) {
			if (e instanceof ApiFehler) return fail(e.status, { fehler: e.message, angebotId });
			console.error('Kundenportal: Entscheidung fehlgeschlagen', e);
			return fail(500, { fehler: 'Das hat leider nicht geklappt – bitte später erneut versuchen.', angebotId });
		}
	}
};
