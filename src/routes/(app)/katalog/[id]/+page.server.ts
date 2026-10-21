import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { aenderePosition, deaktivierePosition, holePosition, katalogAendern, katalogFormFelder } from '$lib/server/katalog';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, formWerte, seitenZugriff } from '$lib/server/seite';
import { ladeFirmensatz } from '$lib/server/kalkulation';

export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'katalog', ['katalog.bearbeiten', 'angebote.bearbeiten']);
	const mitPreisen = hatRecht(locals.nutzer!, 'preise.sehen');
	return {
		position: await alsSeitenFehler(() => holePosition(k, params.id, mitPreisen)),
		mitPreisen,
		darfBearbeiten: hatRecht(locals.nutzer!, 'katalog.bearbeiten'),
		// Stundensätze nur, wer die Kalkulation sehen darf (Preise + Einstellungen)
		satz: mitPreisen && hatRecht(locals.nutzer!, 'einstellungen') ? await ladeFirmensatz(k) : null
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
			return alsFormFehler(e, { loeschFehler: true });
		}
		redirect(303, ergebnis === 'deaktiviert' ? `/katalog/${params.id}` : '/katalog');
	}
};
