import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { formWerte } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import {
	holeSignatur,
	loeseDrossel,
	listeMailVorlagen,
	listeStufen,
	loescheMailVorlage,
	loescheStufe,
	rollenAuswahl,
	speichereMailVorlage,
	speichereSignatur,
	speichereStufe,
	STUFEN_FELDER,
	uebernimmStandard,
	VORLAGE_FELDER,
	vorschauBeispiele
} from '$lib/server/nachfassen';

/** Einstellungen → Nachfassen (Jamil msgs 2585, 2633, 2636): Stufen je Art, Mail-Vorlagen, Signatur – nur „Einstellungen“. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [stufen, vorlagen, signatur, mitarbeiter, rollen, beispiele] = await Promise.all([
		listeStufen(k),
		listeMailVorlagen(k),
		holeSignatur(k),
		aktiveMitarbeiter(k),
		rollenAuswahl(k),
		vorschauBeispiele(k, hatRecht(locals.nutzer, 'preise.sehen'))
	]);
	return { stufen, vorlagen, signatur, mitarbeiter, rollen, beispiele };
};

async function ausfuehren(locals: App.Locals, bereich: string, werte: Record<string, string>, fn: () => Promise<unknown>) {
	try {
		pruefeRecht(locals, 'einstellungen');
		await fn();
		loeseDrossel(locals.nutzer!.betriebId!);
	} catch (e) {
		return alsFormFehler(e, { bereich, werte });
	}
	return { bereich, gespeichert: true };
}

export const actions: Actions = {
	stufe: async ({ locals, request }) => {
		const f = await request.formData();
		const werte = formWerte(f, [...STUFEN_FELDER, 'id']);
		return ausfuehren(locals, `stufe-${werte.id || `neu-${werte.art}`}`, werte, () => speichereStufe(betriebKontext(locals), werte.id || null, werte));
	},
	stufeLoeschen: async ({ locals, request }) => {
		const sid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `stufe-${sid}`, {}, () => loescheStufe(betriebKontext(locals), sid));
	},
	standard: async ({ locals }) => ausfuehren(locals, 'standard', {}, () => uebernimmStandard(betriebKontext(locals))),
	vorlage: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), [...VORLAGE_FELDER, 'id']);
		return ausfuehren(locals, `vorlage-${werte.id || 'neu'}`, werte, () => speichereMailVorlage(betriebKontext(locals), werte.id || null, werte));
	},
	vorlageLoeschen: async ({ locals, request }) => {
		const vid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `vorlage-${vid}`, {}, () => loescheMailVorlage(betriebKontext(locals), vid));
	},
	signatur: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), ['signatur']);
		return ausfuehren(locals, 'signatur', werte, () => speichereSignatur(betriebKontext(locals), werte.signatur));
	}
};
