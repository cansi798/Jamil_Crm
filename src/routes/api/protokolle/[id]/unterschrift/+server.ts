import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { speichereUnterschrift } from '$lib/server/baustellen-protokolle';

/**
 * Unterschrift: `POST /api/protokolle/[id]/unterschrift` (PNG als roher Körper, max 500 KB).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const buffer = Buffer.from(await request.arrayBuffer());
		await speichereUnterschrift(betriebKontext(locals), params.id, buffer);
		return json({ ok: true });
	} catch (e) {
		return alsAntwort(e);
	}
};