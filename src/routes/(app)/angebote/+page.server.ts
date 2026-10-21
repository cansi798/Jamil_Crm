import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { angeboteZugriff, legeAngebotOhneAuftragAn, listeAngebote, MAX_ANGEBOTE } from '$lib/server/angebote';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istAngebotStatus } from '$lib/angebot-status';
import { angebotsKennzahlen, siehtKennzahlen } from '$lib/server/kennzahlen';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { istZeitraumArt, zeitraum } from '$lib/kennzahlen';
import { berlinTag } from '$lib/zeit';

/** Angebotsliste mit Status-Reitern (`?status=`, unbekannt → alle). Rechte: angebote.bearbeiten + preise.sehen. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	const roh = url.searchParams.get('status');
	const status = istAngebotStatus(roh) ? roh : null;
	// Kennzahl-Kacheln (Jamil msg 2803): Zeitraum `?zeitraum=`, Klick auf eine Status-Kachel filtert
	const zRoh = url.searchParams.get('zeitraum');
	const z = zeitraum(istZeitraumArt(zRoh) ? zRoh : 'monat', berlinTag(new Date()));
	const module = await moduleDesBetriebs(k);
	const kennzahlen = siehtKennzahlen(locals.nutzer!, module)
		? await alsSeitenFehler(() => angebotsKennzahlen(k, sichtVon(locals.nutzer!), z, true))
		: null;
	return {
		kennzahlen,
		zeitraum: z.art,
		status,
		angebote: await alsSeitenFehler(() => listeAngebote(k, { status: status ?? undefined }, {
			sicht: sichtVon(locals.nutzer!),
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
