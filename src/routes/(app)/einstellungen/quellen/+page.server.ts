import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { listeQuellen, loescheQuelle, speichereQuelle, verschiebeQuelle } from '$lib/server/quellen';
import { listePartner, quellenPartner, setzeQuellenPartner } from '$lib/server/partner';

/** Einstellungen → Auftragsquellen (Wunsch Jamil msgs 2593/2672): Name, Farbe, aktiv, Reihenfolge – Recht „Einstellungen“. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	// Auftraggeber je Quelle (Partner-Modul, msg 2856): neue Aufträge dieser Quelle bekommen ihn automatisch
	const [quellen, zuordnung, auftraggeber] = await Promise.all([listeQuellen(k), quellenPartner(k), listePartner(k, { art: 'auftraggeber' })]);
	return { quellen, zuordnung, auftraggeber: auftraggeber.map((p) => ({ id: p.id, name: p.name })) };
};

async function ausfuehren(locals: App.Locals, bereich: string, fn: () => Promise<unknown>) {
	try {
		pruefeRecht(locals, 'einstellungen');
		const ergebnis = await fn();
		return { bereich, ergebnis: typeof ergebnis === 'string' ? ergebnis : null };
	} catch (e) {
		return alsFormFehler(e, { bereich });
	}
}

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		return ausfuehren(locals, id || 'neu', () =>
			speichereQuelle(betriebKontext(locals), id || null, { name: f.get('name') ?? '', aktiv: f.get('aktiv') ?? 'true', farbe: f.get('farbe') ?? '' })
		);
	},
	verschieben: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		return ausfuehren(locals, id, () => verschiebeQuelle(betriebKontext(locals), id, f.get('richtung') === 'hoch' ? -1 : 1));
	},
	partner: async ({ locals, request }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		return ausfuehren(locals, id, () => setzeQuellenPartner(betriebKontext(locals), id, f.get('partnerId')));
	},
	loeschen: async ({ locals, request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		return ausfuehren(locals, id, () => loescheQuelle(betriebKontext(locals), id));
	}
};
