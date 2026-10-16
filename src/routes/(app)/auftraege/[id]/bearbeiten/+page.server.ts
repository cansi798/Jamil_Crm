import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aendereAuftrag, AUFTRAG_FELDER, holeAuftrag, ladeKundenAuswahl, sichtVon } from '$lib/server/auftraege';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'auftraege.bearbeiten');
	const nutzer = locals.nutzer!;
	const auftrag = await alsSeitenFehler(() => holeAuftrag(k, { ...sichtVon(nutzer), alle: true }, params.id));
	return {
		auftrag,
		...(await ladeKundenAuswahl(k, auftrag.kundeId)),
		kundenSuche: hatRecht(nutzer, 'kunden.lesen')
	};
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), AUFTRAG_FELDER);
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await aendereAuftrag(betriebKontext(locals), params.id, werte);
		} catch (e) {
			// Kunde/Objekte für das erneut angezeigte Formular – nur für Berechtigte (verrät sonst Kundendaten)
			const auswahl =
				locals.nutzer?.betriebId && hatRecht(locals.nutzer, 'auftraege.bearbeiten')
					? await ladeKundenAuswahl(betriebKontext(locals), werte.kundeId).catch(() => null)
					: null;
			return alsFormFehler(e, { werte, auswahl });
		}
		redirect(303, `/auftraege/${params.id}`);
	}
};
