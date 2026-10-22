import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import {
	aendereBenutzer,
	EINLADUNG_TAGE,
	ladeEin,
	listeBenutzer,
	listeEinladungen,
	rollenZurAuswahl,
	setzeAnrede,
	widerrufeEinladung
} from '$lib/server/benutzer';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'benutzer.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [benutzer, rollen, einladungen] = await Promise.all([
		listeBenutzer(k),
		rollenZurAuswahl(k, locals.nutzer.rechte),
		listeEinladungen(k)
	]);
	return { benutzer, rollen, einladungen, ichId: locals.nutzer.id, einladungTage: EINLADUNG_TAGE };
};

const text = (form: FormData, name: string) => {
	const wert = form.get(name);
	return typeof wert === 'string' ? wert : '';
};

export const actions: Actions = {
	/** Einladung anlegen; der Link wird einmalig angezeigt (es wird keine E-Mail verschickt). */
	einladen: async ({ locals, request, url }) => {
		const form = await request.formData();
		const email = text(form, 'email').slice(0, 300);
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			const e = await ladeEin(betriebKontext(locals), locals.nutzer!.rechte, {
				email,
				rolleId: text(form, 'rolleId')
			});
			return { aktion: 'einladen', link: `${url.origin}/einladung/${e.token}`, email: e.email, laeuftAb: e.laeuftAb };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'einladen', email });
		}
	},
	widerrufen: async ({ locals, request }) => {
		const form = await request.formData();
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			await widerrufeEinladung(betriebKontext(locals), text(form, 'id'));
			return { aktion: 'widerrufen' };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'widerrufen' });
		}
	},
	/** Rolle eines Benutzers ändern. */
	aendern: async ({ locals, request }) => {
		const form = await request.formData();
		const id = text(form, 'id');
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			await aendereBenutzer(betriebKontext(locals), locals.nutzer!.rechte, id, { rolleId: text(form, 'rolleId') });
			return { aktion: 'aendern', id, gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'aendern', id });
		}
	},
	/** Anrede (Herr/Frau/keine Angabe) – wählt die Comic-Figur im Kundenportal (Jamil msg 3113). */
	anrede: async ({ locals, request }) => {
		const form = await request.formData();
		const id = text(form, 'id');
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			await setzeAnrede(betriebKontext(locals), id, text(form, 'anrede'));
			return { aktion: 'anrede', id, gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'anrede', id });
		}
	},
	/** Benutzer aktivieren (`aktiv=true`) oder deaktivieren (`aktiv=false`, beendet seine Sitzungen). */
	aktiv: async ({ locals, request }) => {
		const form = await request.formData();
		const id = text(form, 'id');
		try {
			pruefeRecht(locals, 'benutzer.verwalten');
			const wert = text(form, 'aktiv');
			await aendereBenutzer(betriebKontext(locals), locals.nutzer!.rechte, id, {
				aktiv: wert === 'true' ? true : wert === 'false' ? false : wert
			});
			return { aktion: 'aktiv', id, gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'aktiv', id });
		}
	}
};
