import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfPlanen, legeGruppeAn } from '$lib/server/plantafel';

/**
 * Mehrtägigen Termin und/oder Kolonne einplanen (`plantafel.bearbeiten`): `{ auftragId, benutzerIds?, kolonneId?,
 * vonTag, bisTag?, vonZeit?, bisZeit?, art?, notiz?, ohneWochenende? }` → 201 mit allen Einsätzen (inkl. Warnungen).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darfPlanen(locals);
		return json(await legeGruppeAn(betriebKontext(locals), await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
