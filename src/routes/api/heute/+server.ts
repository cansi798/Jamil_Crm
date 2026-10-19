import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfEines } from '$lib/server/tarif';
import { meineEinsaetzeHeute } from '$lib/server/plantafel';

/**
 * „Meine Einsätze heute“: `GET /api/heute` – nur die eigenen Einsätze des angemeldeten Benutzers am heutigen Tag
 * (Berlin). Für jeden Betriebsnutzer mit `auftraege.lesen` oder `auftraege.alle_lesen` (Modul `plantafel`).
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await darfEines(locals, 'plantafel', ['auftraege.lesen', 'auftraege.alle_lesen']);
		const k = betriebKontext(locals);
		return json(await meineEinsaetzeHeute(k, k.benutzerId));
	} catch (e) {
		return alsAntwort(e);
	}
};
