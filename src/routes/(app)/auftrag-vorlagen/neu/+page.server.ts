import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { legeVorlageAn } from '$lib/server/auftrag-vorlagen';
import { todosAusFormular } from '$lib/server/todos';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals }) => {
	await darf(locals, 'auftraege', 'auftraege.bearbeiten');
	return {};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		let erg;
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			const daten = await request.formData();
			const name = daten.get('name') as string;
			const beschreibung = daten.get('beschreibung') as string;

			// To-dos mit Beschreibung und Stufen (Lautstärke/Schmutz) – gleiche Felder wie im Auftrag-Formular
			const todos = todosAusFormular(daten).map((t, i) => ({ ...t, sortierung: i }));

			erg = await legeVorlageAn(betriebKontext(locals), {
				name,
				beschreibung: beschreibung || undefined,
				todos
			});
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/auftrag-vorlagen/${erg.id}`);
	}
};
