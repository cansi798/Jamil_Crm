import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { alsSeitenFehler } from '$lib/server/seite';
import { rechnungenZugriff } from '$lib/server/rechnungen-zugriff';
import { listeRechnungen, MAX_RECHNUNGEN, offeneRechnungen } from '$lib/server/lexware/rechnungen';
import { pruefeMahnungenGedrosselt } from '$lib/server/lexware/mahnungen';
import { siehtKennzahlen } from '$lib/server/kennzahlen';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { belegSuche } from '$lib/ausgangsbelege';
import { istZeitraumArt } from '$lib/kennzahlen';
import { istRechnungFilter } from '$lib/rechnungen';

/**
 * Ausgangsbelege → Rechnungen (Lexware Phase 3): alle Rechnungen mit Zahlstatus aus Lexware, Filter
 * `?status=offen|ueberfaellig|teilbezahlt|bezahlt|entwurf`, `?suche=`. Gleicher Rahmen wie die anderen Reiter
 * (BelegSeite, Jamil msgs 3054–3056). Recht „Rechnungen sehen“ + „Preise sehen“ (Liste enthält Beträge).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const z = await alsSeitenFehler(() => rechnungenZugriff(locals));
	if (!z.preise) error(403, 'Keine Berechtigung');
	void pruefeMahnungenGedrosselt(z.k);
	const roh = url.searchParams.get('status');
	const status = istRechnungFilter(roh) && roh !== 'alle' ? roh : null;
	const zRoh = url.searchParams.get('zeitraum');
	const suche = belegSuche(url);
	return {
		status,
		suche,
		zeitraum: istZeitraumArt(zRoh) ? zRoh : 'monat',
		kennzahlen: siehtKennzahlen(locals.nutzer!, await moduleDesBetriebs(z.k)) ? await offeneRechnungen(z.k) : null,
		rechnungen: await listeRechnungen(z.k, { filter: status ?? 'alle', suche, preise: true }),
		maxTreffer: MAX_RECHNUNGEN
	};
};
