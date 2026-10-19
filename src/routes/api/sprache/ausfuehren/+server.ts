import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { fuehreAus } from '$lib/server/sprache/ausfuehren';

/**
 * Bestätigte Sprachaktion speichern („Ja, speichern“): `POST /api/sprache/ausfuehren` mit
 * `{ vorschlag, auswahl? }` – `vorschlag` genau so, wie ihn `/api/sprache` bzw. `/api/sprache/text` geliefert hat,
 * `auswahl` = gewählte Option je offener Frage (`{ kunde: "<id>" }`). Antwort `{ meldung, link, warnungen }`
 * (201 angelegt, 200 geändert). 400 ungültig/abgelaufen, 403 fremder Vorschlag oder fehlende Berechtigung,
 * 409 schon gespeichert.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const koerper = await leseJson(request);
		const { status, ...ergebnis } = await fuehreAus(locals, koerper.vorschlag, koerper.auswahl);
		return json(ergebnis, { status });
	} catch (e) {
		return alsAntwort(e);
	}
};
