import { fail } from '@sveltejs/kit';

/**
 * Kleine, allgemeine Fehlerbehandlung für alle API-Endpunkte: Antworten sind immer `{ fehler: string }` auf Deutsch.
 * Unerwartete Fehler (z. B. SQL) werden nur im Server-Log festgehalten, nie an den Browser gegeben.
 */
export class ApiFehler extends Error {
	/**
	 * `extra` sind zusätzliche Felder für die Antwort (z. B. `{ tarifMit: [...] }`); der Schlüssel `fehler`
	 * gehört immer der Meldung und lässt sich damit nicht überschreiben.
	 */
	constructor(
		public readonly status: number,
		meldung: string,
		public readonly extra?: Record<string, unknown>
	) {
		super(meldung);
		this.name = 'ApiFehler';
	}
}

const json = (status: number, koerper: unknown) =>
	new Response(JSON.stringify(koerper), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});

/** Wandelt einen gefangenen Fehler in die passende Antwort um. */
export function alsAntwort(e: unknown): Response {
	if (e instanceof ApiFehler) return json(e.status, { ...e.extra, fehler: e.message });
	console.error('Unerwarteter Fehler in der API:', e);
	return json(500, { fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
}

/** `application/json`, Groß-/Kleinschreibung egal, Parameter (z. B. `; charset=utf-8`) erlaubt – aber nichts Ähnliches. */
const JSON_TYP = /^\s*application\/json\s*(;|$)/i;

/**
 * Liest den Anfragekörper als JSON-Objekt. Verlangt `Content-Type: application/json` (sonst 415): Ein fremdes
 * Formular im Browser kann keinen solchen Typ ohne Vorabfrage (CORS-Preflight) senden – das schließt einfache
 * Cross-Site-Anfragen aus. Kaputtes JSON, Listen, Zahlen und leere Körper sind ein 400.
 */
export async function leseJson(request: Request): Promise<Record<string, unknown>> {
	if (!JSON_TYP.test(request.headers.get('content-type') ?? '')) {
		throw new ApiFehler(415, 'Content-Type muss application/json sein');
	}
	let wert: unknown;
	try {
		wert = await request.json();
	} catch {
		throw new ApiFehler(400, 'Ungültige Anfrage.');
	}
	if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
		throw new ApiFehler(400, 'Ungültige Anfrage.');
	}
	return wert as Record<string, unknown>;
}

/** Für Formular-Aktionen der Seiten: `fail(status, { fehler })` statt JSON-Antwort, gleiche Regeln für unerwartete Fehler. */
export function alsFormFehler<T extends Record<string, unknown> = Record<never, never>>(e: unknown, zusatz?: T) {
	const basis = (zusatz ?? {}) as T;
	if (e instanceof ApiFehler) return fail(e.status, { ...basis, ...e.extra, fehler: e.message });
	console.error('Unerwarteter Fehler in einer Seitenaktion:', e);
	return fail(500, { ...basis, fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
}
