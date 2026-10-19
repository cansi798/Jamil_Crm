import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { aendereTodo, aendereTodoAls, holeTodo, loescheTodo } from '$lib/server/todos';
import { todoSicht, todoSichtVon } from '$lib/server/todos';

// Unsichtbare, fremde und unbekannte To-dos sind überall ein 404.

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const sicht = await todoSicht(locals);
		return json(await holeTodo(betriebKontext(locals), sicht, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/**
 * Ändern: mit `auftraege.bearbeiten` Titel, Zuständig, Fällig, erledigt; mit nur Leserecht darf der Zuständige sein
 * eigenes To-do abhaken bzw. öffnen (`{ erledigt: true|false }`) – jedes andere Feld → 403.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		if (locals.nutzer && hatRecht(locals.nutzer, 'auftraege.bearbeiten')) {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			const sicht = todoSichtVon(locals.nutzer);
			return json(await aendereTodo(betriebKontext(locals), params.id, await leseJson(request), sicht));
		}
		const sicht = await todoSicht(locals);
		const e = await leseJson(request);
		return json(await aendereTodoAls(betriebKontext(locals), sicht, false, params.id, e));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		await loescheTodo(betriebKontext(locals), params.id, todoSichtVon(locals.nutzer!));
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
