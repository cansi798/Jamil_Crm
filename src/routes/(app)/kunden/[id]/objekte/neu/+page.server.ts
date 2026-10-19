import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { holeKunde, legeObjektAn, OBJEKT_FELDER } from '$lib/server/kunden';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.bearbeiten');
	const kunde = await alsSeitenFehler(() => holeKunde(k, params.id));
	// Wunsch Jamil: Ein neues Objekt hat standardmäßig die Adresse des Kunden – bei Abweichung im Formular ändern
	return { kunde, vorbelegt: { strasse: kunde.strasse ?? '', plz: kunde.plz ?? '', ort: kunde.ort ?? '' } };
};

export const actions: Actions = {
	anlegen: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), OBJEKT_FELDER);
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await legeObjektAn(betriebKontext(locals), params.id, werte);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, `/kunden/${params.id}`);
	}
};
