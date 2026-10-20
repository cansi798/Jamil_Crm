import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { seitenZugriff, formWerte } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import {
	aendereKalkMitarbeiter,
	aendereKosten,
	FIRMA_FELDER,
	kalkulationZugriff,
	KOSTEN_FELDER,
	ladeBeispiel,
	ladeKalkulation,
	legeKalkMitarbeiterAn,
	legeKostenAn,
	loescheKalkMitarbeiter,
	loescheKosten,
	MITARBEITER_FELDER,
	speichereBetriebswerte
} from '$lib/server/kalkulation';

/** Kalkulation v2 – nur mit „Preise sehen“ + „Einstellungen“ (Chef/Admin; Gehälter sind vertraulich), Modul Katalog. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await seitenZugriff(locals, 'katalog', 'preise.sehen');
	if (!hatRecht(locals.nutzer!, 'einstellungen')) error(403, 'Keine Berechtigung');
	const [daten, benutzer] = await Promise.all([ladeKalkulation(k), aktiveMitarbeiter(k)]);
	return { ...daten, benutzer };
};

type Ereignis = { locals: App.Locals; request: Request };

async function ausfuehren(locals: App.Locals, bereich: string, werte: Record<string, string>, fn: () => Promise<unknown>) {
	try {
		await kalkulationZugriff(locals);
		await fn();
	} catch (e) {
		return alsFormFehler(e, { bereich, werte });
	}
}

const id = async (request: Request) => String((await request.formData()).get('id') ?? '');

export const actions: Actions = {
	firma: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), FIRMA_FELDER);
		return ausfuehren(locals, 'firma', werte, () => speichereBetriebswerte(betriebKontext(locals), werte));
	},
	kostenNeu: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), KOSTEN_FELDER);
		return ausfuehren(locals, 'kosten-neu', werte, () => legeKostenAn(betriebKontext(locals), werte));
	},
	kostenAendern: async ({ locals, request }: Ereignis) => {
		// Häkchen „aktiv“ steht vor einem versteckten „false“ – form.get liefert das erste
		const werte = formWerte(await request.formData(), [...KOSTEN_FELDER, 'id']);
		return ausfuehren(locals, `ko-${werte.id}`, werte, () => aendereKosten(betriebKontext(locals), werte.id, werte));
	},
	kostenLoeschen: async ({ locals, request }: Ereignis) => {
		const kid = await id(request);
		return ausfuehren(locals, `ko-${kid}`, {}, () => loescheKosten(betriebKontext(locals), kid));
	},
	mitarbeiterNeu: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), MITARBEITER_FELDER);
		return ausfuehren(locals, 'neu', werte, () => legeKalkMitarbeiterAn(betriebKontext(locals), werte));
	},
	mitarbeiterAendern: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), [...MITARBEITER_FELDER, 'id']);
		return ausfuehren(locals, `ma-${werte.id}`, werte, () => aendereKalkMitarbeiter(betriebKontext(locals), werte.id, werte));
	},
	mitarbeiterLoeschen: async ({ locals, request }: Ereignis) => {
		const mid = await id(request);
		return ausfuehren(locals, `ma-${mid}`, {}, () => loescheKalkMitarbeiter(betriebKontext(locals), mid));
	},
	beispiel: async ({ locals }: Ereignis) => ausfuehren(locals, 'beispiel', {}, () => ladeBeispiel(betriebKontext(locals)))
};
