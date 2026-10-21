import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listeAktionen, listeLaden } from '$lib/server/formular-vorlagen-seite';

/** Einstellungen → Protokoll-Vorlagen. Alte Adresse `?art=aufmass` → eigene Seite Aufmaß-Vorlagen (Jamil msg 3085). */
const laden = listeLaden('protokoll');
export const load: PageServerLoad = async (event) => {
	if (event.url.searchParams.get('art') === 'aufmass') redirect(308, '/einstellungen/aufmass-vorlagen');
	return laden(event);
};
export const actions: Actions = listeAktionen('protokoll');
