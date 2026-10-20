import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { meineEinsaetzeHeute } from '$lib/server/plantafel';
import { hatRecht } from '$lib/server/rechte';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { berlinTag } from '$lib/zeit';
import { planPersonen, tagesplan, zeitraumTage } from '$lib/server/tagesplan';
import { dieserMonat, ladeAuslastung } from '$lib/server/auslastung';
import { gewinnSatz } from '$lib/auslastung';
import { laufend } from '$lib/server/zeiterfassung';
import { linksZuAuftraegen } from '$lib/server/auftrag-links';
import { sichtVon } from '$lib/server/auftraege';

/**
 * Startseite. Plattform-Admins haben keinen Betrieb und damit keine fachliche Startseite – sie landen in der
 * Plattform-Verwaltung. Für Betriebsnutzer: „Meine Einsätze heute“ (Modul `plantafel` und Leserecht für Aufträge;
 * `null` = Bereich ausblenden), Schnellsuche und „+ Kunde“, wenn Modul und Recht vorhanden sind.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const nutzer = locals.nutzer;
	if (nutzer?.istAdmin && nutzer.betriebId === null) redirect(303, '/admin');
	const { navigation } = await parent();
	const kunden = navigation?.haupt.some((e) => e.symbol === 'kunden') ?? false;
	const jetzt = new Date();
	let heute = null;
	let plan = null;
	let personen: { id: string; name: string }[] = [];
	// Zeiterfassung auf „Heute“ (Wunsch Jamil msgs 2770–2774): Start/Abfahrt je Auftrag von heute
	let zeit: { laufend: Awaited<ReturnType<typeof laufend>>; auftraege: { id: string; nummer: string; titel: string; kunde: string; zeit: string }[] } | null = null;
	let monat: { satz: string; erreicht: boolean; kalkulationFehlt: boolean; link: string } | null = null;
	if (nutzer?.betriebId && (hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen') || hatRecht(nutzer, 'auftraege.bearbeiten'))) {
		const k = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
		const module = await moduleDesBetriebs(k);
		if (module.includes('plantafel')) heute = await meineEinsaetzeHeute(k, nutzer.id, jetzt);
		// Links der Aufträge (Jamil msg 2850) – für Monteure unterwegs
		if (heute?.length) {
			const ids = [...new Set(heute.map((e) => e.auftragId).filter((x): x is string => !!x))];
			const links = await linksZuAuftraegen(k, sichtVon(nutzer), ids);
			heute = heute.map((e) => ({ ...e, links: e.auftragId ? (links.get(e.auftragId) ?? []).map(({ titel, url, domain }) => ({ titel, url, domain })) : [] }));
		}
		// Kachel „Diesen Monat: X € Gewinn verplant, Y Stunden frei“ (Wunsch Jamil msg 2476, Punkt 5) – nur „Preise sehen“
		if (module.includes('plantafel') && hatRecht(nutzer, 'preise.sehen')) {
			const m = dieserMonat(jetzt);
			const a = await ladeAuslastung(k, m, { mitGeld: true });
			monat = {
				satz: gewinnSatz(a.geld!.ergebnisCent, a.kalkulationFehlt ? null : a.summe.frei),
				erreicht: a.geld!.erreicht,
				kalkulationFehlt: a.kalkulationFehlt,
				link: '/plantafel/auslastung'
			};
		}
		if (module.includes('zeiterfassung') && (hatRecht(nutzer, 'zeiterfassung.nutzen') || hatRecht(nutzer, 'zeiterfassung.alle_sehen'))) {
			const einsaetze = heute ?? (module.includes('plantafel') ? await meineEinsaetzeHeute(k, nutzer.id, jetzt) : []);
			const gesehen = new Set<string>();
			const auftraege = [];
			for (const e of einsaetze) {
				if (!e.auftragId || gesehen.has(e.auftragId)) continue;
				gesehen.add(e.auftragId);
				auftraege.push({ id: e.auftragId, nummer: e.auftragNummer ?? '', titel: e.auftragTitel ?? '', kunde: e.kundeName ?? '', zeit: e.beginn });
			}
			const lauf = await laufend(k, nutzer.id);
			if (lauf && !gesehen.has(lauf.auftragId)) {
				auftraege.unshift({ id: lauf.auftragId, nummer: lauf.auftragNummer ?? '', titel: lauf.auftragTitel ?? '', kunde: '', zeit: lauf.beginn });
			}
			zeit = { laufend: lauf, auftraege };
		}
		// Kachel „Heute“ (Wunsch Jamil msg 2647): Termine, Aufgaben, Nachfassen – Chef/Büro mit Personenwahl
		if (module.includes('auftraege')) {
			personen = await planPersonen(k, nutzer);
			const gewaehlt = url.searchParams.get('person');
			const person = gewaehlt && personen.some((p) => p.id === gewaehlt) ? gewaehlt : nutzer.id;
			plan = await tagesplan(k, nutzer, person, zeitraumTage('heute', berlinTag(jetzt)), { jetzt });
		}
	}
	return {
		kunden,
		darfKundeAnlegen: kunden && !!nutzer && hatRecht(nutzer, 'kunden.bearbeiten'),
		heute,
		plan,
		monat,
		zeit,
		personen: personen.length > 1 ? personen : [],
		heuteTag: berlinTag(jetzt),
		benutzerId: nutzer?.id ?? null
	};
};
