import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereAngebotKopf, angeboteZugriff, holeAngebot, loescheAngebot, speichereAngebot } from '$lib/server/angebote';

// Angebote unsichtbarer Aufträge (nur eigene Aufträge) sind überall ein 404.

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const zg = await angeboteZugriff(locals);
		return json(await holeAngebot(betriebKontext(locals), params.id, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};

/**
 * Editor: Kopf (`datum`, `gueltigBis`, `mwstSatz`, `einleitung`, `schluss`) und `positionen` in EINER Transaktion –
 * scheitert eine Position, bleibt auch der Kopf unverändert. Nur im Entwurf (sonst 409).
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		return json(await speichereAngebot(betriebKontext(locals), params.id, await leseJson(request), zg));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Nur den Kopf ändern – nur im Entwurf (sonst 409). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		return json(await aendereAngebotKopf(betriebKontext(locals), params.id, await leseJson(request), zg));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Nur Entwürfe lassen sich löschen (sonst 409). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const zg = await angeboteZugriff(locals);
		await loescheAngebot(betriebKontext(locals), params.id, zg);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
