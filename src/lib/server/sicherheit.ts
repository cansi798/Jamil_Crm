/**
 * Grundschutz-Kopfzeilen für JEDE Antwort, die durch `hooks.server.ts` läuft (Seiten, API, Weiterleitungen und die
 * Sperr-Antworten aus `sperren.ts`). Die Content-Security-Policy der Seiten kommt aus `kit.csp` in
 * `svelte.config.js` (dort mit Nonce für SvelteKits eigene Inline-Skripte); hier steht, was für alle Antworten gilt:
 *
 * - `X-Content-Type-Options: nosniff` – der Browser rät keinen anderen Inhaltstyp (wichtig für JSON der API),
 * - `Referrer-Policy: same-origin` – Adressen gehen nie an fremde Seiten; eine strengere Regel einer Route
 *   (`no-referrer` auf `/einladung/…`, der Link enthält ein Geheimnis) bleibt erhalten,
 * - `X-Frame-Options: DENY` – kein Einbetten in fremde Seiten (ergänzt `frame-ancestors 'none'` der CSP, auch für
 *   Antworten ohne CSP wie JSON und ältere Browser),
 * - `Permissions-Policy` – Kamera, Standort, Bezahlen, USB sind abgeschaltet (die App braucht sie nicht); das Mikrofon
 *   nur für die eigene Seite (Sprachsteuerung, Stufe 1d), nie für eingebettete fremde Inhalte.
 */
export const SICHERHEITS_KOPFZEILEN: Readonly<Record<string, string>> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()'
};

/** Kopfzeilen, die eine Route selbst strenger setzen darf (vorhandener Wert bleibt). */
const NICHT_UEBERSCHREIBEN = new Set(['referrer-policy']);

function setze(kopf: Headers): void {
	for (const [name, wert] of Object.entries(SICHERHEITS_KOPFZEILEN)) {
		if (NICHT_UEBERSCHREIBEN.has(name) && kopf.has(name)) continue;
		kopf.set(name, wert);
	}
}

/** Ergänzt die Grundschutz-Kopfzeilen. Sind die Kopfzeilen unveränderlich, wird die Antwort kopiert. */
export function mitSicherheitsKopfzeilen(antwort: Response): Response {
	try {
		setze(antwort.headers);
		return antwort;
	} catch {
		const kopie = new Response(antwort.body, {
			status: antwort.status,
			statusText: antwort.statusText,
			headers: new Headers(antwort.headers)
		});
		setze(kopie.headers);
		return kopie;
	}
}
