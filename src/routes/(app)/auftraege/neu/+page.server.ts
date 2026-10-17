import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { AUFTRAG_FELDER, ladeKundenAuswahl, legeAuftragAn } from '$lib/server/auftraege';
import { listeVorlagen } from '$lib/server/auftrag-vorlagen';
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

		// Todos aus Formular sammeln
		const todos: { titel: string; beschreibung?: string }[] = [];
		for (const [schluessel, wert] of formData.entries()) {
			if (schluessel.startsWith('todo_') && !schluessel.startsWith('todo_beschreibung_') && wert) {
				const index = schluessel.replace('todo_', '');
				const titel = wert as string;
				const todoBeschreibung = formData.get(`todo_beschreibung_${index}`) as string;
				todos.push({ titel, beschreibung: todoBeschreibung || undefined });
			}
		}

		let id: string;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			const erg = await legeAuftragAn(betriebKontext(locals), werte);
			id = erg.id;

			// Todos anlegen, falls vorhanden
			if (todos.length > 0) {
				const { legeTodoAn } = await import('$lib/server/todos');
				for (const todo of todos) {
					await legeTodoAn(betriebKontext(locals), {
						auftragId: id,
						titel: todo.titel,
						beschreibung: todo.beschreibung ?? null,
						zustaendigId: null,
						faellig: null
					});
				}
			}
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
