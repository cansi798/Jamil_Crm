import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { betriebKontext } from '$lib/server/rechte';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { sichtbareNeuigkeiten } from '$lib/neuigkeiten';

/** „Was ist neu“ (Jamil, Talk msg 3423): jede neue Funktion in einem Satz mit Fundort – für alle Benutzer eines Betriebs. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!locals.nutzer.betriebId) redirect(303, '/');
	const module = await moduleDesBetriebs(betriebKontext(locals));
	return { eintraege: sichtbareNeuigkeiten(locals.nutzer, module) };
};
