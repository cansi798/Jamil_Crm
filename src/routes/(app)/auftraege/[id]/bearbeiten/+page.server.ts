import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aendereAuftrag, AUFTRAG_FORM_FELDER, holeAuftrag, ladeKundenAuswahl, sichtVon, zustaendigeAus } from '$lib/server/auftraege';
import { listeVorlagen } from '$lib/server/auftrag-vorlagen';
import { aktiveMitarbeiter, legeTodosAn, pruefeTodoListe, todosAusFormular } from '$lib/server/todos';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { listeQuellen } from '$lib/server/quellen';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'auftraege.bearbeiten');
	const nutzer = locals.nutzer!;
	const auftrag = await alsSeitenFehler(() => holeAuftrag(k, sichtVon(nutzer), params.id));
	return {
		auftrag,
		...(await ladeKundenAuswahl(k, auftrag.kundeId)),
		kundenSuche: hatRecht(nutzer, 'kunden.lesen'),
		vorlagen: await listeVorlagen(k),
		mitarbeiter: await aktiveMitarbeiter(k),
		quellen: (await listeQuellen(k)).map((q) => ({ id: q.id, name: q.name, aktiv: q.aktiv }))
	};
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const formData = await request.formData();
		const werte = formWerte(formData, AUFTRAG_FORM_FELDER);
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			// Neue Aufgaben (z. B. aus einer Vorlage) kommen zu den vorhandenen dazu; erst prüfen, dann speichern
			const todos = pruefeTodoListe(todosAusFormular(formData));
			const sicht = sichtVon(locals.nutzer!);
			await aendereAuftrag(betriebKontext(locals), params.id, { ...werte, ...zustaendigeAus(formData) }, sicht);
			await legeTodosAn(betriebKontext(locals), params.id, todos, sicht);
		} catch (e) {
			// Kunde/Objekte für das erneut angezeigte Formular – nur für Berechtigte (verrät sonst Kundendaten)
			const auswahl =
				locals.nutzer?.betriebId && hatRecht(locals.nutzer, 'auftraege.bearbeiten')
					? await ladeKundenAuswahl(betriebKontext(locals), werte.kundeId).catch(() => null)
					: null;
			return alsFormFehler(e, { werte, auswahl, zustaendige: formData.getAll('zustaendige').map(String) });
		}
		redirect(303, `/auftraege/${params.id}`);
	}
};
