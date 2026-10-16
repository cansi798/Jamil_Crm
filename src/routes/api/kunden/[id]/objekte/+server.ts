import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { legeObjektAn, listeObjekte } from '$lib/server/kunden';

/** Objekte (Baustellen/Einsatzorte) eines Kunden. Unbekannter oder fremder Kunde → 404. */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		return json(await listeObjekte(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neues Objekt: `{ bezeichnung, strasse?, plz?, ort?, notiz? }`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		const k = betriebKontext(locals);
		return json(await legeObjektAn(k, params.id, await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
