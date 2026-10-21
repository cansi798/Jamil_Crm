import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { listeAnsichten, speichereAnsicht } from '$lib/server/ansichten';

/**
 * Gespeicherte Ansichten (Jamil msgs 2830, 2921): `GET /api/ansichten?seite=plantafel` – eigene und geteilte;
 * `POST { seite, name, query, istStandard?, geteilt? }` – aktuelle Filter speichern. Jeder angemeldete Betriebsnutzer.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		return json(await listeAnsichten(betriebKontext(locals), url.searchParams.get('seite')));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const k = betriebKontext(locals);
		return json(await speichereAnsicht(k, locals.nutzer!, (await leseJson(request)) as Record<string, unknown>), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
