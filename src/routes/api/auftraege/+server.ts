import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { auftragsSicht, legeAuftragAn, listeAuftraege, pruefeStatus } from '$lib/server/auftraege';
import { UUID } from '$lib/server/kunden';

/**
 * Aufträge auflisten: `GET /api/auftraege?status=&kunde=&suche=` – neueste zuerst, höchstens 100. Lesen: Modul
 * `auftraege` + `auftraege.alle_lesen` (alle) oder `auftraege.lesen` (nur eigene: mit Einsatz oder zugewiesenem To-do).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const sicht = await auftragsSicht(locals);
		const status = url.searchParams.get('status');
		const kunde = url.searchParams.get('kunde');
		if (kunde && !UUID.test(kunde)) throw new ApiFehler(400, 'Ungültiger Kunde.');
		return json(
			await listeAuftraege(betriebKontext(locals), sicht, {
				status: status ? pruefeStatus(status) : undefined,
				kundeId: kunde || undefined,
				suche: url.searchParams.get('suche') ?? undefined
			})
		);
	} catch (e) {
		return alsAntwort(e);
	}
};

/** Neuer Auftrag (Recht `auftraege.bearbeiten`): `{ titel, kundeId, objektId?, beschreibung?, geplantAb? }`, Status „Anfrage“. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await darf(locals, 'auftraege', 'auftraege.bearbeiten');
		return json(await legeAuftragAn(betriebKontext(locals), await leseJson(request)), { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
