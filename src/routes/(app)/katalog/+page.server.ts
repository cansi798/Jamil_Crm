import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { katalogAendern, listeKatalog, listeVorlagen, MAX_KATALOG, uebernimmVorlagen } from '$lib/server/katalog';
import { SUCHE_MAX_ZEICHEN } from '$lib/server/kunden';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { istGewerk } from '$lib/katalog-werte';
import { ladeKalkulation } from '$lib/server/kalkulation';
import { lohnAusMinuten, minutenJeEinheit, unterKostendeckend } from '$lib/kalkulation';

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
	// Vorschlag aus der Kalkulation (nur wer sie sehen darf): Firmenschnitt für Lohn-Positionen je Stunde – nur Hinweis,
	// überschreibt nichts
	const kalkulation =
		mitPreisen && hatRecht(nutzer, 'einstellungen') ? (await ladeKalkulation(k)).uebersicht : null;
	const stundensatz =
		kalkulation && kalkulation.empfohlenCent !== null
			? { empfohlenCent: kalkulation.empfohlenCent, kostendeckendCent: kalkulation.kostendeckendCent }
			: null;
	// Positionen, deren Lohn unter Arbeitszeit × Kosten-Stundensatz liegt (Wunsch Jamil, msg 2476) – über den ganzen Katalog
	let unterKosten: { id: string; bezeichnung: string; einheit: string; lohnCent: number; mindestCent: number }[] = [];
	let ohneArbeitszeit = 0;
	if (stundensatz && stundensatz.kostendeckendCent !== null) {
		const satz = stundensatz.kostendeckendCent;
		const alle = await listeKatalog(k, {}, true);
		for (const p of alle.filter((x) => x.aktiv)) {
			const lohn = p.lohnCent ?? 0;
			const unter = unterKostendeckend({ einheit: p.einheit, arbeitMinuten: p.arbeitMinuten, lohnCent: lohn }, satz);
			if (unter === null) ohneArbeitszeit++;
			else if (unter) {
				const minuten = minutenJeEinheit(p.einheit, p.arbeitMinuten)!;
				unterKosten.push({ id: p.id, bezeichnung: p.bezeichnung, einheit: p.einheit, lohnCent: lohn, mindestCent: lohnAusMinuten(minuten, satz) });
			}
		}
	}
	return {
		positionen,
		gewerk,
		suche,
		mitPreisen,
		darfBearbeiten,
		vorlagen,
		maxTreffer: MAX_KATALOG,
		stundensatz,
		unterKosten,
		ohneArbeitszeit
	};
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
