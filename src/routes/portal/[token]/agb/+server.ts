import { error } from '@sveltejs/kit';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { portalAgb } from '$lib/server/kundenportal-oeffentlich';
import { ipVon, OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';
import { pruefePortalSitzung } from '$lib/server/portal-zugang';

/** AGB des Betriebs als PDF (msg 3030) – nur mit gültigem Portal-Link (wie die freigegebenen Dokumente). */
export const GET: RequestHandler = async (event) => {
	try {
		pruefePortalSitzung(event.locals);
		const d = await portalAgb(event.params.token, ipVon(event));
		return new Response(d.bytes as unknown as BodyInit, { headers: { ...OEFFENTLICHE_KOPFZEILEN, ...sichereDateiKopfzeilen('application/pdf', { name: 'AGB.pdf' }) } });
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
};
