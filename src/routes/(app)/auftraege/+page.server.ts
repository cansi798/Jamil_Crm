import type { PageServerLoad } from './$types';
import { listeAuftraege, MAX_AUFTRAEGE, sichtVon } from '$lib/server/auftraege';
import { SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istStatus } from '$lib/auftrag-status';

/**
 * Auftragsliste mit Status-Reitern (`?status=`, unbekannt → alle) und Suche (`?suche=`, zu lang → gekürzt).
 * Mit nur `auftraege.lesen` erscheinen nur die eigenen Aufträge.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	const roh = url.searchParams.get('status');
	const status = istStatus(roh) ? roh : null;
	const suche = (url.searchParams.get('suche') ?? '').slice(0, SUCHE_MAX_ZEICHEN);
	const auftraege = await alsSeitenFehler(() =>
		listeAuftraege(k, sichtVon(nutzer), { status: status ?? undefined, suche })
	);
	return {
		status,
		suche,
		auftraege,
		maxTreffer: MAX_AUFTRAEGE,
		alle: hatRecht(nutzer, 'auftraege.alle_lesen'),
		darfBearbeiten: hatRecht(nutzer, 'auftraege.bearbeiten')
	};
};
