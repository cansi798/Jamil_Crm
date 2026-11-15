import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { formWerte } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { listeStufen, loescheStufe, rollenAuswahl, speichereStufe, STUFEN_FELDER } from '$lib/server/nachfassen';
import { alsWahl, listeMailVorlagen } from '$lib/server/mail-vorlagen';
import { holeMahnKonfig, loeseMahnDrossel, speichereMahnKonfig, uebernimmMahnStandard } from '$lib/server/lexware/mahnungen';
import { pruefeModul } from '$lib/server/tarif';

/**
 * Einstellungen → Mahnungen (Lexware Phase 3, Jamil #6093 „Mahnstufen individuell einstellbar“): Stufen der Art
 * „rechnung“ (Anzahl, Tage nach Fälligkeit, Gebühr, Pauschale, Zinshinweis, Freigabe, Mailtext, Zuständig) und
 * Basiszins/Zahlungsziel je Betrieb. Recht „Mahnungen verwalten“, Modul lexware.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'mahnungen.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [stufen, vorlagen, mitarbeiter, rollen, konfig] = await Promise.all([listeStufen(k, 'rechnung'), listeMailVorlagen(k), aktiveMitarbeiter(k), rollenAuswahl(k), holeMahnKonfig(k)]);
	return { stufen, vorlagen: alsWahl(vorlagen), mitarbeiter, rollen, konfig, darfVorlagen: hatRecht(locals.nutzer, 'vorlagen.verwalten') };
};

async function ausfuehren(locals: App.Locals, bereich: string, werte: Record<string, string>, fn: () => Promise<unknown>) {
	try {
		pruefeRecht(locals, 'mahnungen.verwalten');
		await pruefeModul(locals, 'lexware');
		await fn();
		loeseMahnDrossel(locals.nutzer!.betriebId!);
	} catch (e) {
		return alsFormFehler(e, { bereich, werte });
	}
	return { bereich, gespeichert: true };
}

export const actions: Actions = {
	stufe: async ({ locals, request }) => {
		const f = await request.formData();
		const werte: Record<string, string> = { ...formWerte(f, [...STUFEN_FELDER, 'id']), art: 'rechnung' };
		return ausfuehren(locals, `stufe-${werte.id || 'neu'}`, werte, () => speichereStufe(betriebKontext(locals), werte.id || null, werte));
	},
	stufeLoeschen: async ({ locals, request }) => {
		const sid = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, `stufe-${sid}`, {}, async () => {
			const k = betriebKontext(locals);
			if (!(await listeStufen(k, 'rechnung')).some((s) => s.id === sid)) throw new (await import('$lib/server/fehler')).ApiFehler(404, 'Stufe nicht gefunden.');
			await loescheStufe(k, sid);
		});
	},
	standard: async ({ locals }) => ausfuehren(locals, 'standard', {}, () => uebernimmMahnStandard(betriebKontext(locals))),
	konfig: async ({ locals, request }) => {
		const f = await request.formData();
		const werte = formWerte(f, ['basiszins', 'zahlungszielTage']);
		return ausfuehren(locals, 'konfig', werte, () => speichereMahnKonfig(betriebKontext(locals), werte));
	}
};
