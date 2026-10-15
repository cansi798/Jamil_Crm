import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { legeBetriebAn, listeBetriebe, pruefeAdmin } from '$lib/server/admin';

/**
 * Plattform-Verwaltung: `GET /api/admin/betriebe` → `{ betriebe }` (nur Verwaltungsdaten);
 * `POST` `{ name, tarif, chefEmail, chefName }` → 201 `{ link }` – Einladungslink für den Chef, nur in dieser Antwort.
 * Es wird keine E-Mail verschickt. Wer kein Plattform-Admin ist, bekommt 404.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const admin = pruefeAdmin(locals);
		return json({ betriebe: await listeBetriebe(admin.id) });
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		const admin = pruefeAdmin(locals);
		const k = await leseJson(request);
		const token = await legeBetriebAn(admin.id, {
			name: k.name,
			tarif: k.tarif,
			chefEmail: k.chefEmail,
			chefName: k.chefName
		});
		return json({ link: `${url.origin}/einladung/${token}` }, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
