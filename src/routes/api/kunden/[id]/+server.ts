import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { aendereKunde, holeKunde, loescheKunde } from '$lib/server/kunden';

// Fremde und unbekannte Kunden sind überall ein 404 (nie 403), damit die Existenz fremder Datensätze nicht verraten wird.

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		return json(await holeKunde(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Teiländerung: nur die angegebenen Felder ändern sich, das Ergebnis wird als Ganzes geprüft. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		const k = betriebKontext(locals);
		return json(await aendereKunde(k, params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Löscht den Kunden samt Objekten. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.bearbeiten');
		await loescheKunde(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
