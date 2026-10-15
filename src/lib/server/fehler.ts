import { fail } from '@sveltejs/kit';

/**
 * Kleine, allgemeine Fehlerbehandlung für alle API-Endpunkte: Antworten sind immer `{ fehler: string }` auf Deutsch.
 * Unerwartete Fehler (z. B. SQL) werden nur im Server-Log festgehalten, nie an den Browser gegeben.
 */
export class ApiFehler extends Error {
	constructor(
		public readonly status: number,
		meldung: string
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
	if (e instanceof ApiFehler) return json(e.status, { fehler: e.message });
	console.error('Unerwarteter Fehler in der API:', e);
	return json(500, { fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
}

/** Liest den Anfragekörper als JSON-Objekt; alles andere (kaputt, Liste, Zahl, leer) ist ein 400. */
export async function leseJson(request: Request): Promise<Record<string, unknown>> {
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
	if (e instanceof ApiFehler) return fail(e.status, { ...basis, fehler: e.message });
	console.error('Unerwarteter Fehler in einer Seitenaktion:', e);
	return fail(500, { ...basis, fehler: 'Interner Fehler. Bitte später erneut versuchen.' });
}
