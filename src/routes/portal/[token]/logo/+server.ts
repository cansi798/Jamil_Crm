import { error } from '@sveltejs/kit';
import { RASTERBILD, sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { portalLogo } from '$lib/server/kundenportal-oeffentlich';
import { ipVon, OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';

/** Logo des Betriebs für das Kundenportal. */
export const GET: RequestHandler = async (event) => {
	try {
		const logo = await portalLogo(event.params.token, ipVon(event));
		// Nur Rasterbilder (nie SVG/HTML vom App-Ursprung – gespeichertes XSS)
		if (!logo || !RASTERBILD.test(logo.typ)) error(404, 'Kein Logo');
		return new Response(logo.bytes as unknown as BodyInit, {
			headers: { ...OEFFENTLICHE_KOPFZEILEN, ...sichereDateiKopfzeilen(logo.typ), 'cache-control': 'private, max-age=3600' }
		});
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
};
