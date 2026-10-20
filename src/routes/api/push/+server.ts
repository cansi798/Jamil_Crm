import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { loeschePushAbo, pushGeraete, sendePush, speicherePushAbo, vapid } from '$lib/server/erinnerungen';

/**
 * Web-Push (Konto → Benachrichtigungen, Wunsch Jamil msg 2679), Recht „erinnerungen.nutzen“:
 * `GET` → öffentlicher VAPID-Schlüssel und Zahl der eigenen Geräte; `POST { endpoint, keys, geraet? }` → Gerät
 * anmelden; `POST { test: true }` → Testnachricht an die eigenen Geräte; `DELETE { endpoint }` → abmelden.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		pruefeRecht(locals, 'erinnerungen.nutzen');
		const k = betriebKontext(locals);
		return json({ schluessel: (await vapid()).oeffentlich, geraete: await pushGeraete(k) });
	} catch (e) {
		return alsAntwort(e);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		pruefeRecht(locals, 'erinnerungen.nutzen');
		const k = betriebKontext(locals);
		const koerper = (await leseJson(request)) as Record<string, unknown>;
		if (koerper.test === true) {
			const n = await sendePush(k, { titel: 'Test: Erinnerungen sind eingeschaltet', text: 'So sehen Erinnerungen aus dem CRM aus.', link: '/konto/benachrichtigungen' });
			return json({ gesendet: n });
		}
		await speicherePushAbo(k, koerper);
		return json({ geraete: await pushGeraete(k) }, { status: 201 });
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	try {
		const k = betriebKontext(locals);
		await loeschePushAbo(k, ((await leseJson(request)) as Record<string, unknown>).endpoint);
		return json({ geraete: await pushGeraete(k) });
	} catch (e) {
		return alsAntwort(e);
	}
};
