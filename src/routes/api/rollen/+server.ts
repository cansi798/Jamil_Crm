import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { legeRolleAn, listeRollen } from '$lib/server/rollen';

/**
 * Alle Rollen des Betriebs (mit Anzahl der Benutzer). Lesen darf, wer Rollen verwaltet (`einstellungen`) oder sie
 * Benutzern zuweist (`benutzer.verwalten`); ändern nur `einstellungen`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.nutzer) throw new ApiFehler(401, 'Nicht angemeldet');
		if (!hatRecht(locals.nutzer, 'einstellungen') && !hatRecht(locals.nutzer, 'benutzer.verwalten')) {
			throw new ApiFehler(403, 'Keine Berechtigung');
		}
		return json(await listeRollen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neue Rolle: `{ name, vorlage?, rechte? }` – ohne `rechte` werden die der Vorlage übernommen. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		const k = betriebKontext(locals);
		return json(await legeRolleAn(k, await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
