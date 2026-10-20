import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { katalogAendern, katalogFormFelder, legePositionAn } from '$lib/server/katalog';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { formWerte, seitenZugriff } from '$lib/server/seite';
import { istGewerk } from '$lib/katalog-werte';
import { ladeFirmensatz } from '$lib/server/kalkulation';

export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'katalog', 'katalog.bearbeiten');
	const gewerk = url.searchParams.get('gewerk');
	const mitPreisen = hatRecht(locals.nutzer!, 'preise.sehen');
	return {
		mitPreisen,
		gewerk: istGewerk(gewerk) ? gewerk : '',
		satz: mitPreisen && hatRecht(locals.nutzer!, 'einstellungen') ? await ladeFirmensatz(k) : null
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const werte = formWerte(await request.formData(), katalogFormFelder(locals.nutzer));
		let gewerk = '';
		try {
			const { mitPreisen } = await katalogAendern(locals);
			const p = await legePositionAn(betriebKontext(locals), werte, mitPreisen);
			gewerk = p.gewerk ?? '';
		} catch (e) {
			return alsFormFehler(e, { werte });
		}
		redirect(303, gewerk ? `/katalog?gewerk=${gewerk}` : '/katalog');
	}
};
