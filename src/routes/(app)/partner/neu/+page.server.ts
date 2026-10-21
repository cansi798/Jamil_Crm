import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { seitenZugriff } from '$lib/server/seite';
import { istPartnerArt, legePartnerAn, partnerZugriff } from '$lib/server/partner';

export const load: PageServerLoad = async ({ locals, url }) => {
	await seitenZugriff(locals, 'auftraege', 'partner.verwalten');
	const art = url.searchParams.get('art');
	return { art: istPartnerArt(art) ? art : 'auftraggeber' };
};

const werte = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const e = werte(await request.formData());
		let id: string;
		try {
			id = (await legePartnerAn(await partnerZugriff(locals), e)).id;
		} catch (f) {
			return alsFormFehler(f, { fehler: f instanceof ApiFehler ? f.message : 'Interner Fehler.', werte: e });
		}
		redirect(303, `/partner/${id}`);
	}
};
