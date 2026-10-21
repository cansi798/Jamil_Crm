import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';
import { seitenZugriff } from '$lib/server/seite';

/**
 * Ausgangsbelege → Rechnungen (Jamil msg 2948): Rechnungen schreibt das CRM bewusst NICHT selbst (GoBD/E-Rechnung) –
 * sie kommen mit der Lexware-Anbindung. Bis dahin nur die Listenstruktur mit klarem Leer-Zustand.
 */
export const load: PageServerLoad = async ({ locals }) => {
	await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	return {};
};
