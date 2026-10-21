import type { PageServerLoad } from './$types';
import { listeKunden, MAX_TREFFER, SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { sichtVon } from '$lib/server/auftraege';
import { istKundenGruppe, kundenIdsFuer, kundenKennzahlen, siehtKennzahlen, type KundenKennzahlen } from '$lib/server/kennzahlen';
import { istZeitraumArt, zeitraum } from '$lib/kennzahlen';
import { berlinTag } from '$lib/zeit';

/**
 * Kundenliste mit Suche (`?suche=`): höchstens 50 Treffer, nach Name sortiert. Zu lange Suche wird gekürzt (R19).
 * Kennzahl-Kacheln (Jamil msg 2799, nur mit „Alle Aufträge ansehen“): Zeitraum `?zeitraum=`, Klick auf eine Kachel
 * filtert die Liste (`?gruppe=aktiv|angenommen|abgelehnt|abgelaufen`).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	const nutzer = locals.nutzer!;
	const suche = (url.searchParams.get('suche') ?? '').slice(0, SUCHE_MAX_ZEICHEN);
	const zRoh = url.searchParams.get('zeitraum');
	const z = zeitraum(istZeitraumArt(zRoh) ? zRoh : 'monat', berlinTag(new Date()));
	const gRoh = url.searchParams.get('gruppe');
	const module = await moduleDesBetriebs({ betriebId: nutzer.betriebId!, benutzerId: nutzer.id });
	const mitKennzahlen = siehtKennzahlen(nutzer, module);
	const angebote = mitKennzahlen && module.includes('angebote') && hatRecht(nutzer, 'angebote.bearbeiten') && hatRecht(nutzer, 'preise.sehen');
	const gruppe = mitKennzahlen && istKundenGruppe(gRoh) && (gRoh === 'aktiv' || angebote) ? gRoh : null;
	const sicht = sichtVon(nutzer);
	const [alle, kennzahlen, ids] = await alsSeitenFehler(() =>
		Promise.all([
			listeKunden(k, suche),
			mitKennzahlen ? kundenKennzahlen(k, sicht, z, { angebote }) : Promise.resolve(null as KundenKennzahlen | null),
			gruppe ? kundenIdsFuer(k, sicht, z, gruppe) : Promise.resolve(null)
		])
	);
	return {
		suche,
		kunden: ids ? alle.filter((x) => ids.has(x.id)) : alle,
		maxTreffer: MAX_TREFFER,
		darfBearbeiten: hatRecht(nutzer, 'kunden.bearbeiten'),
		kennzahlen,
		zeitraum: z.art,
		gruppe
	};
};
