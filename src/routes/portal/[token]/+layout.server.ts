import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { portalAussehen } from '$lib/server/portal-zugang';
import { ipVon, OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';

/**
 * Kundenportal mit Passwort (Jamil msg 3037): Ohne gültiges Portal-Cookie (siehe hooks.server.ts) zeigt das Layout
 * nur die Passwort-Abfrage im Portal-Design – die Seite selbst lädt dann nichts (401).
 */
export const load: LayoutServerLoad = async (event) => {
	// Kopfzeilen setzt sonst die Seite (doppelt setzen ist in SvelteKit ein Fehler)
	if (event.locals.portalAngemeldet) return { passwortNoetig: false as const };
	// „same-origin“ statt „no-referrer“: sonst schickt der Browser beim Absenden „Origin: null“ und SvelteKit lehnt das
	// Formular als Cross-Site ab. Das Token verlässt die eigene Adresse trotzdem nie (kein Referrer nach außen).
	event.setHeaders({ ...OEFFENTLICHE_KOPFZEILEN, 'referrer-policy': 'same-origin' });
	let aussehen;
	try {
		aussehen = await portalAussehen(event.params.token, ipVon(event));
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
	if (!aussehen) error(404, 'Dieser Link ist nicht (mehr) gültig. Bitte wenden Sie sich an Ihren Handwerksbetrieb.');
	const grund = event.url.searchParams.get('anmeldung');
	return {
		passwortNoetig: true as const,
		aussehen,
		token: event.params.token,
		anmeldung: (grund === 'falsch' || grund === 'gesperrt' || grund === 'fehlt' ? grund : null) as 'falsch' | 'gesperrt' | 'fehlt' | null
	};
};
