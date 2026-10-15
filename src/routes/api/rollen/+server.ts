import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { legeRolleAn, listeRollen } from '$lib/server/rollen';

/** Alle Rollen des Betriebs (mit Anzahl der Benutzer). */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
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
