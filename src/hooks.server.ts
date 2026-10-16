import type { Handle } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	loescheSitzungsCookie,
	pruefeSitzungMitStatus,
	setzeSitzungsCookie
} from '$lib/server/auth/sitzung';
import { istNurLesen } from '$lib/server/tarif';
import { schliesseDb } from '$lib/server/db';
import { istAdminPfad, nichtGefundenAntwort, nurLesenAntwort } from '$lib/server/sperren';
import { mitSicherheitsKopfzeilen } from '$lib/server/sicherheit';

// adapter-node meldet das geordnete Beenden (SIGTERM/SIGINT) mit diesem Ereignis, nachdem der Server keine Anfragen
// mehr annimmt. Dann die Datenbank-Pools schließen – offene Verbindungen hielten den Prozess sonst am Leben.
process.on('sveltekit:shutdown', () => {
	void schliesseDb();
});

/** Lesende Methoden; alles andere ist eine Schreibanfrage. */
const LESEND = new Set(['GET', 'HEAD']);

/**
 * Auch bei Nur-Lesezugriff erlaubt: Abmelden, die Anmeldeseiten und die Einladungsseite (dort ist niemand „drin“,
 * sondern wechselt das Konto bzw. richtet ein neues ein; die Annahme berührt nur das neue Konto).
 */
const IMMER_ERLAUBT = (pfad: string) =>
	pfad === '/api/abmelden' || pfad === '/anmelden' || pfad.startsWith('/anmelden/') || pfad.startsWith('/einladung/');

/**
 * Liest das Sitzungs-Cookie und setzt `locals.nutzer` (oder `null`). Hat die Datenbank die Sitzung verlängert
 * (höchstens einmal pro Tag), wird auch das Cookie mit frischer Laufzeit neu gesetzt – sonst liefe es im Browser
 * trotz gleitender Verlängerung 30 Tage nach der Anmeldung ab.
 *
 * Nur-Lesezugriff (Abo überfällig/gekündigt, siehe `istNurLesen`) wird hier zentral durchgesetzt: Jede schreibende
 * Anfrage (nicht GET/HEAD) eines angemeldeten Betriebsnutzers wird mit 403 `Nur Lesezugriff` abgewiesen, bevor
 * ein Endpunkt oder eine Formular-Aktion läuft – gilt also für /api/* ebenso wie für Seiten-Formulare und
 * für künftige Routen, ohne dass jede einzeln daran denken muss. Die Antwort passt zum Aufrufer (JSON für die API,
 * ActionResult für `use:enhance`, HTML für Formulare ohne JavaScript; siehe `sperren.ts`).
 */
const pruefeZugang: Handle = async ({ event, resolve }) => {
	event.locals.nutzer = null;
	const token = event.cookies.get(COOKIE_NAME);
	if (token) {
		const ergebnis = await pruefeSitzungMitStatus(token);
		if (ergebnis) {
			event.locals.nutzer = ergebnis.nutzer;
			if (ergebnis.verlaengert) setzeSitzungsCookie(event.cookies, token);
		} else {
			loescheSitzungsCookie(event.cookies);
		}
	}
	const nutzer = event.locals.nutzer;
	const pfad = event.url.pathname;
	const schreibend = !LESEND.has(event.request.method);
	// Admin-Bereich: Für alle außer Plattform-Admins gibt es ihn nicht – Schreibanfragen bekommen sofort 404 (nicht
	// etwa die Nur-Lese-Meldung, die seine Existenz verriete). Lesende Anfragen beantworten Layout bzw. API selbst mit 404.
	if (istAdminPfad(pfad)) {
		const istPlattformAdmin = nutzer?.istAdmin === true && nutzer.betriebId === null;
		if (schreibend && !istPlattformAdmin) return nichtGefundenAntwort(pfad);
		return resolve(event); // Plattform-Admins sind nie auf Nur-Lesen beschränkt
	}
	if (nutzer && schreibend && !IMMER_ERLAUBT(pfad) && (await istNurLesen(nutzer))) {
		return nurLesenAntwort(event.request);
	}
	return resolve(event);
};

/**
 * Jede Antwort – auch Weiterleitungen und die Sperr-Antworten oben – bekommt die Grundschutz-Kopfzeilen
 * (`sicherheit.ts`); die Content-Security-Policy der Seiten setzt SvelteKit selbst (`kit.csp` in `svelte.config.js`).
 */
export const handle: Handle = async (eingabe) => mitSicherheitsKopfzeilen(await pruefeZugang(eingabe));
