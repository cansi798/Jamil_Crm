import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { holeAnlage } from '$lib/server/anlagen';
import { ETIKETTEN_PRO_BOGEN, etikettenAntwort } from '$lib/server/etiketten';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

/** QR-Etikett einer Anlage: einzeln (90 × 50 mm) oder `?format=bogen` (A4, 24 gleiche Etiketten). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		const k = betriebKontext(locals);
		const a = await holeAnlage(k, params.id);
		const bogen = url.searchParams.get('format') === 'bogen';
		return await etikettenAntwort(k, url.origin, [a], bogen ? 'bogen' : 'einzel', bogen ? 'etiketten-bogen.pdf' : 'etikett.pdf', bogen ? ETIKETTEN_PRO_BOGEN : 1);
	} catch (e) {
		return alsAntwort(e);
	}
};
