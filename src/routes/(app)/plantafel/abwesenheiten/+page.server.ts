import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import {
	ABWESENHEIT_FELDER,
	darfPlanen,
	legeAbwesenheitAn,
	listeAbwesenheiten,
	loescheAbwesenheit
} from '$lib/server/plantafel';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { berlinTag, tagPlus } from '$lib/zeit';

/** Abwesenheiten (Urlaub, Krank, Sonstiges) der letzten 30 und nächsten 365 Tage; anlegen und löschen. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'plantafel', 'plantafel.bearbeiten');
	const heute = berlinTag(new Date());
	const [abwesenheiten, mitarbeiter] = await alsSeitenFehler(() =>
		Promise.all([listeAbwesenheiten(k, tagPlus(heute, -30), tagPlus(heute, 365)), aktiveMitarbeiter(k)])
	);
	return { abwesenheiten, mitarbeiter, heute };
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), ABWESENHEIT_FELDER);
		try {
			await darfPlanen(locals);
			await legeAbwesenheitAn(betriebKontext(locals), werte);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		return { angelegt: true };
	},
	loeschen: async ({ locals, request }) => {
		const id = (await request.formData()).get('id');
		try {
			await darfPlanen(locals);
			await loescheAbwesenheit(betriebKontext(locals), typeof id === 'string' ? id : '');
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
