import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { holeNachweisDatei, partnerZugriff } from '$lib/server/partner';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';

/** Datei eines Nachweises (nur „Partner verwalten“); sichere Kopfzeilen wie bei allen Dateien. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const d = await holeNachweisDatei(await partnerZugriff(locals), params.id, params.nid);
		return new Response(d.inhalt as BodyInit, { headers: sichereDateiKopfzeilen(d.typ, { name: d.name, art: url.searchParams.get('download') ? 'attachment' : 'inline' }) });
	} catch (e) {
		return alsAntwort(e);
	}
};
