import { error, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { darfEines } from '$lib/server/tarif';
import { legeAppPasswortAn, listeAppPasswoerter, widerrufeAppPasswort } from '$lib/server/caldav/app-passwoerter';
import { listenJeAuftrag, setzeListenJeAuftrag } from '$lib/server/caldav/daten';
import { mitBetrieb } from '$lib/server/db';

/**
 * Konto → „Handy verbinden“ (Jamil msgs 2964/2980): eigene Aufgaben per CalDAV mit der Erinnerungen-App (iPhone) bzw.
 * DAVx⁵ + Tasks.org (Android) abgleichen. App-Passwörter erstellen (einmal angezeigt), Geräte entfernen, Liste je Auftrag.
 * Wer Aufgaben sieht (Modul Aufträge + Aufträge ansehen), darf das für sich selbst einrichten.
 */
async function pruefe(locals: App.Locals) {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	try {
		await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	} catch {
		error(403, 'Keine Berechtigung');
	}
	return betriebKontext(locals);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await pruefe(locals);
	const origin = process.env.ORIGIN ?? url.origin;
	const [geraete, jeAuftrag, email] = await Promise.all([
		listeAppPasswoerter(k),
		listenJeAuftrag(k),
		mitBetrieb(k, async (tx) => ((await tx`select email from app.benutzer where id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`)[0]?.email as string) ?? '')
	]);
	const seite = `${origin}/konto/handy`;
	return {
		geraete,
		jeAuftrag,
		email,
		host: new URL(origin).host,
		serverUrl: `${origin}/caldav/`,
		kontoUrl: `${origin}/caldav/nutzer/${k.benutzerId}/`,
		seite,
		qr: await QRCode.toDataURL(seite, { errorCorrectionLevel: 'M', margin: 2, width: 200 })
	};
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const f = await request.formData();
		const bezeichnung = f.get('bezeichnung');
		try {
			const k = await pruefe(locals);
			const { passwort } = await legeAppPasswortAn(k, bezeichnung);
			return { neu: { passwort, bezeichnung: String(bezeichnung).trim() } };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'neu' });
		}
	},
	entfernen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await widerrufeAppPasswort(await pruefe(locals), f.get('id'));
			return { entfernt: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'geraete' });
		}
	},
	listen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await setzeListenJeAuftrag(await pruefe(locals), f.get('jeAuftrag') === 'on');
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'listen' });
		}
	}
};
