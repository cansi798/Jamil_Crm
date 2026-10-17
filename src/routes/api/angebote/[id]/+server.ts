import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereAngebotKopf, angeboteZugriff, holeAngebot, loescheAngebot } from '$lib/server/angebote';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		return json(await holeAngebot(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Kopf ändern (`datum`, `gueltigBis`, `mwstSatz`, `einleitung`, `schluss`) – nur im Entwurf (sonst 409). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		await angeboteZugriff(locals);
		return json(await aendereAngebotKopf(betriebKontext(locals), params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Nur Entwürfe lassen sich löschen (sonst 409). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		await loescheAngebot(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
