import type { PageServerLoad } from './$types';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { holeProtokoll } from '$lib/server/protokoll-formulare';
import { AUSFUELLEN, LESEN } from '$lib/server/protokoll-zugriff';
import { darfEines } from '$lib/server/tarif';

/** Protokoll ausfüllen (Assistent) bzw. ansehen (abgeschlossen). Sichtbar wie der Auftrag, sonst 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'protokolle', [...LESEN]);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
		const protokoll = await holeProtokoll(k, sichtVon(nutzer), params.id);
		return { protokoll, darfAusfuellen: AUSFUELLEN.some((r) => hatRecht(nutzer, r)) };
	});
};
