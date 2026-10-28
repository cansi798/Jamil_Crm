import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Früher eigene Seite „Leistungen für Bestandskunden“ – seit Jamil msg 3534 ein Abschnitt der Kundenportal-Einstellungen.
 * Alte Links und Lesezeichen führen dorthin.
 */
export const load: PageServerLoad = () => {
	redirect(308, '/einstellungen/kundenportal#bestandskunden');
};
