import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { holeVorlage, listeVorlagen } from '$lib/server/protokoll-formulare';

/** Baukasten einer Protokoll-Vorlage. Ältere Versionen leiten auf die aktuelle weiter. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
	const vorlage = await alsSeitenFehler(() => holeVorlage(k, params.id));
	if (!vorlage.aktuell) {
		const aktuell = (await listeVorlagen(k, { archivierte: true })).find((v) => v.gruppeId === vorlage.gruppeId);
		if (aktuell) redirect(303, `/einstellungen/protokoll-vorlagen/${aktuell.id}`);
	}
	return { vorlage };
};
