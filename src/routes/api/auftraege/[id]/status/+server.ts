import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { pruefeStatus, setzeStatus } from '$lib/server/auftraege';

/** Statuswechsel `{ status }` – nur ein Schritt vor oder zurück (sonst 409). Recht `auftraege.bearbeiten`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		const k = betriebKontext(locals);
		const { status } = await leseJson(request);
		return json(await setzeStatus(k, params.id, pruefeStatus(status)));
	} catch (e) {
		return alsAntwort(e);
	}
};
