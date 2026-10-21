import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { meineEinsaetzeHeute } from '$lib/server/plantafel';
import { hatRecht } from '$lib/server/rechte';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { berlinTag } from '$lib/zeit';
import { planPersonen, tagesplan, zeitraumTage } from '$lib/server/tagesplan';
import { dieserMonat, ladeAuslastung } from '$lib/server/auslastung';
import { gewinnSatz } from '$lib/auslastung';
import { laufend } from '$lib/server/zeiterfassung';
import { linksZuAuftraegen } from '$lib/server/auftrag-links';
import { sichtVon } from '$lib/server/auftraege';
import { ohneAusgeschalteteKacheln, siehtKennzahlen } from '$lib/server/kennzahlen';
import { startCockpit, type StartCockpit } from '$lib/server/start-cockpit';
import { ablaufendeNachweise, erlaubteKacheln, ladeStartLayout, loescheStartLayout, neueBuchungen, speichereStartLayout, startRolle, type AblaufenderNachweis, type NeueBuchung } from '$lib/server/start-layout';
import { KACHEL_ARTEN, LayoutFehler, pruefeLayout, standardLayout, type StartLayout } from '$lib/start-kacheln';

/** Kacheln, die Daten aus dem Start-Cockpit brauchen */
const COCKPIT_KACHELN = new Set(['handlung', 'nachfassen', 'kennzahlen', 'auslastung', 'quellen']);

/**
 * Startseite. Plattform-Admins haben keinen Betrieb und damit keine fachliche Startseite – sie landen in der
 * Plattform-Verwaltung. Für Betriebsnutzer: „Meine Einsätze heute“ (Modul `plantafel` und Leserecht für Aufträge;
 * `null` = Bereich ausblenden), Schnellsuche und „+ Kunde“, wenn Modul und Recht vorhanden sind.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const nutzer = locals.nutzer;
	if (nutzer?.istAdmin && nutzer.betriebId === null) redirect(303, '/admin');
	const { navigation } = await parent();
	const kunden = navigation?.haupt.some((e) => e.symbol === 'kunden') ?? false;
	const jetzt = new Date();
	let heute = null;
	let plan = null;
	let personen: { id: string; name: string }[] = [];
	// Zeiterfassung auf „Heute“ (Wunsch Jamil msgs 2770–2774): Start/Abfahrt je Auftrag von heute
	let zeit: { laufend: Awaited<ReturnType<typeof laufend>>; auftraege: { id: string; nummer: string; titel: string; kunde: string; zeit: string }[] } | null = null;
	// Start-Cockpit (Jamil msg 2813): Kennzahlen, Handlungsbedarf, Auslastung, Umsatz je Quelle – Chef/Büro
	let cockpit: StartCockpit | null = null;
	let monat: { satz: string; erreicht: boolean; kalkulationFehlt: boolean; link: string } | null = null;
	// Frei zusammenstellbarer Start (msg 2942): nur Daten für Kacheln laden, die im Layout stehen und erlaubt sind
	let layout: StartLayout = [];
	let eigenesLayout = false;
	let standard: StartLayout = [];
	let katalog: { id: string; titel: string; beschreibung: string; gruppe: string; groesse: string; hoehe: number }[] = [];
	let buchungen: { anzahl: number; liste: NeueBuchung[] } | null = null;
	let nachweise: AblaufenderNachweis[] | null = null;
	if (nutzer?.betriebId) {
		const k0 = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
		const module0 = await moduleDesBetriebs(k0);
		// ausgeschaltete Kennzahlen (Einstellungen → Kennzahlen, msg 2946) weder im Katalog noch im Layout
		const erlaubt = await ohneAusgeschalteteKacheln(k0, erlaubteKacheln(nutzer, module0));
		const rolle = startRolle(nutzer);
		({ layout, eigenes: eigenesLayout } = await ladeStartLayout(k0, erlaubt, rolle));
		standard = standardLayout(rolle, erlaubt);
		katalog = KACHEL_ARTEN.filter((a) => erlaubt.has(a.id));
	}
	const brauche = new Set(layout.map((e) => e.id));
	if (nutzer?.betriebId && (hatRecht(nutzer, 'auftraege.lesen') || hatRecht(nutzer, 'auftraege.alle_lesen') || hatRecht(nutzer, 'auftraege.bearbeiten'))) {
		const k = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
		const module = await moduleDesBetriebs(k);
		if (module.includes('plantafel') && (brauche.has('heute') || brauche.has('zeiterfassung'))) heute = await meineEinsaetzeHeute(k, nutzer.id, jetzt);
		// Links der Aufträge (Jamil msg 2850) – für Monteure unterwegs
		if (heute?.length) {
			const ids = [...new Set(heute.map((e) => e.auftragId).filter((x): x is string => !!x))];
			const links = await linksZuAuftraegen(k, sichtVon(nutzer), ids);
			heute = heute.map((e) => ({ ...e, links: e.auftragId ? (links.get(e.auftragId) ?? []).map(({ titel, url, domain }) => ({ titel, url, domain })) : [] }));
		}
		// Kachel „Diesen Monat: X € Gewinn verplant, Y Stunden frei“ (Wunsch Jamil msg 2476, Punkt 5) – nur „Preise sehen“
		if (brauche.has('monat') && module.includes('plantafel') && hatRecht(nutzer, 'preise.sehen')) {
			const m = dieserMonat(jetzt);
			const a = await ladeAuslastung(k, m, { mitGeld: true });
			monat = {
				satz: gewinnSatz(a.geld!.ergebnisCent, a.kalkulationFehlt ? null : a.summe.frei),
				erreicht: a.geld!.erreicht,
				kalkulationFehlt: a.kalkulationFehlt,
				link: '/plantafel/auslastung'
			};
		}
		if (brauche.has('zeiterfassung') && module.includes('zeiterfassung') && (hatRecht(nutzer, 'zeiterfassung.nutzen') || hatRecht(nutzer, 'zeiterfassung.alle_sehen'))) {
			const einsaetze = heute ?? (module.includes('plantafel') ? await meineEinsaetzeHeute(k, nutzer.id, jetzt) : []);
			const gesehen = new Set<string>();
			const auftraege = [];
			for (const e of einsaetze) {
				if (!e.auftragId || gesehen.has(e.auftragId)) continue;
				gesehen.add(e.auftragId);
				auftraege.push({ id: e.auftragId, nummer: e.auftragNummer ?? '', titel: e.auftragTitel ?? '', kunde: e.kundeName ?? '', zeit: e.beginn });
			}
			const lauf = await laufend(k, nutzer.id);
			if (lauf && !gesehen.has(lauf.auftragId)) {
				auftraege.unshift({ id: lauf.auftragId, nummer: lauf.auftragNummer ?? '', titel: lauf.auftragTitel ?? '', kunde: '', zeit: lauf.beginn });
			}
			zeit = { laufend: lauf, auftraege };
		}
		if (siehtKennzahlen(nutzer, module) && layout.some((e) => COCKPIT_KACHELN.has(e.id) || e.id.startsWith('kz-'))) {
			cockpit = await startCockpit(k, sichtVon(nutzer), { preise: hatRecht(nutzer, 'preise.sehen') && module.includes('angebote') }, jetzt);
		}
		// Kachel „Heute“ (Wunsch Jamil msg 2647): Termine, Aufgaben, Nachfassen – Chef/Büro mit Personenwahl
		if (brauche.has('buchungen')) buchungen = await neueBuchungen(k, jetzt);
		if (brauche.has('nachweise') && hatRecht(nutzer, 'partner.verwalten')) nachweise = await ablaufendeNachweise(k, berlinTag(jetzt));
		if (brauche.has('heute') && module.includes('auftraege')) {
			personen = await planPersonen(k, nutzer);
			const gewaehlt = url.searchParams.get('person');
			const person = gewaehlt && personen.some((p) => p.id === gewaehlt) ? gewaehlt : nutzer.id;
			plan = await tagesplan(k, nutzer, person, zeitraumTage('heute', berlinTag(jetzt)), { jetzt });
		}
	}
	return {
		kunden,
		heute,
		plan,
		monat,
		zeit,
		cockpit,
		buchungen,
		nachweise,
		layout,
		eigenesLayout,
		standard,
		katalog,
		personen: personen.length > 1 ? personen : [],
		heuteTag: berlinTag(jetzt),
		benutzerId: nutzer?.id ?? null
	};
};

/** Start-Layout speichern bzw. auf die Vorgabe der Rolle zurücksetzen (nur das eigene; RLS). */
async function startKontext(locals: App.Locals) {
	const nutzer = locals.nutzer;
	if (!nutzer?.betriebId) return null;
	const k = { betriebId: nutzer.betriebId, benutzerId: nutzer.id };
	return { k, erlaubt: await ohneAusgeschalteteKacheln(k, erlaubteKacheln(nutzer, await moduleDesBetriebs(k))) };
}

export const actions: Actions = {
	layout: async ({ locals, request }) => {
		const z = await startKontext(locals);
		if (!z) return fail(403, { layoutFehler: 'Keine Berechtigung.' });
		const roh = (await request.formData()).get('layout');
		let layout: StartLayout;
		try {
			layout = pruefeLayout(typeof roh === 'string' && roh.length <= 20_000 ? JSON.parse(roh) : null, z.erlaubt);
		} catch (e) {
			return fail(400, { layoutFehler: e instanceof LayoutFehler ? e.message : 'Ungültiges Layout.' });
		}
		await speichereStartLayout(z.k, layout);
		return { layoutGespeichert: true };
	},
	standard: async ({ locals }) => {
		const z = await startKontext(locals);
		if (!z) return fail(403, { layoutFehler: 'Keine Berechtigung.' });
		await loescheStartLayout(z.k);
		return { layoutGespeichert: true };
	}
};
