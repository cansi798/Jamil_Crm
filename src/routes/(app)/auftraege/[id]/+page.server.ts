import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeAuftrag, loescheAuftrag, pruefeStatus, setzeStatus, sichtVon } from '$lib/server/auftraege';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { verlaufZeile } from '$lib/verlauf';

/** Auftrag mit Statuskette und Verlauf. Nicht sichtbare (fremde/unbekannte) Aufträge: 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const auftrag = await holeAuftrag(k, sichtVon(nutzer), params.id);
		const protokoll = await liesProtokoll(k, { tabelle: 'auftraege', datensatz: auftrag.id, vor: null });
		return {
			auftrag,
			verlauf: protokoll.eintraege.map(verlaufZeile),
			verlaufGekuerzt: protokoll.naechsteVor !== null,
			darfBearbeiten: hatRecht(nutzer, 'auftraege.bearbeiten'),
			kundeLesbar: hatRecht(nutzer, 'kunden.lesen')
		};
	});
};

export const actions: Actions = {
	/** Ein Schritt vor oder zurück in der Statuskette (Formularfeld `status` = Zielstatus). */
	status: async ({ locals, params, request }) => {
		const form = await request.formData();
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await setzeStatus(betriebKontext(locals), params.id, pruefeStatus(form.get('status')));
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftraege/${params.id}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await loescheAuftrag(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/auftraege');
	}
};
