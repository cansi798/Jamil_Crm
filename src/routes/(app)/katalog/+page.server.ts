import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { katalogAendern, listeKatalog, listeVorlagen, MAX_KATALOG, uebernimmVorlagen } from '$lib/server/katalog';
import { SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istGewerk } from '$lib/katalog-werte';

/** Katalog: Suche (`?suche=`), Filter Gewerk (`?gewerk=`), Startvorlagen übernehmen (nur `katalog.bearbeiten`). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'katalog', ['katalog.bearbeiten', 'angebote.bearbeiten']);
	const nutzer = locals.nutzer!;
	const mitPreisen = hatRecht(nutzer, 'preise.sehen');
	const darfBearbeiten = hatRecht(nutzer, 'katalog.bearbeiten');
	const roh = url.searchParams.get('gewerk');
	const gewerk = istGewerk(roh) ? roh : null;
	const suche = (url.searchParams.get('suche') ?? '').slice(0, SUCHE_MAX_ZEICHEN);
	const positionen = await alsSeitenFehler(() => listeKatalog(k, { suche, gewerk: gewerk ?? undefined }, mitPreisen));
	const vorlagen = darfBearbeiten
		? (await listeVorlagen(k)).map(({ gewerk, name, anzahl, offen }) => ({ gewerk, name, anzahl, offen }))
		: [];
	return { positionen, gewerk, suche, mitPreisen, darfBearbeiten, vorlagen, maxTreffer: MAX_KATALOG };
};

export const actions: Actions = {
	/** Startvorlage eines Gewerks übernehmen (Preis 0, schon übernommene werden übersprungen). */
	vorlage: async ({ locals, request }) => {
		const gewerk = (await request.formData()).get('gewerk');
		try {
			await katalogAendern(locals);
			return { uebernommen: await uebernimmVorlagen(betriebKontext(locals), gewerk) };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
