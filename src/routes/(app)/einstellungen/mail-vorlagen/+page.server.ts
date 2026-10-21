import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { hatRecht } from '$lib/server/rechte';
import { formWerte } from '$lib/server/seite';
import { vorschauBeispiele } from '$lib/server/nachfassen';
import {
	holeSignatur,
	kopiereMailVorlage,
	listeMailVorlagen,
	loescheMailVorlage,
	setzeStandard,
	speichereMailVorlage,
	speichereSignatur,
	VORLAGE_FELDER,
	vorlagenZugriff
} from '$lib/server/mail-vorlagen';
import { BEISPIELE_ALLE } from '$lib/mail-vorlagen';

/** Einstellungen → E-Mail-Vorlagen (Jamil msg 2789): alle Mail-Texte an einem Ort, Standard je Zweck, Signatur. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'vorlagen.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = vorlagenZugriff(locals);
	const [vorlagen, signatur, beispiele] = await Promise.all([listeMailVorlagen(k), holeSignatur(k), vorschauBeispiele(k, hatRecht(locals.nutzer, 'preise.sehen'))]);
	// Beispielwerte für alle Platzhalter (auch Termin, Portal-Link …); echte Angebote überschreiben ihre Felder
	return { vorlagen, signatur, beispiele: beispiele.map((b) => ({ ...b, werte: { ...BEISPIELE_ALLE, ...b.werte } })) };
};

async function ausfuehren<T>(locals: App.Locals, bereich: string, werte: Record<string, string>, fn: () => Promise<T>) {
	try {
		const ergebnis = await fn();
		const unbekannt = (ergebnis as { unbekannt?: string[] } | undefined)?.unbekannt ?? [];
		return { bereich, gespeichert: true, unbekannt };
	} catch (e) {
		return alsFormFehler(e, { bereich, werte });
	}
}

export const actions: Actions = {
	vorlage: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), [...VORLAGE_FELDER, 'id']);
		return ausfuehren(locals, `vorlage-${werte.id || 'neu'}`, werte, () => speichereMailVorlage(vorlagenZugriff(locals), werte.id || null, werte));
	},
	kopieren: async ({ locals, request }) => {
		const vid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `vorlage-${vid}`, {}, () => kopiereMailVorlage(vorlagenZugriff(locals), vid));
	},
	standard: async ({ locals, request }) => {
		const vid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `vorlage-${vid}`, {}, () => setzeStandard(vorlagenZugriff(locals), vid));
	},
	loeschen: async ({ locals, request }) => {
		const vid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `vorlage-${vid}`, {}, () => loescheMailVorlage(vorlagenZugriff(locals), vid));
	},
	signatur: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), ['signatur']);
		return ausfuehren(locals, 'signatur', werte, () => speichereSignatur(vorlagenZugriff(locals), werte.signatur));
	}
};
