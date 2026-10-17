import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { liesProtokoll, aktualisiereProtokoll } from '$lib/server/baustellen-protokolle';

/**
 * Einzelnes Protokoll: `GET /api/protokolle/[id]` (lesen), `PUT { inhalt }` (aktualisieren).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const prot = await liesProtokoll(betriebKontext(locals), params.id);
		if (!prot) return json({ fehler: 'Nicht gefunden' }, { status: 404 });
		return json(prot);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await leseJson(request) as { inhalt: Record<string, unknown> };
		const erg = await aktualisiereProtokoll(betriebKontext(locals), params.id, body.inhalt);
		return json(erg);
	} catch (e) {
		return alsAntwort(e);
	}
};