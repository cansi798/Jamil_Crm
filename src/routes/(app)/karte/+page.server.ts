import type { PageServerLoad } from './$types';
import { sichtVon } from '$lib/server/auftraege';
import { firmenStart, ladeKarte, termineAlsStopps, type KartenFilter } from '$lib/server/karte';
import { listeKolonnen } from '$lib/server/kolonnen';
import { listeQuellen } from '$lib/server/quellen';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darfPlanSehen } from '$lib/server/tagesplan';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { hatModul } from '$lib/server/tarif';
import { istStatus, type AuftragStatus } from '$lib/auftrag-status';
import { berlinTag, istTag } from '$lib/zeit';
import { UUID } from '$lib/server/kunden';
import { kachelHinweis } from '$lib/server/kacheln';

/**
 * Auftragskarte (Wunsch Jamil msg 2602): Aufträge als Punkte (Sichtbarkeit wie in der Auftragsliste), Filter in der
 * Adresse (status, ma, ko, von, bis, quelle), Route „Termine heute“ (`?route=heute&person=` bzw. `&kolonne=`).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	const sicht = sichtVon(nutzer);
	const p = url.searchParams;
	const uuid = (w: string | null) => (w && UUID.test(w) ? w.toLowerCase() : undefined);
	const filter: KartenFilter = {
		status: p.getAll('status').filter(istStatus) as AuftragStatus[],
		benutzerId: uuid(p.get('ma')),
		kolonneId: uuid(p.get('ko')),
		von: istTag(p.get('von')) ? p.get('von')! : undefined,
		bis: istTag(p.get('bis')) ? p.get('bis')! : undefined,
		quelleId: p.get('quelle') === 'ohne' ? 'ohne' : uuid(p.get('quelle'))
	};
	const alleSehen = hatRecht(nutzer, 'todos.alle_lesen') || hatRecht(nutzer, 'auftraege.alle_lesen');
	const mitPlantafel = await hatModul(k.betriebId, 'plantafel');
	const [karte, start, mitarbeiter, kolonnen, quellen] = await alsSeitenFehler(() =>
		Promise.all([
			ladeKarte(k, sicht, filter),
			firmenStart(k),
			aktiveMitarbeiter(k).then((alle) => (alleSehen ? alle : alle.filter((m) => m.id === nutzer.id))),
			mitPlantafel ? listeKolonnen(k, true) : Promise.resolve([]),
			listeQuellen(k)
		])
	);
	// Route „Termine heute“: eigene immer, andere nur mit „Alle Aufgaben ansehen“; Kolonne für Mitglieder oder alle
	let route: { titel: string; stopps: Awaited<ReturnType<typeof termineAlsStopps>> } | null = null;
	let routeFehler: string | null = null;
	if (p.get('route') === 'heute') {
		const person = uuid(p.get('person')) ?? (p.get('kolonne') ? undefined : nutzer.id);
		const kolonne = kolonnen.find((x) => x.id === uuid(p.get('kolonne')));
		if (kolonne) {
			if (hatRecht(nutzer, 'todos.alle_lesen') || kolonne.mitglieder.some((m) => m.id === nutzer.id)) {
				route = { titel: `Termine heute – ${kolonne.name}`, stopps: await termineAlsStopps(k, sicht, { kolonneId: kolonne.id }) };
			} else routeFehler = 'Sie dürfen nur Ihre eigene Route und die Ihrer Kolonne sehen.';
		} else if (person) {
			if (darfPlanSehen(nutzer, person)) {
				const name = mitarbeiter.find((m) => m.id === person)?.name ?? '';
				route = { titel: `Termine heute – ${person === nutzer.id ? 'meine' : name}`, stopps: await termineAlsStopps(k, sicht, { benutzerId: person }) };
			} else routeFehler = 'Sie dürfen nur Ihre eigene Route sehen.';
		}
	}
	return {
		kachelHinweis: kachelHinweis(),
		auftraege: karte.auftraege.map((a) => ({
			id: a.id,
			nummer: a.nummer,
			titel: a.titel,
			kundeName: a.kundeName,
			status: a.status,
			adresse: a.adresse,
			telefon: a.telefon,
			kommenderTermin: a.kommenderTermin,
			lat: a.lat,
			lng: a.lng,
			geoStatus: a.geoStatus,
			ungefaehr: a.ungefaehr
		})),
		offen: karte.offen,
		start,
		filter: { ...filter, status: filter.status ?? [] },
		mitarbeiter,
		kolonnen: kolonnen.map((x) => ({ id: x.id, name: x.name })),
		quellen: quellen.map((q) => ({ id: q.id, name: q.name })),
		route,
		routeFehler,
		heute: berlinTag(new Date()),
		ich: nutzer.id
	};
};
