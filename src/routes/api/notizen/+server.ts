import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler, leseJson } from '$lib/server/fehler';
import { notizenFuerAuftrag, notizAnlegen } from '$lib/server/notizen';
import { zugriffAuftrag } from '$lib/server/dokumentation-zugriff';

/**
 * Notizen eines Auftrags: `GET /api/notizen?auftragId=...` (Aufträge lesen, Auftrag sichtbar),
 * `POST { auftragId, text }` (`auftraege.bearbeiten`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const { k, auftrag } = await zugriffAuftrag(locals, url.searchParams.get('auftragId'), 'notizen', false);
		return json(await notizenFuerAuftrag(k, auftrag.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await leseJson(request)) as { auftragId?: unknown; text?: unknown };
		const { k, auftrag } = await zugriffAuftrag(locals, body.auftragId, 'notizen', true);
		if (typeof body.text !== 'string' || body.text.trim() === '') throw new ApiFehler(400, 'Bitte einen Text eingeben.');
		return json(await notizAnlegen(k, auftrag.id, body.text, locals.nutzer!.id), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
