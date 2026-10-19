import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';
import { speichereUnterschrift } from '$lib/server/baustellen-protokolle';

/**
 * Unterschrift: `POST /api/protokolle/[id]/unterschrift` (PNG als roher Körper, max 500 KB).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'protokolle', true);
		const buffer = Buffer.from(await request.arrayBuffer());
		await speichereUnterschrift(k, id, buffer);
		return json({ ok: true });
	} catch (e) {
		return alsAntwort(e);
	}
};