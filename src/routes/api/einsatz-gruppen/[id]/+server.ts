import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { aendereGruppenEnde, darfPlanen, loescheGruppe, verschiebeGruppe } from '$lib/server/plantafel';

/** Gruppe ändern: `{ tage }` verschiebt um so viele Tage, `{ bisTag }` setzt den letzten Tag (verlängern/kürzen). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darfPlanen(locals);
		const e = (await leseJson(request)) as Record<string, unknown>;
		const k = betriebKontext(locals);
		if (typeof e.tage === 'number') return json(await verschiebeGruppe(k, params.id, e.tage));
		if (typeof e.bisTag === 'string') return json(await aendereGruppenEnde(k, params.id, e.bisTag));
		throw new ApiFehler(400, 'Bitte „tage“ oder „bisTag“ angeben.');
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darfPlanen(locals);
		await loescheGruppe(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
