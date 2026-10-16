import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { legeKundeAn, listeKunden } from '$lib/server/kunden';

/**
 * Kunden suchen/auflisten: `GET /api/kunden?suche=text` – höchstens 50 Treffer, nach Name sortiert. Jedes Wort der
 * Suche muss in Firma, Vorname, Nachname, Ort, Telefon oder E-Mail vorkommen (ohne Beachtung der Groß-/Kleinschreibung).
 * Lesen: Modul `kunden` + Recht `kunden.lesen`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		return json(await listeKunden(betriebKontext(locals), url.searchParams.get('suche')));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neuer Kunde (Recht `kunden.bearbeiten`): `{ art: 'privat'|'firma', … }`, Privat braucht Nachname, Firma den Firmennamen. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		const k = betriebKontext(locals);
		return json(await legeKundeAn(k, await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
