import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ApiFehler, alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht, RECHTE, type Recht } from '$lib/server/rechte';
import { aendereRolle, holeRolle, loescheRolle } from '$lib/server/rollen';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	try {
		return {
			rolle: await holeRolle(betriebKontext(locals), params.id),
			rechte: (Object.keys(RECHTE) as Recht[]).map((schluessel) => ({ schluessel, label: RECHTE[schluessel] }))
		};
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
};

export const actions: Actions = {
	/** Name und angekreuzte Rechte speichern. */
	speichern: async ({ locals, params, request }) => {
		const form = await request.formData();
		try {
			pruefeRecht(locals, 'einstellungen');
			await aendereRolle(betriebKontext(locals), params.id, {
				name: form.get('name'),
				rechte: form.getAll('rechte')
			});
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	},
	loeschen: async ({ locals, params }) => {
		try {
			pruefeRecht(locals, 'einstellungen');
			await loescheRolle(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, '/einstellungen/rollen');
	}
};
