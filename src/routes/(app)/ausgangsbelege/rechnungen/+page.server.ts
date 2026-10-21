import type { PageServerLoad } from './$types';
import { belegSeite } from '$lib/server/ausgangsbelege';

/**
 * Ausgangsbelege → Rechnungen (Jamil msg 2948): Rechnungen schreibt das CRM bewusst NICHT selbst (GoBD/E-Rechnung) –
 * sie kommen mit der Lexware-Anbindung. Bis dahin derselbe Rahmen wie die anderen Reiter (msgs 3054–3056): Suche und
 * Status gesperrt, Platzhalter-Kacheln, Leerzustand statt Liste.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { z, kennzahlenAn } = await belegSeite(locals, url);
	return { zeitraum: z.art, kennzahlenAn };
};
