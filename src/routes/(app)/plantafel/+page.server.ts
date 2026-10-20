import type { PageServerLoad } from './$types';
import { listeAuftraege } from '$lib/server/auftraege';
import { ladeTage } from '$lib/server/plantafel';
import { istAnsicht, monatsWochen, type Ansicht } from '$lib/kalender';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { berlinTag, istTag, wocheVon } from '$lib/zeit';
import { listeKolonnen } from '$lib/server/kolonnen';

/**
 * Plantafel (Wunsch Jamil msg 2676): Kalender mit Ansicht `?ansicht=monat|woche|tag` (Standard Monat, wie Outlook) oder
 * `team` (Mitarbeiter × 7 Tage). Farbe `?farbe=status` (sonst nach Mitarbeiter/Kolonne).
 * Team: Mitarbeiter × 7 Tage der Woche mit `?tag=` (Standard: heute, Berlin). Sehen: `plantafel.bearbeiten` oder
 * `auftraege.alle_lesen`; planen (Ziehen, Anlegen, Ändern) nur mit `plantafel.bearbeiten`. Für den Dialog
 * „Einsatz anlegen“ die neuesten offenen Aufträge (ohne abgerechnete, in der Datenbank gefiltert); ältere findet die
 * Suche im Dialog über `/api/auftraege?offen=1&suche=…`.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'plantafel', ['plantafel.bearbeiten', 'auftraege.alle_lesen']);
	const nutzer = locals.nutzer!;
	const heute = berlinTag(new Date());
	const roh = url.searchParams.get('tag');
	const tag = istTag(roh) ? roh : heute;
	const rohAnsicht = url.searchParams.get('ansicht');
	const ansicht: Ansicht = istAnsicht(rohAnsicht) ? rohAnsicht : 'monat';
	const farbe = url.searchParams.get('farbe') === 'status' ? 'status' : 'person';
	const monat = tag.slice(0, 7);
	const wochen = ansicht === 'monat' ? monatsWochen(monat) : [wocheVon(tag)];
	const tage = ansicht === 'tag' ? [tag] : wochen.flat();
	const darfPlanen = hatRecht(nutzer, 'plantafel.bearbeiten');
	const [woche, auftraege, kolonnen] = await alsSeitenFehler(() =>
		Promise.all([
			ladeTage(k, tage),
			darfPlanen ? listeAuftraege(k, { alle: true, benutzerId: nutzer.id }, { offen: true }) : Promise.resolve([]),
			listeKolonnen(k, true)
		])
	);
	// Filter (Wunsch Jamil msg 2508): Mitarbeiter (`ma`) und Kolonnen (`ko`), mehrfach, in der Adresse
	const ma = url.searchParams.getAll('ma').filter((id) => woche.mitarbeiter.some((m) => m.id === id));
	const ko = url.searchParams.getAll('ko').filter((id) => kolonnen.some((x) => x.id === id));
	const gefiltert = ma.length + ko.length > 0;
	const mitgliederDerKolonnen = new Set(kolonnen.filter((x) => ko.includes(x.id)).flatMap((x) => x.mitglieder.map((m) => m.id)));
	const sichtbar = gefiltert ? woche.mitarbeiter.filter((m) => ma.includes(m.id) || mitgliederDerKolonnen.has(m.id)) : woche.mitarbeiter;
	const sichtbareKolonnen = gefiltert ? kolonnen.filter((x) => ko.includes(x.id)) : kolonnen;
	const ids = new Set(sichtbar.map((m) => m.id));
	const koIds = new Set(sichtbareKolonnen.map((x) => x.id));
	return {
		tag,
		heute,
		ansicht,
		farbe,
		monat,
		wochen,
		woche: {
			...woche,
			mitarbeiter: sichtbar,
			einsaetze: woche.einsaetze.filter((e) => ids.has(e.benutzerId) || (e.kolonne && koIds.has(e.kolonne.id))),
			abwesenheiten: woche.abwesenheiten.filter((a) => ids.has(a.benutzerId))
		},
		alleMitarbeiter: woche.mitarbeiter.filter((m) => m.aktiv),
		kolonnen,
		sichtbareKolonnen,
		filter: { ma, ko },
		darfPlanen,
		auftraege: auftraege.map((a) => ({ id: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kundeName }))
	};
};
