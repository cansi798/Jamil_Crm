import { error } from '@sveltejs/kit';
import { hatRecht } from './rechte';
import { seitenZugriff } from './seite';
import { siehtKennzahlen } from './kennzahlen';
import { moduleDesBetriebs } from './tarif';
import { sichtVon } from './auftraege';
import { istZeitraumArt, zeitraum } from '../kennzahlen';
import { berlinTag } from '../zeit';
import { belegSuche } from '../ausgangsbelege';

/**
 * Gemeinsamer Anfang jeder Ausgangsbelege-Seite (Jamil msgs 2948, 3054–3056): gleiche Rechte (Modul „angebote“,
 * „Angebote bearbeiten“ und „Preise sehen“ – alle Belege enthalten Preise → sonst 403), gleiche Adressen-Parameter
 * (`suche`, `zeitraum`) und dieselbe Entscheidung, ob Kennzahlen gezeigt werden.
 */
export async function belegSeite(locals: App.Locals, url: URL) {
	const k = await seitenZugriff(locals, 'angebote', 'angebote.bearbeiten');
	if (!hatRecht(locals.nutzer!, 'preise.sehen')) error(403, 'Keine Berechtigung');
	const zRoh = url.searchParams.get('zeitraum');
	const z = zeitraum(istZeitraumArt(zRoh) ? zRoh : 'monat', berlinTag(new Date()));
	const module = await moduleDesBetriebs(k);
	return {
		k,
		sicht: sichtVon(locals.nutzer!),
		z,
		suche: belegSuche(url),
		kennzahlenAn: siehtKennzahlen(locals.nutzer!, module)
	};
}
