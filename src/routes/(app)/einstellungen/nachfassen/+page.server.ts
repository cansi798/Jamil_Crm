import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { formWerte } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { loeseDrossel, listeStufen, loescheStufe, rollenAuswahl, speichereStufe, STUFEN_FELDER, uebernimmStandard } from '$lib/server/nachfassen';
import { alsWahl, listeMailVorlagen } from '$lib/server/mail-vorlagen';

/**
 * Einstellungen → Nachfassen (Jamil msgs 2585, 2633, 2636): Stufen je Art – nur „Einstellungen“. Mail-Vorlagen und
 * Signatur stehen seit msg 2789 in der Bibliothek (Einstellungen → E-Mail-Vorlagen); hier nur die Auswahl je Stufe.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [stufen, vorlagen, mitarbeiter, rollen] = await Promise.all([listeStufen(k), listeMailVorlagen(k), aktiveMitarbeiter(k), rollenAuswahl(k)]);
	return { stufen, vorlagen: alsWahl(vorlagen), mitarbeiter, rollen, darfVorlagen: hatRecht(locals.nutzer, 'vorlagen.verwalten') };
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
	standard: async ({ locals }) => ausfuehren(locals, 'standard', {}, () => uebernimmStandard(betriebKontext(locals)))
};
