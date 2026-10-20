import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { speichereUnterschrift, UNTERSCHRIFT_MAX_BYTES } from '$lib/server/protokoll-formulare';
import { zugriffAusfuellen } from '$lib/server/protokoll-zugriff';

/** Unterschrift: `POST ?feld=<Feld-ID>&name=<Name>`, Körper = PNG (`Content-Type: image/png`, max. 500 KB). */
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'image/png') {
			throw new ApiFehler(415, 'Die Unterschrift muss als PNG gesendet werden.');
		}
		if (Number(request.headers.get('content-length') ?? '0') > UNTERSCHRIFT_MAX_BYTES) throw new ApiFehler(413, 'Die Unterschrift ist zu groß.');
		const png = new Uint8Array(await request.arrayBuffer());
		const antworten = await speichereUnterschrift(k, sicht, params.id, url.searchParams.get('feld'), png, url.searchParams.get('name'));
		return json({ antworten }, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};
