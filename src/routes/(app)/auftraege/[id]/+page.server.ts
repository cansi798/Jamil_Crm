import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeAuftrag, loescheAuftrag, pruefeStatus, setzeStatus, sichtVon } from '$lib/server/auftraege';
import { liesProtokoll } from '$lib/server/protokoll';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { verlaufZeile } from '$lib/verlauf';
import { berlinTag } from '$lib/zeit';
import { todoAktionen } from '$lib/server/todo-aktionen';
import { aktiveMitarbeiter, listeTodos } from '$lib/server/todos';
import { einsaetzeZumAuftrag } from '$lib/server/plantafel';

/** Auftrag mit Statuskette, Einsätzen, To-dos und Verlauf. Nicht sichtbare (fremde/unbekannte) Aufträge: 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const sicht = sichtVon(nutzer);
		const auftrag = await holeAuftrag(k, sicht, params.id);
		const darfBearbeiten = hatRecht(nutzer, 'auftraege.bearbeiten');
		const [protokoll, todos, mitarbeiter, einsaetze] = await Promise.all([
			liesProtokoll(k, { tabelle: 'auftraege', datensatz: auftrag.id, vor: null }),
			listeTodos(k, sicht, { auftragId: auftrag.id }),
			darfBearbeiten ? aktiveMitarbeiter(k) : Promise.resolve([]),
			einsaetzeZumAuftrag(k, auftrag.id)
		]);
		return {
			auftrag,
			todos,
			mitarbeiter,
			einsaetze,
			heute: berlinTag(new Date()),
			benutzerId: nutzer.id,
			verlauf: protokoll.eintraege.map(verlaufZeile),
			verlaufGekuerzt: protokoll.naechsteVor !== null,
			darfBearbeiten,
			kundeLesbar: hatRecht(nutzer, 'kunden.lesen')
		};
	});
};

const todo = todoAktionen(true);

export const actions: Actions = {
	todoAnlegen: todo.anlegen,
	todoUmschalten: todo.umschalten,
	todoAendern: todo.aendern,
	todoLoeschen: todo.loeschen,
	/** Ein Schritt vor oder zurück in der Statuskette (Formularfeld `status` = Zielstatus). */
	status: async ({ locals, params, request }) => {
		const form = await request.formData();
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await setzeStatus(betriebKontext(locals), params.id, pruefeStatus(form.get('status')), sichtVon(locals.nutzer!));
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftraege/${params.id}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await loescheAuftrag(betriebKontext(locals), params.id, sichtVon(locals.nutzer!));
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/auftraege');
	}
};
