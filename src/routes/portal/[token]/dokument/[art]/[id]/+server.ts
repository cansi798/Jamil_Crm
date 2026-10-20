import { error } from '@sveltejs/kit';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { portalDokument } from '$lib/server/kundenportal-oeffentlich';
import { ipVon, OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';
import { ApiFehler } from '$lib/server/fehler';

/** Freigegebenes Dokument (Angebot als PDF, Datei, Auftragsbestätigung) – nur im Bereich des Portal-Links. */
export const GET: RequestHandler = async (event) => {
	try {
		const d = await portalDokument(event.params.token, event.params.art, event.params.id, ipVon(event));
		const name = d.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 120);
		return new Response(d.bytes as unknown as BodyInit, { headers: { ...OEFFENTLICHE_KOPFZEILEN, ...sichereDateiKopfzeilen(d.typ, { name }) } });
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
};
