import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff } from '$lib/server/angebote';
import { angebotLexwarePaket } from '$lib/server/lexware/export';

/**
 * Angebot im Lexware-Format (POST /v1/quotations) als JSON-Datei – nur zum Prüfen, ohne Verbindung zu Lexware.
 * Rechte wie alle Angebots-Endpunkte (angebote.bearbeiten + preise.sehen, Sicht auf das Angebot).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const paket = await angebotLexwarePaket(betriebKontext(locals), params.id, zg);
		const name = `Lexware_Angebot_${(paket.quelle.nummer ?? paket.quelle.id.slice(0, 8)).replace(/[^A-Za-z0-9-]/g, '_')}.json`;
		return new Response(JSON.stringify(paket, null, 2), {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${name}"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
