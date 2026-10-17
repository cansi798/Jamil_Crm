import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { speichereDatei, dateienFuerAuftrag } from '$lib/server/dateien';

/**
 * Dateien: `GET /api/dateien?auftragId=...` (Liste ohne Inhalt), `POST` (multipart: auftragId + datei).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const auftragId = url.searchParams.get('auftragId');
		if (!auftragId) return json({ fehler: 'auftragId fehlt' }, { status: 400 });
		return json(await dateienFuerAuftrag(betriebKontext(locals), auftragId));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const form = await request.formData();
		const auftragId = form.get('auftragId') as string;
		const datei = form.get('datei') as File;
		if (!auftragId || !datei) return json({ fehler: 'auftragId und datei sind Pflicht' }, { status: 400 });
		const inhalt = Buffer.from(await datei.arrayBuffer());
		const erg = await speichereDatei(
			betriebKontext(locals),
			auftragId,
			datei.name,
			datei.type,
			datei.size,
			inhalt,
			form.get('beschreibung') as string | undefined
		);
		return json(erg, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};