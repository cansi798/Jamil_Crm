import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ApiFehler, alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import {
	dateiBytes,
	holeProfil,
	loescheLogo,
	PROFIL_FELDER,
	speichereLogo,
	speichereProfil
} from '$lib/server/betriebsprofil';
import { formWerte } from '$lib/server/seite';

/** Briefkopf und Logo für Angebote (Recht `einstellungen`). */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	return { profil: await holeProfil(betriebKontext(locals)) };
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), PROFIL_FELDER);
		try {
			pruefeRecht(locals, 'einstellungen');
			await speichereProfil(betriebKontext(locals), werte);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		return { gespeichert: true };
	},
	logo: async ({ locals, request }) => {
		try {
			pruefeRecht(locals, 'einstellungen');
			let datei: FormDataEntryValue | null = null;
			try {
				datei = (await request.formData()).get('logo');
			} catch {
				/* zu groß oder kaputt: wie „keine Datei“ */
			}
			if (!datei || typeof datei === 'string' || datei.size === 0) {
				throw new ApiFehler(400, 'Bitte ein PNG- oder JPEG-Bild bis 1 MB hochladen');
			}
			await speichereLogo(betriebKontext(locals), await dateiBytes(datei));
		} catch (e) {
			return alsFormFehler(e, { logoFehler: true });
		}
		return { logoGespeichert: true };
	},
	logoLoeschen: async ({ locals }) => {
		try {
			pruefeRecht(locals, 'einstellungen');
			await loescheLogo(betriebKontext(locals));
		} catch (e) {
			return alsFormFehler(e, { logoFehler: true });
		}
		return { logoGeloescht: true };
	}
};

