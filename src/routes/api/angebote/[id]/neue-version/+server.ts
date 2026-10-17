import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, neueVersion } from '$lib/server/angebote';

/** „Als neue Version bearbeiten“: neuer Entwurf mit Kopf und Positionen dieses Angebots (`vorgaengerId`). */
export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		await angeboteZugriff(locals);
		return json(await neueVersion(betriebKontext(locals), params.id), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
