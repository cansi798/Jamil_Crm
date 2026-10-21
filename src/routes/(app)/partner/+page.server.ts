import type { PageServerLoad } from './$types';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istPartnerArt, listePartner } from '$lib/server/partner';

/** Partner (Jamil msgs 2854/2856): Liste mit Art und Suche; nur mit „Partner verwalten“. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', 'partner.verwalten');
	const art = url.searchParams.get('art');
	const suche = url.searchParams.get('suche') ?? '';
	const inaktive = url.searchParams.get('inaktive') === 'ja';
	return alsSeitenFehler(async () => ({
		partner: await listePartner(k, { art, suche, mitInaktiven: inaktive }),
		art: istPartnerArt(art) ? art : null,
		suche,
		inaktive
	}));
};
