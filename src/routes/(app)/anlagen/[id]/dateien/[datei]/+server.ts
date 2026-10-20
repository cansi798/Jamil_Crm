import type { RequestHandler } from './$types';
import { DATEI_CSP } from '$lib/server/datei-kopf';
import { alsAntwort } from '$lib/server/fehler';
import { holeAnlagenDatei } from '$lib/server/anlagen';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

/** Foto/Dokument einer Anlage herunterladen (`kunden.lesen`); immer als Anhang mit `nosniff`. Fremd → 404. */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		const d = await holeAnlagenDatei(betriebKontext(locals), params.id, params.datei);
		const ascii = d.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
		return new Response(Buffer.from(d.inhalt), {
			headers: {
				'content-type': d.typ,
				'content-length': String(d.inhalt.byteLength),
				'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,
				'x-content-type-options': 'nosniff',
				'content-security-policy': DATEI_CSP,
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
