import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { listeAnlagen } from '$lib/server/anlagen';
import { etikettenAntwort } from '$lib/server/etiketten';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

/** A4-Bogen mit je einem QR-Etikett für alle Anlagen des Objekts. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		await darf(locals, 'kunden', 'kunden.lesen');
		const k = betriebKontext(locals);
		const anlagen = await listeAnlagen(k, params.id, params.objektId);
		if (anlagen.length === 0) throw new ApiFehler(404, 'Dieses Objekt hat noch keine Anlagen.');
		return await etikettenAntwort(k, url.origin, anlagen, 'bogen', 'anlagen-etiketten.pdf');
	} catch (e) {
		return alsAntwort(e);
	}
};
