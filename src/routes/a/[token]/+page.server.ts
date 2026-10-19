import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { anlagePerQr } from '$lib/server/anlagen';
import { hatRecht } from '$lib/server/rechte';

/**
 * QR-Code einer Anlage (`/a/<Kürzel>`, Wünsche Jamil msgs 2503/2505).
 *
 * Angemeldete Mitarbeiter desselben Betriebs mit „Kunden ansehen“ landen direkt auf der Anlage mit Verlauf. Alle
 * anderen (nicht angemeldet, anderer Betrieb) sehen nur eine Platzhalter-Seite „Störung melden“ mit dem Anlagentyp und
 * dem Kontakt des Betriebs – keine Kunden-, Objekt- oder Anlagendaten, keine IDs. Unbekanntes Kürzel → 404.
 */
export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
	const treffer = await anlagePerQr(params.token);
	if (!treffer) return { gefunden: false as const, angemeldet: !!locals.nutzer };
	const n = locals.nutzer;
	if (n && n.betriebId === treffer.betriebId && hatRecht(n, 'kunden.lesen')) {
		redirect(303, `/anlagen/${treffer.anlageId}`);
	}
	return { gefunden: true as const, angemeldet: !!n, typName: treffer.typName, kontakt: treffer.kontakt };
};
