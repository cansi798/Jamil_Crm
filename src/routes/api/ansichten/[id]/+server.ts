import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereAnsicht, loescheAnsicht } from '$lib/server/ansichten';

/** Eigene Ansicht ändern (Name, Filter, Standard, Teilen) bzw. löschen; fremde → 404. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = betriebKontext(locals);
		return json(await aendereAnsicht(k, locals.nutzer!, params.id, (await leseJson(request)) as Record<string, unknown>));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await loescheAnsicht(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
