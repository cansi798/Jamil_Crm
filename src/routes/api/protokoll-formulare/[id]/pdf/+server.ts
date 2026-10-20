import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { dateiKopf } from '$lib/server/dokumentation-zugriff';
import { protokollPdf } from '$lib/server/protokoll-formulare';
import { zugriffLesen } from '$lib/server/protokoll-zugriff';

/** PDF: abgeschlossen = das abgelegte PDF, Entwurf = Vorschau (mit „ENTWURF“). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const { k, sicht } = await zugriffLesen(locals);
		const { pdf, name } = await protokollPdf(k, sicht, params.id);
		return new Response(Buffer.from(pdf), {
			headers: {
				'content-type': 'application/pdf',
				'content-length': String(pdf.byteLength),
				'content-disposition': dateiKopf(url.searchParams.has('download') ? 'attachment' : 'inline', name),
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
