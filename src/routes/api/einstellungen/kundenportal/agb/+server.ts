import type { RequestHandler } from './$types';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { holeAgbPdf, portalEinstellungsZugriff } from '$lib/server/kundenportal';

/** Das hinterlegte AGB-PDF ansehen (Einstellungen → Kundenportal, Recht `einstellungen`). */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const pdf = await holeAgbPdf(await portalEinstellungsZugriff(locals));
		if (!pdf) throw new ApiFehler(404, 'Keine AGB hinterlegt.');
		return new Response(pdf as BodyInit, {
			headers: { ...sichereDateiKopfzeilen('application/pdf', { name: 'AGB.pdf' }), 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' }
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
