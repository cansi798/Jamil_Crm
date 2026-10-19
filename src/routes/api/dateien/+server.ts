import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { speichereDatei, dateienFuerAuftrag } from '$lib/server/dateien';
import { zugriffAuftrag } from '$lib/server/dokumentation-zugriff';

/**
 * Dateien eines Auftrags: `GET /api/dateien?auftragId=...` (Liste ohne Inhalt; Aufträge lesen, Auftrag sichtbar),
 * `POST` (multipart: auftragId + datei; `auftraege.bearbeiten`). Unsichtbare/fremde Aufträge → 404.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const { k, auftrag } = await zugriffAuftrag(locals, url.searchParams.get('auftragId'), 'dateien', false);
		return json(await dateienFuerAuftrag(k, auftrag.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const form = await request.formData();
		const { k, auftrag } = await zugriffAuftrag(locals, form.get('auftragId'), 'dateien', true);
		const datei = form.get('datei');
		if (!(datei instanceof File) || datei.size === 0) throw new ApiFehler(400, 'Bitte eine Datei auswählen.');
		const beschreibung = form.get('beschreibung');
		const erg = await speichereDatei(
			k,
			auftrag.id,
			datei.name,
			datei.type,
			datei.size,
			Buffer.from(await datei.arrayBuffer()),
			typeof beschreibung === 'string' && beschreibung !== '' ? beschreibung : undefined
		);
		return json(erg, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
