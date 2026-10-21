import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hatRecht, betriebKontext } from '$lib/server/rechte';
import { ohnePreise } from '$lib/server/preisschutz';
import { alsSeitenFehler } from '$lib/server/seite';
import { auswertung, standardZeitraum } from '$lib/server/quellen';
import { istTag } from '$lib/zeit';

/**
 * Auswertung je Quelle (Wunsch Jamil msg 2593) – Chef/Admin („Einstellungen“); Umsatz und Ø Auftragswert nur mit
 * „Preise sehen“. Zeitraum `?von=&bis=` (Angelegt-Datum), Standard: letzte 12 Monate.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const std = standardZeitraum();
	const von = istTag(url.searchParams.get('von')) ? url.searchParams.get('von')! : std.von;
	const bisRoh = istTag(url.searchParams.get('bis')) ? url.searchParams.get('bis')! : std.bis;
	const bis = bisRoh < von ? von : bisRoh;
	const mitPreisen = hatRecht(locals.nutzer, 'preise.sehen');
	const zeilen = await alsSeitenFehler(() => auswertung(betriebKontext(locals), von, bis));
	return {
		von,
		bis,
		mitPreisen,
		// Preisschutz: ohne „Preise sehen“ fehlen Umsatz und Ø-Wert ganz
		zeilen: mitPreisen ? zeilen : ohnePreise(zeilen)
	};
};
