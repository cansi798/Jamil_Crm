import type { PageServerLoad } from './$types';
import { listeVorlagen } from '$lib/server/auftrag-vorlagen';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';

/**
 * Liste aller Auftrags-To-do-Vorlagen.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const vorlagen = await alsSeitenFehler(() => listeVorlagen(k));
	return {
		vorlagen,
		darfBearbeiten: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
	};
};
