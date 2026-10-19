import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler, leseJson } from '$lib/server/fehler';
import { notizAktualisieren, notizLoeschen } from '$lib/server/notizen';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';

/** Einzelne Notiz: `PUT { text }`, `DELETE` – beide `auftraege.bearbeiten`, Auftrag sichtbar. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'notizen', true);
		const body = (await leseJson(request)) as { text?: unknown };
		if (typeof body.text !== 'string' || body.text.trim() === '') throw new ApiFehler(400, 'Bitte einen Text eingeben.');
		const erg = await notizAktualisieren(k, id, body.text);
		if (!erg) throw new ApiFehler(404, 'Notiz nicht gefunden.');
		return json(erg);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'notizen', true);
		if (!(await notizLoeschen(k, id))) throw new ApiFehler(404, 'Notiz nicht gefunden.');
		return json({ ok: true });
	} catch (e) {
		return alsAntwort(e);
	}
};
