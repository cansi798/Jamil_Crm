import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { seitenZugriff, formWerte } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import {
	aendereKalkMitarbeiter,
	FIRMA_FELDER,
	kalkulationZugriff,
	ladeKalkulation,
	legeKalkMitarbeiterAn,
	loescheKalkMitarbeiter,
	MITARBEITER_FELDER,
	speichereBetriebswerte
} from '$lib/server/kalkulation';

/** Kalkulation / Stundensatz – nur mit „Preise sehen“ + „Einstellungen“ (Gehälter sind vertraulich), Modul Katalog. */
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

export const actions: Actions = {
	firma: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), FIRMA_FELDER);
		return ausfuehren(locals, 'firma', werte, () => speichereBetriebswerte(betriebKontext(locals), werte));
	},
	mitarbeiterNeu: async ({ locals, request }: Ereignis) => {
		const werte = formWerte(await request.formData(), MITARBEITER_FELDER);
		return ausfuehren(locals, 'neu', werte, () => legeKalkMitarbeiterAn(betriebKontext(locals), werte));
	},
	mitarbeiterAendern: async ({ locals, request }: Ereignis) => {
		const f = await request.formData();
		const werte = formWerte(f, [...MITARBEITER_FELDER, 'id']);
		return ausfuehren(locals, `ma-${werte.id}`, werte, () => aendereKalkMitarbeiter(betriebKontext(locals), werte.id, werte));
	},
	mitarbeiterLoeschen: async ({ locals, request }: Ereignis) => {
		const id = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `ma-${id}`, {}, () => loescheKalkMitarbeiter(betriebKontext(locals), id));
	}
};
