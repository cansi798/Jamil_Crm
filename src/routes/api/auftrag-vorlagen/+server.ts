import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf, darfEines } from '$lib/server/tarif';
import { listeVorlagen, legeVorlageAn } from '$lib/server/auftrag-vorlagen';

/**
 * Auftrags-Aufgaben-Vorlagen auflisten: `GET /api/auftrag-vorlagen` – alle Vorlagen des Betriebs.
 * Lesen: Modul `auftraege` + `auftraege.lesen`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await darfEines(locals, 'auftraege', ['auftraege.lesen', 'auftraege.alle_lesen']);
		return json(await listeVorlagen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neue Vorlage (Recht `auftraege.bearbeiten`): `{ name, beschreibung?, todos? }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		const e = await leseJson(request);
		return json(await legeVorlageAn(betriebKontext(locals), e as any), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
