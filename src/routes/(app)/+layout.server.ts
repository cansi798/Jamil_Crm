import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { baueNavigation } from '$lib/navigation';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { pruefeNachfassenGedrosselt } from '$lib/server/nachfassen';
import { hatRecht } from '$lib/server/rechte';
import { benachrichtigungen } from '$lib/server/erinnerungen';
import { nextcloud } from '$lib/server/nextcloud/konfig';
import { laufend } from '$lib/server/zeiterfassung';
import { hausfarbe } from '$lib/server/betriebsprofil';
import { farbStil } from '$lib/farbe';

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
		if (route.id === MIT_VORSITZUNG) return { navigation: null, benutzerId: null, sprache: false, erinnern: false, ungelesen: 0, laufendeZeit: null, farbStil: farbStil(null) };
		redirect(303, '/anmelden');
	}
	const module = nutzer.betriebId
		? await moduleDesBetriebs({ betriebId: nutzer.betriebId, benutzerId: nutzer.id })
		: [];
	// Automatisches Nachfassen: fällige Stufen anlegen, sobald jemand die App benutzt (höchstens alle 10 Min. je Betrieb;
	// läuft im Hintergrund und bremst die Seite nicht)
	if (nutzer.betriebId && module.includes('angebote')) void pruefeNachfassenGedrosselt({ betriebId: nutzer.betriebId, benutzerId: nutzer.id });
	// Mikrofon-Knopf nur mit Modul „sprache“ (geprüft wird zusätzlich in jedem Sprach-Endpunkt)
	// Erinnerungen (Wunsch Jamil msg 2679): Glocke mit Zahl der ungelesenen Benachrichtigungen
	const erinnern = !!nutzer.betriebId && hatRecht(nutzer, 'erinnerungen.nutzen');
	const ungelesen = nutzer.betriebId ? (await benachrichtigungen({ betriebId: nutzer.betriebId, benutzerId: nutzer.id }, 1)).ungelesen : 0;
	// Zeiterfassung: laufende Zeit oben anzeigen (je Person höchstens eine)
	const zeiten = !!nutzer.betriebId && module.includes('zeiterfassung') && (hatRecht(nutzer, 'zeiterfassung.nutzen') || hatRecht(nutzer, 'zeiterfassung.alle_sehen'));
	const laufendeZeit = zeiten ? await laufend({ betriebId: nutzer.betriebId!, benutzerId: nutzer.id }, nutzer.id) : null;
	// Hausfarbe des Betriebs (Briefkopf) als Akzent der ganzen App; ohne Angabe Gold (Theme „Handwerk“)
	const farbe = nutzer.betriebId ? await hausfarbe({ betriebId: nutzer.betriebId, benutzerId: nutzer.id }).catch(() => null) : null;
	return { navigation: baueNavigation(nutzer, module, { nextcloud: !!nextcloud() }), benutzerId: nutzer.id, sprache: module.includes('sprache'), erinnern, ungelesen, laufendeZeit, farbStil: farbStil(farbe) };
};
