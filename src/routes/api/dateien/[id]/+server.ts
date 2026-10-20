import type { RequestHandler } from './$types';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { liesDatei, loescheDatei } from '$lib/server/dateien';
import { zugriffEintrag } from '$lib/server/dokumentation-zugriff';

/**
 * Einzelne Datei: `GET` (Anzeige/Download; Aufträge lesen, Auftrag sichtbar), `DELETE` (`auftraege.bearbeiten`).
 * Immer mit `nosniff` und sicherem Dateinamen im Kopf.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'dateien', false);
		const datei = await liesDatei(k, id);
		if (!datei) throw new ApiFehler(404, 'Datei nicht gefunden.');
		return new Response(Buffer.from(datei.inhalt), {
			headers: {
				...sichereDateiKopfzeilen(datei.typ, { name: datei.name }),
				'content-length': String(datei.inhalt.length),
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, id } = await zugriffEintrag(locals, params.id, 'dateien', true);
		await loescheDatei(k, id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return alsAntwort(e);
	}
};
