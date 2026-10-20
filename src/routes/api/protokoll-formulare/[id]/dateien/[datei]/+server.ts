import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { holeProtokollDatei, loescheProtokollDatei } from '$lib/server/protokoll-formulare';
import { zugriffAusfuellen, zugriffLesen } from '$lib/server/protokoll-zugriff';

/** Foto/Unterschrift anzeigen (`GET`, privat, nicht zwischengespeichert) bzw. im Entwurf entfernen (`DELETE`). */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, sicht } = await zugriffLesen(locals);
		const d = await holeProtokollDatei(k, sicht, params.id, params.datei);
		return new Response(Buffer.from(d.inhalt), {
			headers: {
				'content-type': d.typ,
				'content-length': String(d.inhalt.byteLength),
				'cache-control': 'private, max-age=3600',
				'content-disposition': 'inline'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		return json({ antworten: await loescheProtokollDatei(k, sicht, params.id, params.datei) });
	} catch (e) {
		return alsAntwort(e);
	}
};
