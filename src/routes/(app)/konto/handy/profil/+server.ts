import type { RequestHandler } from './$types';
import { betriebKontext } from '$lib/server/rechte';
import { darfEines } from '$lib/server/tarif';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { mitBetrieb } from '$lib/server/db';
import { meldeMitAppPasswortAn } from '$lib/server/caldav/app-passwoerter';
import { iosProfil } from '$lib/server/caldav/profil';
import { ipVon } from '$lib/server/buchung-anfrage';

/**
 * Profil fürs iPhone (.mobileconfig) direkt nach dem Erstellen eines App-Passworts („Handy verbinden“). Das Passwort
 * kommt per POST (nie in der Adresse) und muss ein gültiges eigenes App-Passwort sein; ohne Passwort fragt das iPhone
 * beim Installieren danach.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, request, url } = event;
	try {
		await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
		const k = betriebKontext(locals);
		const f = await request.formData();
		const passwort = typeof f.get('passwort') === 'string' && f.get('passwort') !== '' ? String(f.get('passwort')) : null;
		const email = await mitBetrieb(k, async (tx) => (await tx`select email from app.benutzer where id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`)[0]?.email as string);
		if (passwort) {
			const r = await meldeMitAppPasswortAn(email.toLowerCase(), passwort, ipVon(event));
			if (!('nutzer' in r) || r.nutzer.id !== k.benutzerId) throw new ApiFehler(400, 'Das App-Passwort passt nicht.');
		}
		const origin = new URL(process.env.ORIGIN ?? url.origin);
		const profil = iosProfil({
			host: origin.host,
			email,
			passwort,
			principal: `/caldav/nutzer/${k.benutzerId}/`,
			bezeichnung: 'CRM Aufgaben'
		});
		return new Response(profil, {
			headers: {
				'content-type': 'application/x-apple-aspen-config; charset=utf-8',
				'content-disposition': 'attachment; filename="crm-aufgaben.mobileconfig"',
				'cache-control': 'no-store'
			}
		});
	} catch (e) {
		return alsAntwort(e);
	}
};
