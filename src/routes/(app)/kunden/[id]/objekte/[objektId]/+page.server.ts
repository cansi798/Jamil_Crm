import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aendereObjekt, holeKunde, holeObjekt, loescheObjekt, OBJEKT_FELDER } from '$lib/server/kunden';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';
import { ANLAGE_FELDER, legeAnlageAn, listeAnlagen } from '$lib/server/anlagen';
import { extraAusFormular } from '$lib/anlagen-typen';

/** Objekt ansehen/bearbeiten. Es muss zum Kunden aus der URL gehören, sonst 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	return alsSeitenFehler(async () => ({
		kunde: await holeKunde(k, params.id),
		objekt: await holeObjekt(k, params.id, params.objektId),
		anlagen: await listeAnlagen(k, params.id, params.objektId),
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
	anlageAnlegen: async ({ locals, params, request }) => {
		const f = await request.formData();
		const werte = formWerte(f, ANLAGE_FELDER);
		const extra = extraAusFormular(f);
		let id: string;
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			id = (await legeAnlageAn(betriebKontext(locals), params.id, params.objektId, werte, extra)).id;
		} catch (e) {
			return alsFormFehler(e, { anlageWerte: { ...werte, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`extra_${k}`, v])) } });
		}
		redirect(303, `/anlagen/${id}`);
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
