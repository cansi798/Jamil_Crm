import { json } from '@sveltejs/kit';
import { sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { ApiFehler, alsAntwort } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { holeLogo, leseLogoAusAnfrage, loescheLogo, speichereLogo } from '$lib/server/betriebsprofil';

/**
 * Logo des Betriebs. Lesen (Vorschau, Angebots-Editor): `einstellungen` oder `angebote.bearbeiten`.
 * Hochladen (`POST`, Formular-Feld `logo` oder rohe Bytes) und Löschen: `einstellungen`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const n = locals.nutzer;
		if (!n) throw new ApiFehler(401, 'Nicht angemeldet');
		if (!hatRecht(n, 'einstellungen') && !hatRecht(n, 'angebote.bearbeiten')) throw new ApiFehler(403, 'Keine Berechtigung');
		const logo = await holeLogo(betriebKontext(locals));
		if (!logo) throw new ApiFehler(404, 'Kein Logo hinterlegt.');
		return new Response(logo.bytes as BodyInit, {
			headers: {
				...sichereDateiKopfzeilen(logo.typ),
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		const k = betriebKontext(locals);
		return json(await speichereLogo(k, await leseLogoAusAnfrage(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'einstellungen');
		return json(await loescheLogo(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};
