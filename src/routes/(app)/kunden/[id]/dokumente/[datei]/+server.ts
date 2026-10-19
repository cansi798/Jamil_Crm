import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { holeKundenDatei } from '$lib/server/kundenakte';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

/**
 * Dokument eines Kunden herunterladen (`kunden.lesen`, Modul `kunden`). Immer als Anhang mit `nosniff` – der Browser
 * zeigt nichts eingebettet an und rät keinen anderen Typ. Fremd/unbekannt → 404.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		const d = await holeKundenDatei(betriebKontext(locals), params.id, params.datei);
		const ascii = d.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
		return new Response(Buffer.from(d.inhalt), {
			headers: {
				'content-type': d.typ,
				'content-length': String(d.inhalt.byteLength),
				'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,
				'x-content-type-options': 'nosniff',
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
