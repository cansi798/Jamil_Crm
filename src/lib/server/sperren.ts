import * as devalue from 'devalue';

/**
 * Antworten, mit denen `src/hooks.server.ts` Anfragen abweist, bevor eine Route läuft. Jede Antwort passt zu dem,
 * der fragt: API-Clients bekommen JSON, Formulare mit `use:enhance` ein ActionResult (die Seite zeigt die Meldung
 * wie jeden anderen Formularfehler in `form.fehler`), Formulare ohne JavaScript eine kleine deutsche HTML-Seite.
 */

const NUR_LESEN_API = 'Nur Lesezugriff';
const NUR_LESEN_TEXT =
	'Nur Lesezugriff: Das Abo dieses Betriebs ist abgelaufen. Daten können angesehen, aber nicht geändert werden.';
const NICHT_GEFUNDEN = 'Nicht gefunden.';

const istApi = (pfad: string) => pfad === '/api' || pfad.startsWith('/api/');

/** Kommt die Anfrage von `use:enhance` (SvelteKit setzt dann diesen Header)? */
const istEnhance = (request: Request) => request.headers.get('x-sveltekit-action') === 'true';

const json = (status: number, koerper: unknown) =>
	new Response(JSON.stringify(koerper), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});

const html = (status: number, titel: string, text: string) =>
	new Response(
		`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" ` +
			`content="width=device-width, initial-scale=1"><title>${titel}</title></head>` +
			`<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">` +
			`<h1 style="font-size:1.4rem">${titel}</h1><p>${text}</p>` +
			`<p><a href="/" style="color:#05346b">Zur Startseite</a></p></body></html>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

/** 403 für Schreibanfragen bei Nur-Lesezugriff (Abo überfällig/gekündigt). */
export function nurLesenAntwort(request: Request): Response {
	const pfad = new URL(request.url).pathname;
	if (istApi(pfad)) return json(403, { fehler: NUR_LESEN_API });
	if (istEnhance(request)) {
		// Format eines ActionResult (wie `fail(403, { fehler })` aus einer Formular-Aktion)
		return json(403, { type: 'failure', status: 403, data: devalue.stringify({ fehler: NUR_LESEN_TEXT }) });
	}
	return html(403, 'Nur Lesezugriff', NUR_LESEN_TEXT);
}

/** Bereich der Plattform-Verwaltung (Seiten und API). */
export function istAdminPfad(pfad: string): boolean {
	return pfad === '/admin' || pfad.startsWith('/admin/') || pfad === '/api/admin' || pfad.startsWith('/api/admin/');
}

/** 404 – den Admin-Bereich gibt es für Nicht-Admins nicht (verrät auch nicht, dass er existiert). */
export function nichtGefundenAntwort(pfad: string): Response {
	if (istApi(pfad)) return json(404, { fehler: NICHT_GEFUNDEN });
	return new Response(NICHT_GEFUNDEN, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
