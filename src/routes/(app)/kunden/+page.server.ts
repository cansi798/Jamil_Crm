import type { PageServerLoad } from './$types';
import { listeKunden, MAX_TREFFER, SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { sichtVon } from '$lib/server/auftraege';
import { istKundenGruppe, kundenIdsFuer, kundenKennzahlen, siehtKennzahlen, type KundenKennzahlen } from '$lib/server/kennzahlen';
import { istZeitraumArt, zeitraum } from '$lib/kennzahlen';
import { berlinTag } from '$lib/zeit';
import { kundenZeilenInfo } from '$lib/server/kunden-zeilen';
import { erlaubteSortierungen, sortierungAus, type KundenZeilenRechte } from '$lib/kunden-zeilen';

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
	// Mehr Infos in der Zeile (Jamil msg 3522) – je nach Modul und Recht; ohne „Alle Aufträge ansehen“ keine Auftrags-/Angebotsinfos
	const alleAuftraege = hatRecht(nutzer, 'auftraege.alle_lesen');
	const rechte: KundenZeilenRechte = {
		auftraege: alleAuftraege && module.includes('auftraege'),
		angebote: alleAuftraege && module.includes('angebote'),
		portal: alleAuftraege && module.includes('kundenportal') && hatRecht(nutzer, 'kundenportal.verwalten')
	};
	const sortierung = sortierungAus(url.searchParams.get('sortierung'), rechte);
	const [kennzahlen, ids] = await alsSeitenFehler(() =>
		Promise.all([
			mitKennzahlen ? kundenKennzahlen(k, sicht, z, { angebote }) : Promise.resolve(null as KundenKennzahlen | null),
			gruppe ? kundenIdsFuer(k, sicht, z, gruppe) : Promise.resolve(null)
		])
	);
	const kunden = await alsSeitenFehler(() => listeKunden(k, suche, { sortierung, nurIds: ids ? [...ids] : null }));
	const info = await alsSeitenFehler(() => kundenZeilenInfo(k, kunden.map((x) => x.id), rechte));
	return {
		suche,
		kunden: kunden.map((x) => ({ ...x, info: info.get(x.id) ?? null })),
		rechte,
		sortierung,
		sortierungen: erlaubteSortierungen(rechte).map(({ wert, text }) => ({ wert, text })),
		maxTreffer: MAX_TREFFER,
		darfBearbeiten: hatRecht(nutzer, 'kunden.bearbeiten'),
		kennzahlen,
		zeitraum: z.art,
		gruppe
	};
};
