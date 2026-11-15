import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { rechnungenZugriff } from '$lib/server/rechnungen-zugriff';
import { laufPdf } from '$lib/server/lexware/mahnungen';

/** Mahnungs-PDF aus Lexware (Zwischenspeicher). Recht „Rechnungen sehen“ + „Preise sehen“. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const z = await rechnungenZugriff(locals);
		if (!z.preise) throw new ApiFehler(403, 'Keine Berechtigung (Preise sehen).');
		const d = await laufPdf(z.k, params.id);
		if (!d) throw new ApiFehler(404, 'Zu dieser Mahnung gibt es kein PDF – bitte in Lexware öffnen.');
		const art = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
		return new Response(d.bytes as unknown as BodyInit, {
			headers: { 'content-type': 'application/pdf', 'content-disposition': `${art}; filename="${d.name}"`, 'cache-control': 'private, no-store' }
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
