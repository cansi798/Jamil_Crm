import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { schliesseAb } from '$lib/server/leitfaden';

/** Leitfaden abschließen: `POST { opId, begruendung? }` – fehlen Pflichtschritte, nur mit Begründung (2b). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = betriebKontext(locals);
		const d = (await leseJson(request)) as Record<string, unknown>;
		return json(await schliesseAb(k, locals.nutzer!, params.einsatzId, { opId: d?.opId, begruendung: d?.begruendung }));
	} catch (e) {
		return alsAntwort(e);
	}
};
