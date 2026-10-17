import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { notizenFuerAuftrag, notizAnlegen } from '$lib/server/notizen';

/**
 * Notizen: `GET /api/notizen?auftragId=...` (Liste), `POST { auftragId, text }` (anlegen).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const auftragId = url.searchParams.get('auftragId');
		if (!auftragId) return json({ fehler: 'auftragId fehlt' }, { status: 400 });
		return json(await notizenFuerAuftrag(betriebKontext(locals), auftragId));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await leseJson(request) as { auftragId: string; text: string };
		if (!body.auftragId || !body.text) {
			return json({ fehler: 'auftragId und text sind erforderlich' }, { status: 400 });
		}
		const erg = await notizAnlegen(betriebKontext(locals), body.auftragId, body.text, locals.nutzer?.id);
		return json(erg, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};