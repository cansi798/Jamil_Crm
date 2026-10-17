import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf, darfEines } from '$lib/server/tarif';
import { holeVorlage, aendereVorlage, loescheVorlage } from '$lib/server/auftrag-vorlagen';

/** Vorlage mit To-dos lesen: `GET /api/auftrag-vorlagen/[id]`. */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darfEines(locals, 'auftraege', ['auftraege.lesen', 'auftraege.alle_lesen']);
		return json(await holeVorlage(betriebKontext(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Vorlage ändern (Recht `auftraege.bearbeiten`): `{ name?, beschreibung?, todos? }`. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		const e = await leseJson(request);
		return json(await aendereVorlage(betriebKontext(locals), params.id, e as any));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Vorlage löschen (Recht `auftraege.bearbeiten`). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		await loescheVorlage(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
