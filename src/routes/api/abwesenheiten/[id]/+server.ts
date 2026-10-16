import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereAbwesenheit, darfPlanen, loescheAbwesenheit } from '$lib/server/plantafel';

/** Teiländerung (Art, Von, Bis, Notiz). Recht `plantafel.bearbeiten`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darfPlanen(locals);
		return json(await aendereAbwesenheit(betriebKontext(locals), params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darfPlanen(locals);
		await loescheAbwesenheit(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
