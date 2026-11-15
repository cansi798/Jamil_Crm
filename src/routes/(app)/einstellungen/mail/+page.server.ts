import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { ladeMailEinstellungen, listeMailAusgang, mailStatus, sendeTestmail, speichereMailEinstellungen } from '$lib/server/mail/konfig';
import { geheimnisBereit } from '$lib/server/geheimnis';

/** Einstellungen → E-Mail-Versand (Recht „Einstellungen“): Postfach, Testmail, Versandprotokoll. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	pruefeRecht(locals, 'einstellungen');
	const k = betriebKontext(locals);
	const [e, status, ausgang] = await Promise.all([ladeMailEinstellungen(k), mailStatus(k), listeMailAusgang(k, 50)]);
	return { e, status, ausgang, geheimnisBereit: geheimnisBereit() };
};

const feld = (f: FormData, n: string) => {
	const w = f.get(n);
	return typeof w === 'string' ? w : '';
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			pruefeRecht(locals, 'einstellungen');
			await speichereMailEinstellungen(betriebKontext(locals), {
				aktiv: f.get('aktiv') === 'on',
				host: feld(f, 'host'),
				port: feld(f, 'port'),
				sicherheit: feld(f, 'sicherheit') || 'starttls',
				benutzer: feld(f, 'benutzer'),
				passwort: feld(f, 'passwort'),
				passwortLoeschen: f.get('passwortLoeschen') === 'on',
				absenderName: feld(f, 'absenderName'),
				absenderAdresse: feld(f, 'absenderAdresse'),
				antwortAn: feld(f, 'antwortAn'),
				bcc: feld(f, 'bcc')
			});
			return { aktion: 'speichern', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'speichern' });
		}
	},
	testmail: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			pruefeRecht(locals, 'einstellungen');
			const r = await sendeTestmail(betriebKontext(locals), feld(f, 'an'));
			return { aktion: 'testmail', ergebnis: r.status, meldung: r.fehler ?? null };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'testmail' });
		}
	}
};
