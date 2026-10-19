import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { AUFTRAG_FELDER, ladeKundenAuswahl, legeAuftragAn } from '$lib/server/auftraege';
import { listeVorlagen } from '$lib/server/auftrag-vorlagen';
import { legeTodosAn, pruefeTodoListe, todosAusFormular } from '$lib/server/todos';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { formWerte, seitenZugriff, vorbelegung } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

/** Neuer Auftrag; mit `?kunde=<id>` (Link vom Kunden) ist der Kunde samt seinen Objekten schon gewählt. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'auftraege.bearbeiten');
	const vorlagen = await listeVorlagen(k);
	return {
		...(await ladeKundenAuswahl(k, url.searchParams.get('kunde'))),
		kundenSuche: hatRecht(locals.nutzer!, 'kunden.lesen'),
		vorlagen,
		// Titel/Start/Beschreibung vorbelegt (z. B. „Ändern“ auf der Bestätigungskarte der Sprachsteuerung)
		vorbelegt: vorbelegung(url, ['titel', 'geplantAb', 'beschreibung'])
	};
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const formData = await request.formData();
		const werte = formWerte(formData, AUFTRAG_FELDER);

		let id: string;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			// To-dos (z. B. aus einer Vorlage) zuerst prüfen – ein ungültiges To-do soll keinen halben Auftrag hinterlassen
			const todos = pruefeTodoListe(todosAusFormular(formData));
			const erg = await legeAuftragAn(betriebKontext(locals), werte);
			id = erg.id;
			await legeTodosAn(betriebKontext(locals), id, todos);
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
