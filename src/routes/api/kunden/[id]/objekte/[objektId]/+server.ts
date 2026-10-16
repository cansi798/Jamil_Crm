import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { aendereObjekt, holeObjekt, loescheObjekt } from '$lib/server/kunden';

// Das Objekt muss zum Kunden aus der URL gehören, sonst 404 (auch innerhalb desselben Betriebs).

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		return json(await holeObjekt(betriebKontext(locals), params.id, params.objektId));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		const k = betriebKontext(locals);
		return json(await aendereObjekt(k, params.id, params.objektId, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		await loescheObjekt(betriebKontext(locals), params.id, params.objektId);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
