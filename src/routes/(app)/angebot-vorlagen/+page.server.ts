import type { PageServerLoad } from './$types';
import { listeAngebotVorlagen } from '$lib/server/angebot-vorlagen';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';

/** Liste der Angebots-Vorlagen (Rechte prüft +layout.server.ts). */
export const load: PageServerLoad = async ({ locals, parent }) => {
	await parent();
	return { vorlagen: await alsSeitenFehler(() => listeAngebotVorlagen(betriebKontext(locals))) };
};
