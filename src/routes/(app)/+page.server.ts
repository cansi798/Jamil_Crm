import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';

/**
 * Startseite. Plattform-Admins haben keinen Betrieb und damit keine fachliche Startseite – sie landen in der
 * Plattform-Verwaltung. Für Betriebsnutzer: Schnellsuche und „+ Kunde“, wenn Modul und Recht vorhanden sind.
 */
export const load: PageServerLoad = async ({ locals, parent }) => {
	const nutzer = locals.nutzer;
	if (nutzer?.istAdmin && nutzer.betriebId === null) redirect(303, '/admin');
	const { navigation } = await parent();
	const kunden = navigation?.haupt.some((e) => e.symbol === 'kunden') ?? false;
	return {
		kunden,
		darfKundeAnlegen: kunden && !!nutzer && hatRecht(nutzer, 'kunden.bearbeiten')
	};
};
