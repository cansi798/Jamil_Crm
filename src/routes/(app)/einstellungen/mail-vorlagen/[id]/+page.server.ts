import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { formWerte } from '$lib/server/seite';
import { kopiereMailVorlage, loescheMailVorlage, setzeStandard, speichereMailVorlage, VORLAGE_FELDER, vorlagenZugriff } from '$lib/server/mail-vorlagen';
import { mailSeite } from '$lib/server/mail-vorlagen-seite';

/** Eine E-Mail-Vorlage: bearbeiten mit Vorschau; oben rechts Als Standard, Kopieren, Löschen (mit Rückfrage). */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { vorlagen, signatur, beispiele } = await mailSeite(locals);
	const vorlage = vorlagen.find((v) => v.id === params.id);
	if (!vorlage) error(404, 'Vorlage nicht gefunden.');
	return { vorlage, signatur, beispiele, angelegt: url.searchParams.has('angelegt') };
};

export const actions: Actions = {
	vorlage: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), [...VORLAGE_FELDER]);
		try {
			const v = await speichereMailVorlage(vorlagenZugriff(locals), params.id, werte);
			return { gespeichert: true, unbekannt: v.unbekannt };
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
	},
	standard: async ({ locals, params }) => {
		try {
			await setzeStandard(vorlagenZugriff(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	kopieren: async ({ locals, params }) => {
		let neu: string;
		try {
			neu = (await kopiereMailVorlage(vorlagenZugriff(locals), params.id)).id;
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, `/einstellungen/mail-vorlagen/${neu}`);
	},
	loeschen: async ({ locals, params }) => {
		try {
			await loescheMailVorlage(vorlagenZugriff(locals), params.id);
		} catch (e) {
			return alsFormFehler(e, { loeschFehler: true });
		}
		redirect(303, '/einstellungen/mail-vorlagen');
	}
};
