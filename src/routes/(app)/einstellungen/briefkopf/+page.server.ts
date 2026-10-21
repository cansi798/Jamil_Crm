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
	speichereProfil,
	setzeHausfarbe,
	type LogoVariante
} from '$lib/server/betriebsprofil';
import { formWerte } from '$lib/server/seite';

/** Briefkopf, Logo für Angebote und Logo für die App (Recht `einstellungen`). */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	return { profil: await holeProfil(betriebKontext(locals)) };
};

async function logoHochladen(locals: App.Locals, request: Request, variante: LogoVariante) {
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
		await speichereLogo(betriebKontext(locals), await dateiBytes(datei), variante);
	} catch (e) {
		return alsFormFehler(e, { logoFehler: variante });
	}
	return { logoGespeichert: variante };
}

async function logoEntfernen(locals: App.Locals, variante: LogoVariante) {
	try {
		pruefeRecht(locals, 'einstellungen');
		await loescheLogo(betriebKontext(locals), variante);
	} catch (e) {
		return alsFormFehler(e, { logoFehler: variante });
	}
	return { logoGeloescht: variante };
}

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
	logo: async ({ locals, request }) => logoHochladen(locals, request, 'briefkopf'),
	logoLoeschen: async ({ locals }) => logoEntfernen(locals, 'briefkopf'),
	// Logo für dunklen Hintergrund (Seitenleiste der App, msg 3014)
	logoDunkel: async ({ locals, request }) => logoHochladen(locals, request, 'dunkel'),
	logoDunkelLoeschen: async ({ locals }) => logoEntfernen(locals, 'dunkel'),
	// Hausfarbe (msg 3016): aus dem Logo übernehmen oder auf Standard zurücksetzen
	hausfarbe: async ({ locals, request }) => {
		try {
			pruefeRecht(locals, 'einstellungen');
			await setzeHausfarbe(betriebKontext(locals), (await request.formData()).get('wahl'));
		} catch (e) {
			return alsFormFehler(e, { farbeFehler: true });
		}
		return { farbeGespeichert: true };
	}
};

