import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff } from '$lib/server/angebote';
import { legeAngebotVorlageAn, listeAngebotVorlagen } from '$lib/server/angebot-vorlagen';

/**
 * Angebots-Vorlagen: `GET` (Liste), `POST { name, einleitung?, schluss?, positionen? }`. Rechte wie Angebote
 * (Modul `angebote`, `angebote.bearbeiten` + `preise.sehen` – Vorlagen enthalten Preise).
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await angeboteZugriff(locals);
		return json(await listeAngebotVorlagen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await angeboteZugriff(locals);
		return json(await legeAngebotVorlageAn(betriebKontext(locals), await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
