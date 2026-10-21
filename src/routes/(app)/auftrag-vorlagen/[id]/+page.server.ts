import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeVorlage, aendereVorlage, loescheVorlage } from '$lib/server/auftrag-vorlagen';
import { todosAusFormular } from '$lib/server/todos';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { vorlagenAufgabenZeiten } from '$lib/server/kennzahlen';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const vorlage = await alsSeitenFehler(() => holeVorlage(k, params.id));
	// Zeitmessung je Vorlagen-Aufgabe (Jamil msg 2858): über alle Aufträge – deshalb nur mit „Alle Aufträge ansehen“
	const zeiten = hatRecht(locals.nutzer!, 'auftraege.alle_lesen') ? Object.fromEntries(await vorlagenAufgabenZeiten(k, vorlage.id)) : null;
	return {
		vorlage,
		zeiten,
		darfBearbeiten: hatRecht(locals.nutzer!, 'auftraege.bearbeiten')
	};
};

export const actions: Actions = {
	bearbeiten: async ({ locals, params, request }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			const daten = await request.formData();
			const name = daten.get('name') as string;
			const beschreibung = daten.get('beschreibung') as string;

			// Aufgaben mit Beschreibung und Stufen (Lautstärke/Schmutz)
			const todos = todosAusFormular(daten).map((t, i) => ({ ...t, sortierung: i }));

			await aendereVorlage(betriebKontext(locals), params.id, {
				name,
				beschreibung: beschreibung || undefined,
				todos
			});
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftrag-vorlagen/${params.id}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await loescheVorlage(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e, { loeschFehler: true });
		}
		redirect(303, '/auftrag-vorlagen');
	}
};
