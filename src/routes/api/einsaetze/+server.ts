import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfPlanen, legeEinsatzAn } from '$lib/server/plantafel';

/**
 * Neuer Einsatz (Recht `plantafel.bearbeiten`): `{ auftragId, benutzerId, beginn, ende, notiz? }` mit ISO-Zeitpunkten.
 * Antwort 201 mit `warnungen` (Doppelbelegung, Urlaub, Krankheit) – gespeichert wird trotzdem.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darfPlanen(locals);
		return json(await legeEinsatzAn(betriebKontext(locals), await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
