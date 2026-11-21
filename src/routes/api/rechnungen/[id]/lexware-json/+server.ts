import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { rechnungenZugriff } from '$lib/server/rechnungen-zugriff';
import { rechnungLexwarePaket } from '$lib/server/lexware/export';

/** Rechnung im Lexware-Format (POST /v1/invoices) als JSON-Datei – nur zum Prüfen. Recht „Rechnungen sehen“ + „Preise sehen“. */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const z = await rechnungenZugriff(locals);
		if (!z.preise) throw new ApiFehler(403, 'Keine Berechtigung (Preise sehen).');
		const paket = await rechnungLexwarePaket(z.k, params.id);
		return new Response(JSON.stringify(paket, null, 2), {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="Lexware_Rechnung_${paket.quelle.id.slice(0, 8)}.json"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
