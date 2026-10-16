import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { KUNDE_FELDER, legeKundeAn } from '$lib/server/kunden';
import { betriebKontext } from '$lib/server/rechte';
import { formWerte, seitenZugriff } from '$lib/server/seite';
import { darf } from '$lib/server/tarif';

export const load: PageServerLoad = async ({ locals }) => {
	await seitenZugriff(locals, 'kunden', 'kunden.bearbeiten');
	return {};
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), KUNDE_FELDER);
		let id: string;
		try {
			await darf(locals, 'kunden', 'kunden.bearbeiten');
			id = (await legeKundeAn(betriebKontext(locals), werte)).id;
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, `/kunden/${id}`);
	}
};
