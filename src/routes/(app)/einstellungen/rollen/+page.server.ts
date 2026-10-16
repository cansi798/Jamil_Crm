import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht, VORLAGEN_NAMEN, type Vorlage } from '$lib/server/rechte';
import { legeRolleAn, listeRollen } from '$lib/server/rollen';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	return {
		rollen: await listeRollen(betriebKontext(locals)),
		vorlagen: (Object.keys(VORLAGEN_NAMEN) as Vorlage[]).map((schluessel) => ({
			schluessel,
			name: VORLAGEN_NAMEN[schluessel]
		}))
	};
};

export const actions: Actions = {
	/** Neue Rolle anlegen (optional aus einer Vorlage) und gleich zur Bearbeitung weiterleiten. */
	neu: async ({ locals, request }) => {
		const form = await request.formData();
		const name = form.get('name');
		let id: string;
		try {
			pruefeRecht(locals, 'einstellungen');
			const rolle = await legeRolleAn(betriebKontext(locals), { name, vorlage: form.get('vorlage') });
			id = rolle.id;
		} catch (e) {
			return alsFormFehler(e, { name: typeof name === 'string' ? name : '' });
		}
		redirect(303, `/einstellungen/rollen/${id}`);
	}
};
