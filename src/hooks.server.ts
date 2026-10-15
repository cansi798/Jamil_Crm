import type { Handle } from '@sveltejs/kit';
import {
	COOKIE_NAME,
	loescheSitzungsCookie,
	pruefeSitzungMitStatus,
	setzeSitzungsCookie
} from '$lib/server/auth/sitzung';
import { istNurLesen } from '$lib/server/tarif';

/** Lesende Methoden; alles andere ist eine Schreibanfrage. */
const LESEND = new Set(['GET', 'HEAD']);

/** Auch bei Nur-Lesezugriff erlaubt: Abmelden und die Anmeldeseiten (dort ist niemand „drin“, sondern wechselt das Konto). */
const IMMER_ERLAUBT = (pfad: string) =>
	pfad === '/api/abmelden' || pfad === '/anmelden' || pfad.startsWith('/anmelden/');

/**
 * Liest das Sitzungs-Cookie und setzt `locals.nutzer` (oder `null`). Hat die Datenbank die Sitzung verlängert
 * (höchstens einmal pro Tag), wird auch das Cookie mit frischer Laufzeit neu gesetzt – sonst liefe es im Browser
 * trotz gleitender Verlängerung 30 Tage nach der Anmeldung ab.
 *
 * Nur-Lesezugriff (Abo überfällig/gekündigt, siehe `istNurLesen`) wird hier zentral durchgesetzt: Jede schreibende
 * Anfrage (nicht GET/HEAD) eines angemeldeten Betriebsnutzers wird mit 403 `Nur Lesezugriff` abgewiesen, bevor
 * ein Endpunkt oder eine Formular-Aktion läuft – gilt also für /api/* ebenso wie für Seiten-Formulare und
 * für künftige Routen, ohne dass jede einzeln daran denken muss.
 */
export const handle: Handle = async ({ event, resolve }) => {
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
	if (
		nutzer &&
		!LESEND.has(event.request.method) &&
		!IMMER_ERLAUBT(event.url.pathname) &&
		(await istNurLesen(nutzer))
	) {
		return new Response(JSON.stringify({ fehler: 'Nur Lesezugriff' }), {
			status: 403,
			headers: { 'content-type': 'application/json; charset=utf-8' }
		});
	}
	return resolve(event);
};
