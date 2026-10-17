import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { legeProtokollAn, protokolleFuerAuftrag } from '$lib/server/baustellen-protokolle';

/**
 * Protokolle: `GET /api/protokolle?auftragId=...` (Liste), `POST { auftragId, typ, inhalt? }` (anlegen).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const auftragId = url.searchParams.get('auftragId');
		if (!auftragId) return json({ fehler: 'auftragId fehlt' }, { status: 400 });
		return json(await protokolleFuerAuftrag(betriebKontext(locals), auftragId));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await leseJson(request) as { auftragId: string; typ: string; inhalt?: Record<string, unknown> };
		const erg = await legeProtokollAn(betriebKontext(locals), body.auftragId, body.typ as never, body.inhalt);
		return json(erg, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};