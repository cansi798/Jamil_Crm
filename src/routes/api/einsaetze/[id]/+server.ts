import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereEinsatz, darfPlanen, darfPlantafelLesen, holeEinsatz, loescheEinsatz } from '$lib/server/plantafel';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darfPlantafelLesen(locals);
		return json(await holeEinsatz(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Teiländerung, z. B. Verschieben `{ beginn, ende, benutzerId }`; Antwort mit den Warnungen des neuen Stands. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darfPlanen(locals);
		return json(await aendereEinsatz(betriebKontext(locals), params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darfPlanen(locals);
		await loescheEinsatz(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
