import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aendereKunde, holeKunde, KUNDE_FELDER } from '$lib/server/kunden';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.bearbeiten');
	return { kunde: await alsSeitenFehler(() => holeKunde(k, params.id)) };
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), KUNDE_FELDER);
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			await aendereKunde(betriebKontext(locals), params.id, werte);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, `/kunden/${params.id}`);
	}
};
