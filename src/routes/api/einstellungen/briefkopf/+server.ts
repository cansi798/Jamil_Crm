import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { holeProfil, speichereProfil } from '$lib/server/betriebsprofil';

/**
 * Briefkopf des Betriebs (Recht `einstellungen`): `GET` liefert das Profil ohne Logo-Bytes (mit `hatLogo`),
 * `PUT` ändert die angegebenen Felder (fehlende bleiben, leere werden gelöscht).
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		return json(await holeProfil(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		const k = betriebKontext(locals);
		return json(await speichereProfil(k, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};
