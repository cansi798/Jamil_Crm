import type { PageServerLoad } from './$types';
import { listeKunden, MAX_TREFFER } from '$lib/server/kunden';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';

/** Kundenliste mit Suche (`?suche=`): höchstens 50 Treffer, nach Name sortiert. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'kunden', 'kunden.lesen');
	const suche = (url.searchParams.get('suche') ?? '').slice(0, 300);
	const kunden = await alsSeitenFehler(() => listeKunden(k, suche));
	return {
		suche,
		kunden,
		maxTreffer: MAX_TREFFER,
		darfBearbeiten: hatRecht(locals.nutzer!, 'kunden.bearbeiten')
	};
};
