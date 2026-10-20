import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { angeboteZugriff } from '$lib/server/angebote';
import { betriebKontext } from '$lib/server/rechte';
import { abPdf } from '$lib/server/auftragsbestaetigung';
import { holeAuftrag } from '$lib/server/auftraege';

/** Auftragsbestätigung als PDF (wie Angebote: „Angebote bearbeiten“ + „Preise sehen“; Auftrag muss sichtbar sein). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const k = betriebKontext(locals);
		const ab = await abPdf(k, params.id);
		if (ab.auftragId) await holeAuftrag(k, zg.sicht, ab.auftragId);
		const art = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
		return new Response(ab.pdf as unknown as BodyInit, {
			headers: { 'content-type': 'application/pdf', 'content-disposition': `${art}; filename="Auftragsbestaetigung_${ab.nummer}.pdf"`, 'cache-control': 'private, no-store' }
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
