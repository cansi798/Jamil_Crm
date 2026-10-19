import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, legeAngebotAn, legeAngebotOhneAuftragAn, listeAngebote } from '$lib/server/angebote';

/**
 * Angebote: `GET /api/angebote?auftrag=&status=` (neueste zuerst), `POST { auftragId }` legt einen Entwurf an.
 * Immer Modul `angebote` + `angebote.bearbeiten` + `preise.sehen`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const zg = await angeboteZugriff(locals);
		return json(
			await listeAngebote(betriebKontext(locals), {
				auftragId: url.searchParams.get('auftrag') ?? undefined,
				status: url.searchParams.get('status') ?? undefined
			}, zg)
		);
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { auftragId, ohneAuftrag, kundeId } = await leseJson(request);
		// Ohne Auftrag (Phase 4): `{ ohneAuftrag: true, kundeId? }` – sonst wie bisher `{ auftragId }`
		const angebot =
			ohneAuftrag === true
				? await legeAngebotOhneAuftragAn(betriebKontext(locals), kundeId ?? null, zg)
				: await legeAngebotAn(betriebKontext(locals), auftragId, zg);
		return json(angebot, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
