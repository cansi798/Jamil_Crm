import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { formWerte } from '$lib/server/seite';
import { mailSeite } from '$lib/server/mail-vorlagen-seite';
import { kopiereMailVorlage, setzeStandard, speichereSignatur, vorlagenZugriff } from '$lib/server/mail-vorlagen';
import { istMailZweck } from '$lib/mail-vorlagen';

/** Einstellungen → E-Mail-Vorlagen (Jamil msgs 2789, 3086): Liste je Zweck wie alle Vorlagen-Seiten, Firmensignatur. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const z = url.searchParams.get('zweck');
	return { ...(await mailSeite(locals)), filter: istMailZweck(z) ? z : null };
};

const vid = async (request: Request) => String((await request.formData()).get('id') ?? '');

export const actions: Actions = {
	standard: async ({ locals, request }) => {
		try {
			await setzeStandard(vorlagenZugriff(locals), await vid(request));
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	kopieren: async ({ locals, request }) => {
		let neu: string;
		try {
			neu = (await kopiereMailVorlage(vorlagenZugriff(locals), await vid(request))).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/einstellungen/mail-vorlagen/${neu}`);
	},
	signatur: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), ['signatur']);
		try {
			await speichereSignatur(vorlagenZugriff(locals), werte.signatur);
			return { bereich: 'signatur', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'signatur', werte });
		}
	}
};
