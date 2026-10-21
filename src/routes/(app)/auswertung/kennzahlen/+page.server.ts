import type { PageServerLoad } from './$types';
import { cockpit, kennzahlenZugriff } from '$lib/server/kennzahlen';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istZeitraumArt, zeitraum } from '$lib/kennzahlen';
import { berlinTag } from '$lib/zeit';

/**
 * Auswertungen → Kennzahlen (Jamil msg 2858): sieben Kennzahlen mit Formel, Zeitraum, Trend zum Vorzeitraum und Ampel
 * nach seinen Richtwerten; Beträge nur mit „Preise sehen“. Zugriff: Modul `auftraege` + „Alle Aufträge ansehen“.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	await seitenZugriff(locals, 'auftraege', 'auftraege.alle_lesen');
	return alsSeitenFehler(async () => {
		const { k, preise } = await kennzahlenZugriff(locals);
		const roh = url.searchParams.get('zeitraum');
		const art = istZeitraumArt(roh) ? roh : 'jahr';
		const z = zeitraum(art, berlinTag(new Date()));
		return { zeitraum: z, kennzahlen: await cockpit(k, z, preise), preise };
	});
};
