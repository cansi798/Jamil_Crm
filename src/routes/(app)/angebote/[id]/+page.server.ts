import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { holeAngebot } from '$lib/server/angebote';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';

/** Angebots-Editor. Gespeichert wird über die API (`PATCH`/`PUT …/positionen`, Status, neue Version, PDF). */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	return { angebot: await alsSeitenFehler(() => holeAngebot(k, params.id, {
			sicht: sichtVon(locals.nutzer!),
			auftragAendern: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
		})) };
};
