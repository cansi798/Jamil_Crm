import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { aendereRolle, loescheRolle } from '$lib/server/rollen';

/** Name und/oder Rechte ändern: `{ name?, rechte? }`. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		const k = betriebKontext(locals);
		return json(await aendereRolle(k, params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		await loescheRolle(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
