import type { PageServerLoad } from './$types';
import { holeAngebotVorlage } from '$lib/server/angebot-vorlagen';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';

/** Eine Angebots-Vorlage bearbeiten (Rechte prüft +layout.server.ts; fremd/unbekannt → 404). */
export const load: PageServerLoad = async ({ locals, params, parent, url }) => {
	await parent();
	return {
		vorlage: await alsSeitenFehler(() => holeAngebotVorlage(betriebKontext(locals), params.id)),
		gespeichert: url.searchParams.has('gespeichert')
	};
};
