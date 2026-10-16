import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { baueNavigation } from '$lib/navigation';
import { moduleDesBetriebs } from '$lib/server/tarif';

/** Einzige Seite der App, die ohne volle Sitzung erreichbar ist: Einrichtung der Zwei-Faktor-Anmeldung (Vor-Sitzung). */
const MIT_VORSITZUNG = '/(app)/konto/zwei-faktor';

/**
 * App-Hülle: Gäste gehen zur Anmeldung. Ausnahme ist die Pflicht-Einrichtung der Zwei-Faktor-Anmeldung – dort ist
 * man nach dem Passwort, aber noch nicht angemeldet (Vor-Sitzung, Carry T6); die Seite prüft das selbst und bekommt
 * keine Navigation. Angemeldete bekommen die Navigation nach Tarif-Modulen und Rechten (nur Anzeige; geprüft wird
 * serverseitig in jeder Seite und jedem Endpunkt).
 */
export const load: LayoutServerLoad = async ({ locals, route }) => {
	const nutzer = locals.nutzer;
	if (!nutzer) {
		if (route.id === MIT_VORSITZUNG) return { navigation: null };
		redirect(303, '/anmelden');
	}
	const module = nutzer.betriebId
		? await moduleDesBetriebs({ betriebId: nutzer.betriebId, benutzerId: nutzer.id })
		: [];
	return { navigation: baueNavigation(nutzer, module) };
};
