import type { Handle, ServerInit } from '@sveltejs/kit';
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
import { pruefeSchriften } from '$lib/server/pdf/angebot-pdf';
import { registriereKanal, starteErinnerungsDienst, stoppeErinnerungsDienst } from '$lib/server/erinnerungen';
import { nextcloud } from '$lib/server/nextcloud/konfig';
import { nextcloudKanal } from '$lib/server/nextcloud/melden';
import { starteNextcloudDienst, stoppeNextcloudDienst } from '$lib/server/nextcloud/abgleich';
import { PORTAL_COOKIE, sitzungGueltig } from '$lib/server/portal-zugang';
import { ipVon } from '$lib/server/buchung-anfrage';

/** Beim Start: Schriften fürs Angebots-PDF müssen da sein – sonst startet der Server nicht (lauter Fehler statt 500 später). */
export const init: ServerInit = () => {
	pruefeSchriften();
	// Erinnerungen (Wunsch Jamil msg 2679): jede Minute fällige zustellen (App-Glocke + Web-Push)
	if (!process.env.VITEST && process.env.CRM_ERINNERUNGEN !== 'aus') starteErinnerungsDienst();
	// Nextcloud-Anbindung (optional, nur mit NEXTCLOUD_URL): Konfiguration beim Start prüfen (Fehler = Start bricht ab),
	// Talk als weiterer Zustellweg für Erinnerungen, Abgleich Kalender/Kontakte/Dateien im Hintergrund.
	const nc = nextcloud();
	if (nc) {
		if (nc.talk) registriereKanal(nextcloudKanal);
		if (!process.env.VITEST) starteNextcloudDienst();
	}
};

// adapter-node meldet das geordnete Beenden (SIGTERM/SIGINT) mit diesem Ereignis, nachdem der Server keine Anfragen
// mehr annimmt. Dann die Datenbank-Pools schließen – offene Verbindungen hielten den Prozess sonst am Leben.
process.on('sveltekit:shutdown', () => {
	stoppeErinnerungsDienst();
	stoppeNextcloudDienst();
	void schliesseDb();
});

/** Lesende Methoden; alles andere ist eine Schreibanfrage. */
const LESEND = new Set(['GET', 'HEAD']);

/**
 * Auch bei Nur-Lesezugriff erlaubt: Abmelden, die Anmeldeseiten und die Einladungsseite (dort ist niemand „drin“,
 * sondern wechselt das Konto bzw. richtet ein neues ein; die Annahme berührt nur das neue Konto).
 */
const IMMER_ERLAUBT = (pfad: string) =>
	pfad === '/api/abmelden' || pfad === '/anmelden' || pfad.startsWith('/anmelden/') || pfad.startsWith('/einladung/') ||
	// Online-Buchung: öffentlich, ohne Bezug zur Sitzung (wer bucht, handelt als Gast)
	pfad.startsWith('/buchen/') || pfad.startsWith('/buchung/') ||
	// Kundenportal: öffentlich über den Link, wer dort annimmt, handelt als Kunde
	pfad.startsWith('/portal/');

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
/** Unterseiten des Portals, die ohne Portal-Cookie erreichbar sind (Passwort-Abfrage und Anmelden). */
const PORTAL_SEITE = '/portal/[token]';
const PORTAL_ANMELDEN = '/portal/[token]/anmelden';

/** Gehört die Anfrage zum Kundenportal? Nach der aufgelösten Route (nie nach dem rohen Pfad) – oder Pfad unter /portal. */
const istPortal = (event: Parameters<Handle>[0]['event']) =>
	event.route?.id?.startsWith(PORTAL_SEITE) === true || /^\/portal(\/|$)/i.test(event.url.pathname);

/**
 * Kundenportal mit Passwort (Jamil msg 3037): Ohne gültiges Portal-Cookie dieses Links gibt es nur die Portal-Seite
 * selbst (sie zeigt dann die Passwort-Abfrage) und das Anmelden. Alles andere unter /portal/<Token> – Dokumente, Logo,
 * AGB, Annahme/Ablehnung (Formular-Aktionen) und künftige Unterseiten – leitet zur Passwort-Abfrage um.
 *
 * Entscheidend ist die von SvelteKit AUFGELÖSTE Route (`event.route.id`, `event.params.token`), nicht der rohe Pfad:
 * kodierte Varianten (`/portal/%54oken…/agb`) landen auf derselben Route und damit hier. Zusätzlich werden Portal-Pfade
 * mit „%“ ganz abgelehnt (echte Tokens enthalten nur A–Z, a–z, 0–9, „-“ und „_“). Jede Portal-Route prüft
 * `locals.portalAngemeldet` außerdem selbst (Absicherung in der Tiefe).
 */
const pruefePortal: Handle = async ({ event, resolve }) => {
	// Das Portal ist öffentlich: nie mit einer Mitarbeiter-Sitzung (wer dort handelt, handelt als Kunde)
	event.locals.nutzer = null;
	event.locals.portalAngemeldet = false;
	const keinZugang = () => new Response('Nicht gefunden', { status: 404, headers: { 'cache-control': 'private, no-store' } });
	if (event.url.pathname.includes('%')) return keinZugang();
	const token = event.params.token;
	const routeId = event.route?.id ?? null;
	// Unbekannte Pfade unter /portal (keine Route): SvelteKit antwortet selbst mit 404
	if (!routeId) return resolve(event);
	if (!routeId.startsWith(PORTAL_SEITE) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return keinZugang();
	event.locals.portalAngemeldet = await sitzungGueltig(token, event.cookies.get(PORTAL_COOKIE), ipVon(event)).catch(() => false);
	if (event.locals.portalAngemeldet) return resolve(event);
	const lesend = event.request.method === 'GET' || event.request.method === 'HEAD';
	const formularAktion = !lesend && [...event.url.searchParams.keys()].some((k) => k.startsWith('/'));
	if ((routeId === PORTAL_SEITE && lesend && !formularAktion) || (routeId === PORTAL_ANMELDEN && event.request.method === 'POST')) return resolve(event);
	return new Response(null, { status: 303, headers: { location: `/portal/${token}`, 'cache-control': 'private, no-store' } });
};

export const handle: Handle = async (eingabe) => {
	const antwort = await (istPortal(eingabe.event) ? pruefePortal(eingabe) : pruefeZugang(eingabe));
	// Online-Buchung: die Seite (load) legt fest, wo sie eingebettet werden darf (CSP frame-ancestors)
	return mitSicherheitsKopfzeilen(antwort, eingabe.event.locals.einbettenErlaubt);
};
