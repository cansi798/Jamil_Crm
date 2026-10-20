import type { PageServerLoad } from './$types';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { ladeAuslastung, monatText, pruefeMonat } from '$lib/server/auslastung';
import { istMonat, monatPlus } from '$lib/auslastung';

/**
 * Auslastung je Mitarbeiter und Monat (Wunsch Jamil msg 2476, Punkt 4) – wer die ganze Plantafel sieht. Break-even
 * (Umsatz, Kosten, Ergebnis) nur mit „Preise sehen“. Monat `?monat=JJJJ-MM`, Standard: dieser Monat.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await seitenZugriff(locals, 'plantafel', ['plantafel.bearbeiten', 'auftraege.alle_lesen']);
	const roh = url.searchParams.get('monat');
	const monat = istMonat(roh) ? roh : pruefeMonat(null);
	const mitGeld = hatRecht(locals.nutzer!, 'preise.sehen');
	const a = await alsSeitenFehler(() => ladeAuslastung(k, monat, { mitGeld }));
	return {
		...a,
		monatText: monatText(monat),
		vorher: monatPlus(monat, -1),
		nachher: monatPlus(monat, 1),
		mitGeld,
		darfKalkulation: mitGeld && hatRecht(locals.nutzer!, 'einstellungen')
	};
};
