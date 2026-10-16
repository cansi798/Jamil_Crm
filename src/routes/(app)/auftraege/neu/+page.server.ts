import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { AUFTRAG_FELDER, ladeKundenAuswahl, legeAuftragAn } from '$lib/server/auftraege';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

/** Neuer Auftrag; mit `?kunde=<id>` (Link vom Kunden) ist der Kunde samt seinen Objekten schon gewählt. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'auftraege.bearbeiten');
	return {
		...(await ladeKundenAuswahl(k, url.searchParams.get('kunde'))),
		kundenSuche: hatRecht(locals.nutzer!, 'kunden.lesen')
	};
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), AUFTRAG_FELDER);
		let id: string;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			id = (await legeAuftragAn(betriebKontext(locals), werte)).id;
		} catch (e) {
			// Kunde/Objekte für das erneut angezeigte Formular – nur für Berechtigte (verrät sonst Kundendaten)
			const auswahl =
				locals.nutzer?.betriebId && hatRecht(locals.nutzer, 'auftraege.bearbeiten')
					? await ladeKundenAuswahl(betriebKontext(locals), werte.kundeId).catch(() => null)
					: null;
			return alsFormFehler(e, { werte, auswahl });
		}
		redirect(303, `/auftraege/${id}`);
	}
};
