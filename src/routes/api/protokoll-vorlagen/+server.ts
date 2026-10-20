import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { legeVorlageAn } from '$lib/server/protokoll-formulare';
import { zugriffVorlagen } from '$lib/server/protokoll-zugriff';

/** Neue Protokoll-Vorlage: `POST { name, beschreibung?, schema }` (`protokolle.vorlagen_bearbeiten`). */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const k = await zugriffVorlagen(locals);
		return json(await legeVorlageAn(k, await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
