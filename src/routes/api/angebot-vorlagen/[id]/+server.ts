import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff } from '$lib/server/angebote';
import { aendereAngebotVorlage, holeAngebotVorlage, loescheAngebotVorlage } from '$lib/server/angebot-vorlagen';

/** Eine Angebots-Vorlage: `GET`, `PUT` (angegebene Felder; `positionen` ersetzt die Liste), `DELETE`. Fremd → 404. */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		return json(await holeAngebotVorlage(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		await angeboteZugriff(locals);
		return json(await aendereAngebotVorlage(betriebKontext(locals), params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		await loescheAngebotVorlage(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
