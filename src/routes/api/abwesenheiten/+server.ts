import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfPlanen, darfPlantafelLesen, legeAbwesenheitAn, listeAbwesenheiten } from '$lib/server/plantafel';
import { berlinTag, tagPlus } from '$lib/zeit';

/**
 * Abwesenheiten im Zeitraum: `GET /api/abwesenheiten?von=YYYY-MM-DD&bis=YYYY-MM-DD` (Standard: heute bis +90 Tage).
 * Lesen wie die Plantafel (`plantafel.bearbeiten` oder `auftraege.alle_lesen`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		await darfPlantafelLesen(locals);
		const heute = berlinTag(new Date());
		const von = url.searchParams.get('von') ?? heute;
		const bis = url.searchParams.get('bis') ?? tagPlus(heute, 90);
		return json(await listeAbwesenheiten(betriebKontext(locals), von, bis));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neue Abwesenheit (Recht `plantafel.bearbeiten`): `{ benutzerId, art: urlaub|krank|sonstiges, von, bis, notiz? }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darfPlanen(locals);
		return json(await legeAbwesenheitAn(betriebKontext(locals), await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
