import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { benachrichtigungen, markiereGelesen } from '$lib/server/erinnerungen';

/**
 * Benachrichtigungen der App-Glocke (Wunsch Jamil msg 2679) – nur die eigenen des angemeldeten Nutzers.
 * `GET` → `{ ungelesen, liste }`; `POST { id? }` → eine bzw. alle als gelesen markieren.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json(await benachrichtigungen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const k = betriebKontext(locals);
		const koerper = (await leseJson(request)) as Record<string, unknown>;
		await markiereGelesen(k, koerper.id);
		return json(await benachrichtigungen(k));
	} catch (e) {
		return alsAntwort(e);
	}
};
