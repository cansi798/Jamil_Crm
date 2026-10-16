import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aenderePosition, deaktivierePosition, holePosition, katalogAendern, katalogFormFelder } from '$lib/server/katalog';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'katalog', ['katalog.bearbeiten', 'angebote.bearbeiten']);
	const mitPreisen = hatRecht(locals.nutzer!, 'preise.sehen');
	return {
		position: await alsSeitenFehler(() => holePosition(k, params.id, mitPreisen)),
		mitPreisen,
		darfBearbeiten: hatRecht(locals.nutzer!, 'katalog.bearbeiten')
	};
};

export const actions: Actions = {
	speichern: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), [...katalogFormFelder(locals.nutzer), 'aktiv']);
		try {
			const { mitPreisen } = await katalogAendern(locals);
			await aenderePosition(betriebKontext(locals), params.id, werte, mitPreisen);
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, '/katalog');
	},
	/** Löschen – oder nur deaktivieren, wenn die Position in Angeboten verwendet ist. */
	loeschen: async ({ locals, params }) => {
		let ergebnis: string;
		try {
			await katalogAendern(locals);
			ergebnis = await deaktivierePosition(betriebKontext(locals), params.id);
		} catch (e) {
			return alsFormFehler(e);
		}
		redirect(303, ergebnis === 'deaktiviert' ? `/katalog/${params.id}` : '/katalog');
	}
};
