import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { widerrufeEinladung } from '$lib/server/benutzer';

/** Offene Einladung widerrufen: Der Link wird sofort ungültig. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		pruefeRecht(locals, 'benutzer.verwalten');
		await widerrufeEinladung(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
