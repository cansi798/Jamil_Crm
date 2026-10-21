import type { PageServerLoad } from './$types';
import { istAbStatus, listeAlleAuftragsbestaetigungen, MAX_ABS } from '$lib/server/auftragsbestaetigung';
import { alsSeitenFehler } from '$lib/server/seite';
import { belegSeite } from '$lib/server/ausgangsbelege';
import { abKennzahlen } from '$lib/server/kennzahlen';

/**
 * Ausgangsbelege → Auftragsbestätigungen (Jamil msg 2948): alle erzeugten ABs in der Sicht des Nutzers, Filter
 * `?status=bereit|gesendet`, `?suche=`, Kacheln mit `?zeitraum=`. Rechte wie Angebote (die AB enthält Preise).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { k, sicht, z, suche, kennzahlenAn } = await belegSeite(locals, url);
	const roh = url.searchParams.get('status');
	const status = istAbStatus(roh) ? roh : null;
	return {
		kennzahlen: kennzahlenAn ? await alsSeitenFehler(() => abKennzahlen(k, sicht, z)) : null,
		zeitraum: z.art,
		status,
		suche,
		abs: await alsSeitenFehler(() => listeAlleAuftragsbestaetigungen(k, sicht, { status, suche })),
		maxTreffer: MAX_ABS
	};
};
