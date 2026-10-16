import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { ladeEin, listeEinladungen } from '$lib/server/benutzer';

/** Offene Einladungen des Betriebs (ohne Token). */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'benutzer.verwalten');
		return json(await listeEinladungen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/**
 * Neue Einladung `{ email, rolleId }` → `{ link }` (7 Tage gültig, nur einmal verwendbar). Es wird keine E-Mail
 * verschickt: Der Link wird angezeigt und vom Verwalter selbst weitergegeben.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		pruefeRecht(locals, 'benutzer.verwalten');
		const k = betriebKontext(locals);
		const { token } = await ladeEin(k, locals.nutzer!.rechte, await leseJson(request));
		return json({ link: `${url.origin}/einladung/${token}` }, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
