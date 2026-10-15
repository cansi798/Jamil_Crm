import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { listeBenutzer } from '$lib/server/benutzer';

/** Alle Benutzer des Betriebs mit Rolle (ohne Passwort- oder 2FA-Daten). */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'benutzer.verwalten');
		return json(await listeBenutzer(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};
