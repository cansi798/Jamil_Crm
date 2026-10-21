import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { angeboteZugriff, legeAngebotOhneAuftragAn, listeAngebote, MAX_ANGEBOTE } from '$lib/server/angebote';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { belegSeite } from '$lib/server/ausgangsbelege';
import { istAngebotStatus } from '$lib/angebot-status';
import { angebotsKennzahlen } from '$lib/server/kennzahlen';

/**
 * Ausgangsbelege → Angebote (Jamil msg 2948; früher /angebote): Angebotsliste mit Suche (`?suche=`), Status
 * (`?status=`, unbekannt → alle) und Kacheln (`?zeitraum=`). Rechte: angebote.bearbeiten + preise.sehen.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { k, sicht, z, suche, kennzahlenAn } = await belegSeite(locals, url);
	const roh = url.searchParams.get('status');
	const status = istAngebotStatus(roh) ? roh : null;
	return {
		// Kennzahl-Kacheln (Jamil msg 2803): Klick auf eine Status-Kachel filtert
		kennzahlen: kennzahlenAn ? await alsSeitenFehler(() => angebotsKennzahlen(k, sicht, z, true)) : null,
		zeitraum: z.art,
		status,
		suche,
		angebote: await alsSeitenFehler(() => listeAngebote(k, { status: status ?? undefined, suche }, {
			sicht,
			auftragAendern: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
		})),
		maxTreffer: MAX_ANGEBOTE,
		// „+ Angebot ohne Auftrag“ nur, wer solche Angebote danach auch sieht
		darfOhneAuftrag: hatRecht(locals.nutzer!, 'auftraege.alle_lesen')
	};
};

export const actions: Actions = {
	/** Neues Angebot ohne Auftrag (optional `kundeId`) → Editor. */
	neu: async ({ locals, request }) => {
		const kunde = (await request.formData()).get('kundeId');
		let id: string;
		try {
			const zg = await angeboteZugriff(locals);
			id = (await legeAngebotOhneAuftragAn(betriebKontext(locals), typeof kunde === 'string' ? kunde : null, zg)).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/angebote/${id}`);
	}
};
