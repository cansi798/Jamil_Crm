import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aenderePosition, deaktivierePosition, holePosition, katalogAendern, katalogLesen } from '$lib/server/katalog';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { mitPreisen } = await katalogLesen(locals);
		return json(await holePosition(betriebKontext(locals), params.id, mitPreisen));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Teiländerung; Preise (`lohn`, `material` in Euro) nur mit `preise.sehen`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { mitPreisen } = await katalogAendern(locals);
		return json(await aenderePosition(betriebKontext(locals), params.id, await leseJson(request), mitPreisen));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Löscht die Position – oder deaktiviert sie nur, wenn sie in einem Angebot verwendet ist: `{ ergebnis }`. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await katalogAendern(locals);
		return json({ ergebnis: await deaktivierePosition(betriebKontext(locals), params.id) });
	} catch (e) {
		return alsAntwort(e);
	}
};
