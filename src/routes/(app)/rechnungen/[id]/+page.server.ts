import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { pruefeErstellen, pruefeMahnen, rechnungenZugriff } from '$lib/server/rechnungen-zugriff';
import {
	holeRechnung,
	markiereRechnungGesendet,
	rechnungErneut,
	rechnungMail,
	sendeRechnung,
	setzeMahnPause,
	verwirfVorbereitung
} from '$lib/server/lexware/rechnungen';
import { mahnLaeufe, mahnungFreigeben, markiereLaufGesendet, sendeLauf } from '$lib/server/lexware/mahnungen';
import { mailVersandFuer } from '$lib/server/mail/versand';

/**
 * Rechnung (Lexware Phase 3): Stand aus Lexware (Nummer, Zahlstatus, Teilzahlungen), PDF, Senden, Mahnungen.
 * Recht „Rechnungen sehen“ (Modul lexware); Beträge nur mit „Preise sehen“; Senden mit „Rechnungen erstellen“,
 * Freigabe/Pause mit „Mahnungen verwalten“.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const z = await alsSeitenFehler(() => rechnungenZugriff(locals));
	const r = await alsSeitenFehler(() => holeRechnung(z.k, params.id, z.preise));
	return {
		rechnung: r,
		mahnungen: z.preise ? await mahnLaeufe(z.k, r.id) : [],
		mail: z.erstellen && r.nummer ? await rechnungMail(z.k, r.id) : null,
		postfach: (await mailVersandFuer(z.k.betriebId)).verbunden,
		darf: { preise: z.preise, erstellen: z.erstellen, mahnen: z.mahnen }
	};
};

async function aktion(locals: App.Locals, fn: (z: Awaited<ReturnType<typeof rechnungenZugriff>>) => Promise<unknown>, meldung: string) {
	try {
		const z = await rechnungenZugriff(locals);
		await fn(z);
		return { gespeichert: meldung };
	} catch (e) {
		return alsFormFehler(e);
	}
}

export const actions: Actions = {
	senden: ({ locals, params }) => aktion(locals, async (z) => (pruefeErstellen(z), sendeRechnung(z.k, params.id)), 'Rechnung gesendet.'),
	gesendet: ({ locals, params }) => aktion(locals, async (z) => (pruefeErstellen(z), markiereRechnungGesendet(z.k, params.id)), 'Als gesendet markiert.'),
	erneut: ({ locals, params }) => aktion(locals, async (z) => (pruefeErstellen(z), rechnungErneut(z.k, params.id)), 'Wird erneut in Lexware angelegt.'),
	verwerfen: ({ locals, params }) => aktion(locals, async (z) => (pruefeErstellen(z), verwirfVorbereitung(z.k, params.id)), 'Vorbereitung verworfen.'),
	pause: async ({ locals, params, request }) => {
		const bis = String((await request.formData()).get('bis') ?? '');
		return aktion(locals, async (z) => (pruefeMahnen(z), setzeMahnPause(z.k, params.id, bis === '' ? null : bis)), bis ? 'Mahnungen pausiert.' : 'Pause aufgehoben.');
	},
	freigeben: async ({ locals, request }) => {
		const id = String((await request.formData()).get('laufId') ?? '');
		return aktion(locals, async (z) => (pruefeMahnen(z), mahnungFreigeben(z.k, id)), 'Mahnung freigegeben – sie wird in Lexware angelegt.');
	},
	laufSenden: async ({ locals, request }) => {
		const id = String((await request.formData()).get('laufId') ?? '');
		return aktion(locals, async (z) => (pruefeErstellen(z), sendeLauf(z.k, id)), 'Gesendet.');
	},
	laufGesendet: async ({ locals, request }) => {
		const id = String((await request.formData()).get('laufId') ?? '');
		return aktion(locals, async (z) => (pruefeErstellen(z), markiereLaufGesendet(z.k, id)), 'Als gesendet markiert.');
	}
};
