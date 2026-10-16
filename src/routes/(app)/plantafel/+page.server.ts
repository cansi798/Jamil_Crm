import type { PageServerLoad } from './$types';
import { listeAuftraege } from '$lib/server/auftraege';
import { ladeWoche } from '$lib/server/plantafel';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { berlinTag, istTag } from '$lib/zeit';

/**
 * Plantafel: Mitarbeiter × 7 Tage der Woche mit `?tag=` (Standard: heute, Berlin). Sehen: `plantafel.bearbeiten` oder
 * `auftraege.alle_lesen`; planen (Ziehen, Anlegen, Ändern) nur mit `plantafel.bearbeiten`. Für den Dialog
 * „Einsatz anlegen“ die neuesten Aufträge (ohne abgerechnete).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'plantafel', ['plantafel.bearbeiten', 'auftraege.alle_lesen']);
	const nutzer = locals.nutzer!;
	const heute = berlinTag(new Date());
	const roh = url.searchParams.get('tag');
	const tag = istTag(roh) ? roh : heute;
	const darfPlanen = hatRecht(nutzer, 'plantafel.bearbeiten');
	const [woche, auftraege] = await alsSeitenFehler(() =>
		Promise.all([
			ladeWoche(k, tag),
			darfPlanen ? listeAuftraege(k, { alle: true, benutzerId: nutzer.id }, {}) : Promise.resolve([])
		])
	);
	return {
		tag,
		heute,
		woche,
		darfPlanen,
		auftraege: auftraege
			.filter((a) => a.status !== 'abgerechnet')
			.map((a) => ({ id: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kundeName }))
	};
};
