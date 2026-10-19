import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeVorlage, aendereVorlage, loescheVorlage } from '$lib/server/auftrag-vorlagen';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const vorlage = await alsSeitenFehler(() => holeVorlage(k, params.id));
	return {
		vorlage,
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

			const todos: { titel: string; beschreibung?: string }[] = [];
			for (const [schluessel, wert] of daten.entries()) {
				if (schluessel.startsWith('todo_') && !schluessel.startsWith('todo_beschreibung_') && wert) {
					const index = schluessel.replace('todo_', '');
					const titel = wert as string;
					const todoBeschreibung = daten.get(`todo_beschreibung_${index}`) as string;
					todos.push({ titel, beschreibung: todoBeschreibung || undefined });
				}
			}

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
			return alsFormFehler(e);
		}
		redirect(303, '/auftrag-vorlagen');
	}
};
