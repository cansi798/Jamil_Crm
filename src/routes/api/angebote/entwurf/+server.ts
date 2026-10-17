import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler, leseJson } from '$lib/server/fehler';
import { entwirfAngebot, entwurfHinweise } from '$lib/server/ki/angebot-entwurf';

/**
 * KI-Angebotsentwurf: `POST /api/angebote/entwurf` mit JSON `{ auftragId, stichworte }` oder multipart
 * (`auftragId`, `stichworte`, optional `foto` JPEG/PNG ≤ 5 MB mit `zustimmung=ja`). Antwort 201
 * `{ angebotId, nummer, pruefen, verworfen, hinweise }` – ein Entwurf, Preise aus dem Katalog.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const typ = (request.headers.get('content-type') ?? '').toLowerCase();
		let auftragId: unknown;
		let stichworte: unknown;
		let foto: Uint8Array | null = null;
		let zustimmung = false;
		if (typ.startsWith('multipart/form-data')) {
			let form: FormData;
			try {
				form = await request.formData();
			} catch {
				throw new ApiFehler(400, 'Ungültige Anfrage.');
			}
			auftragId = form.get('auftragId');
			stichworte = form.get('stichworte') ?? '';
			zustimmung = form.get('zustimmung') === 'ja';
			const datei = form.get('foto');
			if (datei instanceof File && datei.size > 0) foto = new Uint8Array(await datei.arrayBuffer());
		} else {
			const koerper = await leseJson(request);
			auftragId = koerper.auftragId;
			stichworte = koerper.stichworte;
		}
		const e = await entwirfAngebot(locals, auftragId, { stichworte, foto, zustimmung });
		return json({ ...e, hinweise: entwurfHinweise(e) }, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
