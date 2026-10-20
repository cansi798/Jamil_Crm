import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { meineEinsaetzeHeute } from '$lib/server/plantafel';
import { hatRecht } from '$lib/server/rechte';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { berlinTag } from '$lib/zeit';
import { planPersonen, tagesplan, zeitraumTage } from '$lib/server/tagesplan';

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
	if (nutzer?.betriebId && (hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen') || hatRecht(nutzer, 'auftraege.bearbeiten'))) {
		const k = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
		const module = await moduleDesBetriebs(k);
		if (module.includes('plantafel')) heute = await meineEinsaetzeHeute(k, nutzer.id, jetzt);
		// Kachel „Heute“ (Wunsch Jamil msg 2647): Termine, To-dos, Nachfassen – Chef/Büro mit Personenwahl
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
		personen: personen.length > 1 ? personen : [],
		heuteTag: berlinTag(jetzt),
		benutzerId: nutzer?.id ?? null
	};
};
