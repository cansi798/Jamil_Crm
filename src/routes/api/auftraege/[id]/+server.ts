import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { aendereAuftrag, auftragsSicht, holeAuftrag, loescheAuftrag, sichtVon } from '$lib/server/auftraege';

// Fremde, unsichtbare und unbekannte Aufträge sind überall ein 404 (nie 403) – auch beim Ändern und Löschen.

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const sicht = await auftragsSicht(locals);
		return json(await holeAuftrag(betriebKontext(locals), sicht, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Teiländerung (Titel, Kunde, Objekt, Beschreibung, Geplant ab); der Status ändert sich nur über `/status`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		const sicht = sichtVon(locals.nutzer!);
		return json(await aendereAuftrag(betriebKontext(locals), params.id, await leseJson(request), sicht));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Löscht den Auftrag samt Aufgaben – nur im Status „Anfrage“ (sonst 409). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		await loescheAuftrag(betriebKontext(locals), params.id, sichtVon(locals.nutzer!));
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
