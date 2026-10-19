import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';
import { liesProtokoll, aktualisiereProtokoll } from '$lib/server/baustellen-protokolle';

/**
 * Einzelnes Protokoll: `GET /api/protokolle/[id]` (lesen), `PUT { inhalt }` (aktualisieren).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'protokolle', false);
		const prot = await liesProtokoll(k, id);
		if (!prot) return json({ fehler: 'Nicht gefunden' }, { status: 404 });
		return json(prot);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'protokolle', true);
		const body = await leseJson(request) as { inhalt: Record<string, unknown> };
		const erg = await aktualisiereProtokoll(k, id, body.inhalt);
		return json(erg);
	} catch (e) {
		return alsAntwort(e);
	}
};