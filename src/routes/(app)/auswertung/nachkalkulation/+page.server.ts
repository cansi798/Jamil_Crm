import type { Actions, PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { auswertung, GRUPPEN, istGruppe, nachkalkZugriff, uebernimmMinuten } from '$lib/server/nachkalkulation';
import { darf } from '$lib/server/tarif';
import { hatRecht } from '$lib/server/rechte';
import { berlinTag, istTag, tagPlus } from '$lib/zeit';

/**
 * Auswertung Nachkalkulation (Wunsch Jamil msgs 2770–2774, Punkt 1): Aufträge mit Zeit im Zeitraum, gruppiert nach
 * Gewerk, Leistung, Auftragsquelle oder Mitarbeiter – zeigt, welche Auftragsarten Geld verlieren. Lernvorschläge für
 * „Minuten pro Einheit“ übernimmt der Chef je Position (nichts automatisch).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.nutzer) error(401, 'Nicht angemeldet');
	const k = await alsSeitenFehler(() => nachkalkZugriff(locals));
	return alsSeitenFehler(async () => {
		const heute = berlinTag(new Date());
		const vonP = url.searchParams.get('von');
		const bisP = url.searchParams.get('bis');
		const von = istTag(vonP) ? vonP : tagPlus(heute, -90);
		const bis = istTag(bisP) && bisP >= von ? bisP : heute;
		const g = url.searchParams.get('gruppe');
		const a = await auswertung(k, { von, bis, gruppe: istGruppe(g) ? g : 'gewerk' });
		return { a, gruppen: GRUPPEN, darfKatalog: hatRecht(locals.nutzer!, 'katalog.bearbeiten') };
	});
};

export const actions: Actions = {
	/** Lernvorschlag übernehmen: neue Minuten je Einheit für eine Katalogposition (Recht „Katalog bearbeiten“). */
	uebernehmen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await nachkalkZugriff(locals);
			await darf(locals, 'katalog', 'katalog.bearbeiten');
			await uebernimmMinuten(k, f.get('id'), f.get('minuten'));
			return { meldung: 'Minuten je Einheit im Katalog übernommen.' };
		} catch (e) {
			return alsFormFehler(e, { lernFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	}
};
