import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { istTodoAuswahl, legeTodoAn, listeTodos } from '$lib/server/todos';
import { todoSicht, todoSichtVon } from '$lib/server/todos';

/**
 * To-dos: `GET /api/todos?nur=meine|offen|alle&auftrag=<id>` (Standard: alle sichtbaren). Lesen: Modul `auftraege` +
 * `auftraege.alle_lesen` (alle) oder `auftraege.lesen` (eigene und die in eigenen Aufträgen).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const sicht = await todoSicht(locals);
		const nur = url.searchParams.get('nur') ?? 'alle';
		if (!istTodoAuswahl(nur)) throw new ApiFehler(400, 'Unbekannte Auswahl.');
		const auftrag = url.searchParams.get('auftrag');
		return json(await listeTodos(betriebKontext(locals), sicht, { nur, auftragId: auftrag ?? undefined }));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neues To-do (Recht `auftraege.bearbeiten`): `{ titel, auftragId?, zustaendigId?, faellig? }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		const sicht = todoSichtVon(locals.nutzer!);
		return json(await legeTodoAn(betriebKontext(locals), await leseJson(request), sicht), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
