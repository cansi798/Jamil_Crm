import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import { rechnungenZugriff } from '$lib/server/rechnungen-zugriff';
import { rechnungPdf } from '$lib/server/lexware/rechnungen';

/** Rechnungs-PDF aus Lexware (Zwischenspeicher, sonst frisch geholt). Recht „Rechnungen sehen“ + „Preise sehen“. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const z = await rechnungenZugriff(locals);
		if (!z.preise) throw new ApiFehler(403, 'Keine Berechtigung (Preise sehen).');
		const d = await rechnungPdf(z.k, params.id);
		const art = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
		// Dateiname über den gemeinsamen Helfer (Umlaute/Anführungszeichen können die Kopfzeile nicht brechen)
		return new Response(d.bytes as unknown as BodyInit, {
			headers: { ...sichereDateiKopfzeilen('application/pdf', { name: d.name, art }), 'cache-control': 'private, no-store' }
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
