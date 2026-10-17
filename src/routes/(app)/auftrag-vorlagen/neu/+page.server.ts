import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { legeVorlageAn } from '$lib/server/auftrag-vorlagen';
import { betriebKontext } from '$lib/server/rechte';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals }) => {
	await darf(locals, 'auftraege', 'auftraege.bearbeiten');
	return {};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		try {
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			const daten = await request.formData();
			const name = daten.get('name') as string;
			const beschreibung = daten.get('beschreibung') as string;

			// Todos aus Formular sammeln
			const todos: { titel: string; beschreibung?: string }[] = [];
			for (const [schluessel, wert] of daten.entries()) {
				if (schluessel.startsWith('todo_') && wert) {
					const index = schluessel.replace('todo_', '');
					const titel = wert as string;
					const todoBeschreibung = daten.get(`todo_beschreibung_${index}`) as string;
					todos.push({ titel, beschreibung: todoBeschreibung || undefined });
				}
			}

			const erg = await legeVorlageAn(betriebKontext(locals), {
				name,
				beschreibung: beschreibung || undefined,
				todos
			});
			redirect(303, `/auftrag-vorlagen/${erg.id}`);
		} catch (e: any) {
			return fail(400, { fehler: e.message });
		}
	}
};
