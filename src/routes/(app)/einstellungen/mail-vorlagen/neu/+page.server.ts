import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { formWerte } from '$lib/server/seite';
import { speichereMailVorlage, VORLAGE_FELDER, vorlagenZugriff } from '$lib/server/mail-vorlagen';
import { istMailZweck } from '$lib/mail-vorlagen';
import { mailSeite } from '$lib/server/mail-vorlagen-seite';

/** Neue E-Mail-Vorlage (Zweck aus `?zweck=`, sonst „Allgemein“). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const { signatur, beispiele } = await mailSeite(locals);
	const z = url.searchParams.get('zweck');
	return { signatur, beispiele, zweck: istMailZweck(z) ? z : ('allgemein' as const) };
};

export const actions: Actions = {
	vorlage: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), [...VORLAGE_FELDER]);
		let neu: string;
		try {
			neu = (await speichereMailVorlage(vorlagenZugriff(locals), null, werte)).id;
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, `/einstellungen/mail-vorlagen/${neu}?angelegt=1`);
	}
};
