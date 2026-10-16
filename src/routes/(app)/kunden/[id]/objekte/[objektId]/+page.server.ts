import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aendereObjekt, holeKunde, holeObjekt, loescheObjekt, OBJEKT_FELDER } from '$lib/server/kunden';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

/** Objekt ansehen/bearbeiten. Es muss zum Kunden aus der URL gehören, sonst 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	return alsSeitenFehler(async () => ({
		kunde: await holeKunde(k, params.id),
		objekt: await holeObjekt(k, params.id, params.objektId),
		darfBearbeiten: hatRecht(locals.nutzer!, 'kunden.bearbeiten')
	}));
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), OBJEKT_FELDER);
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await aendereObjekt(betriebKontext(locals), params.id, params.objektId, werte);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, `/kunden/${params.id}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await loescheObjekt(betriebKontext(locals), params.id, params.objektId);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/kunden/${params.id}`);
	}
};
