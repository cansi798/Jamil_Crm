import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { pushGeraete } from '$lib/server/erinnerungen';

/** Konto → Benachrichtigungen (Wunsch Jamil msg 2679): Push auf diesem Gerät ein-/ausschalten – Recht „erinnerungen.nutzen“. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!locals.nutzer.betriebId || !hatRecht(locals.nutzer, 'erinnerungen.nutzen')) error(403, 'Keine Berechtigung');
	return { geraete: await pushGeraete(betriebKontext(locals)) };
};
