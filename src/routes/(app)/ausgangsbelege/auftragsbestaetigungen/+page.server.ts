import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { istAbStatus, listeAlleAuftragsbestaetigungen, MAX_ABS } from '$lib/server/auftragsbestaetigung';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { abKennzahlen, siehtKennzahlen } from '$lib/server/kennzahlen';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { istZeitraumArt, zeitraum } from '$lib/kennzahlen';
import { berlinTag } from '$lib/zeit';

/**
 * Ausgangsbelege → Auftragsbestätigungen (Jamil msg 2948): alle erzeugten ABs in der Sicht des Nutzers, Filter
 * `?status=bereit|gesendet`, `?suche=`, Kacheln mit `?zeitraum=`. Rechte wie Angebote (die AB enthält Preise).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	const roh = url.searchParams.get('status');
	const status = istAbStatus(roh) ? roh : null;
	const suche = url.searchParams.get('suche')?.trim().slice(0, 100) || null;
	const zRoh = url.searchParams.get('zeitraum');
	const z = zeitraum(istZeitraumArt(zRoh) ? zRoh : 'monat', berlinTag(new Date()));
	const sicht = sichtVon(locals.nutzer!);
	const module = await moduleDesBetriebs(k);
	return {
		kennzahlen: siehtKennzahlen(locals.nutzer!, module) ? await alsSeitenFehler(() => abKennzahlen(k, sicht, z)) : null,
		zeitraum: z.art,
		status,
		suche,
		abs: await alsSeitenFehler(() => listeAlleAuftragsbestaetigungen(k, sicht, { status, suche })),
		maxTreffer: MAX_ABS
	};
};
