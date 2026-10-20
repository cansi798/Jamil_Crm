import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { FOTO_MAX_BYTES, speichereFoto } from '$lib/server/protokoll-formulare';
import { zugriffAusfuellen } from '$lib/server/protokoll-zugriff';

/**
 * Foto hochladen: `POST ?feld=<Feld-ID>&name=<Dateiname>`, Körper = Bild (`Content-Type: image/jpeg` oder
 * `image/png` – ein fremdes Formular kann diesen Typ nicht ohne Vorabfrage senden). Der Assistent verkleinert Fotos
 * vorher im Browser.
 */
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		const typ = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (typ !== 'image/jpeg' && typ !== 'image/png') throw new ApiFehler(415, 'Bitte ein Foto (JPEG oder PNG) senden.');
		if (Number(request.headers.get('content-length') ?? '0') > FOTO_MAX_BYTES) throw new ApiFehler(413, 'Das Foto ist zu groß (höchstens 10 MB).');
		const inhalt = new Uint8Array(await request.arrayBuffer());
		const erg = await speichereFoto(k, sicht, params.id, url.searchParams.get('feld'), { name: url.searchParams.get('name') ?? 'foto.jpg', inhalt });
		return json(erg, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
