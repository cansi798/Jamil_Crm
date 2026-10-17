import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { liesDatei, loescheDatei } from '$lib/server/dateien';

/**
 * Einzelne Datei: `GET /api/dateien/[id]` (Download), `DELETE` (Löschen).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const datei = await liesDatei(betriebKontext(locals), params.id);
		if (!datei) return new Response('Nicht gefunden', { status: 404 });
		return new Response(Buffer.from(datei.inhalt), {
			headers: {
				'content-type': datei.typ,
				'content-disposition': `inline; filename="${datei.name}"`,
				'content-length': String(datei.inhalt.length)
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await loescheDatei(betriebKontext(locals), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};