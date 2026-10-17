import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, legeAngebotAn, listeAngebote } from '$lib/server/angebote';

/**
 * Angebote: `GET /api/angebote?auftrag=&status=` (neueste zuerst), `POST { auftragId }` legt einen Entwurf an.
 * Immer Modul `angebote` + `angebote.bearbeiten` + `preise.sehen`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		await angeboteZugriff(locals);
		return json(
			await listeAngebote(betriebKontext(locals), {
				auftragId: url.searchParams.get('auftrag') ?? undefined,
				status: url.searchParams.get('status') ?? undefined
			})
		);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await angeboteZugriff(locals);
		const { auftragId } = await leseJson(request);
		return json(await legeAngebotAn(betriebKontext(locals), auftragId), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
