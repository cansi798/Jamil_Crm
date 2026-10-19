import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfPlantafelLesen, ladeWoche } from '$lib/server/plantafel';
import { berlinTag, istTag } from '$lib/zeit';

/**
 * Plantafel einer Woche: `GET /api/plantafel?tag=YYYY-MM-DD` (Standard: heute in Berlin) → `{ tage, mitarbeiter,
 * einsaetze, abwesenheiten }`. Lesen: Modul `plantafel` + `plantafel.bearbeiten` oder `auftraege.alle_lesen`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		await darfPlantafelLesen(locals);
		const tag = url.searchParams.get('tag') ?? berlinTag(new Date());
		if (!istTag(tag)) throw new ApiFehler(400, 'Ungültiger Tag.');
		return json(await ladeWoche(betriebKontext(locals), tag));
	} catch (e) {
		return alsAntwort(e);
	}
};
