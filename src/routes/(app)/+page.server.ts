import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { meineEinsaetzeHeute } from '$lib/server/plantafel';
import { hatRecht } from '$lib/server/rechte';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { berlinTag } from '$lib/zeit';

/**
 * Startseite. Plattform-Admins haben keinen Betrieb und damit keine fachliche Startseite – sie landen in der
 * Plattform-Verwaltung. Für Betriebsnutzer: „Meine Einsätze heute“ (Modul `plantafel` und Leserecht für Aufträge;
 * `null` = Bereich ausblenden), Schnellsuche und „+ Kunde“, wenn Modul und Recht vorhanden sind.
 */
export const load: PageServerLoad = async ({ locals, parent }) => {
	const nutzer = locals.nutzer;
	if (nutzer?.istAdmin && nutzer.betriebId === null) redirect(303, '/admin');
	const { navigation } = await parent();
	const kunden = navigation?.haupt.some((e) => e.symbol === 'kunden') ?? false;
	const jetzt = new Date();
	let heute = null;
	if (nutzer?.betriebId && (hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen'))) {
		const k = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
		if ((await moduleDesBetriebs(k)).includes('plantafel')) heute = await meineEinsaetzeHeute(k, nutzer.id, jetzt);
	}
	return {
		kunden,
		darfKundeAnlegen: kunden && !!nutzer && hatRecht(nutzer, 'kunden.bearbeiten'),
		heute,
		heuteTag: berlinTag(jetzt),
		benutzerId: nutzer?.id ?? null
	};
};
