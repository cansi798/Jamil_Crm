import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { legeProtokollAn, protokolleFuerAuftrag } from '$lib/server/baustellen-protokolle';
import { zugriffAuftrag } from '$lib/server/dokumentation-zugriff';

/**
 * Protokolle eines Auftrags: `GET /api/protokolle?auftragId=...` (`protokolle.lesen`), `POST { auftragId, typ,
 * inhalt? }` (`protokolle.bearbeiten`). Auftrag muss sichtbar sein.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const { k, auftrag } = await zugriffAuftrag(locals, url.searchParams.get('auftragId'), 'protokolle', false);
		return json(await protokolleFuerAuftrag(k, auftrag.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await leseJson(request)) as { auftragId?: unknown; typ?: unknown; inhalt?: Record<string, unknown> };
		const { k, auftrag } = await zugriffAuftrag(locals, body.auftragId, 'protokolle', true);
		return json(await legeProtokollAn(k, auftrag.id, body.typ as never, body.inhalt), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
