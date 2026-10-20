import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { bildArt, holeKachel, pruefeKachel, pruefeNutzerLimit } from '$lib/server/kacheln';

/**
 * Kartenkachel über den eigenen Server (Wunsch Jamil msg 2689) – nur angemeldet (kein offener Proxy), begrenzt je
 * Nutzer, mit Zwischenspeicher. Browser darf sie eine Woche behalten.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const k = betriebKontext(locals);
		const t = pruefeKachel(params.z, params.x, params.y);
		if (!t) throw new ApiFehler(404, 'Unbekannte Kachel.');
		pruefeNutzerLimit(k.benutzerId);
		const daten = await holeKachel(t.z, t.x, t.y);
		return new Response(new Uint8Array(daten), {
			headers: {
				'content-type': bildArt(daten) ?? 'image/png',
				'cache-control': 'private, max-age=604800',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
