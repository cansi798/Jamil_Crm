import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { notizAktualisieren, notizLoeschen } from '$lib/server/notizen';

/**
 * Einzelne Notiz: `PUT /api/notizen/[id] { text }` (aktualisieren), `DELETE /api/notizen/[id]` (löschen).
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await leseJson(request) as { text: string };
		if (!body.text) return json({ fehler: 'text ist erforderlich' }, { status: 400 });
		const erg = await notizAktualisieren(betriebKontext(locals), params.id, body.text);
		if (!erg) return json({ fehler: 'Notiz nicht gefunden' }, { status: 404 });
		return json(erg);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const ok = await notizLoeschen(betriebKontext(locals), params.id);
		if (!ok) return json({ fehler: 'Notiz nicht gefunden' }, { status: 404 });
		return json({ ok: true });
	} catch (e) {
		return alsAntwort(e);
	}
};