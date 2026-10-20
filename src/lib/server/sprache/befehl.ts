import { ApiFehler } from '../fehler';
import { betriebKontext, hatRecht } from '../rechte';
import { pruefeModul } from '../tarif';
import { kiAnbieter, kiKontext } from '../ki/anbieter';
import { verbrauche } from '../ki/kontingent';
import { hinweisKarte, loeseAuf, personAufloesen, type Karte } from './aufloesen';
import { darfPlanSehen, kolonnenplan, tagesplan, zeitraumTage } from '../tagesplan';
import { berlinTag } from '../../zeit';
import type { MonatRelativ, TagesplanDaten } from './aktionen';
import { dieserMonat, ladeAuslastung, monatText } from '../auslastung';
import { gewinnSatz, monatPlus, stundenText } from '../../auslastung';
import { euro } from '../../geld';
import { firmenStart, termineAlsStopps } from '../karte';
import { sichtVon } from '../auftraege';
import { googleRouteLink } from '../../route';
import { rechteHinweis } from './rechte';
import { signiere } from './vorschlag';

/**
 * Vom erkannten Text zur Bestätigungskarte: Modul `sprache` → Kontingent (eine KI-Anfrage) → KI liefert genau eine
 * Aktion → Rechte des Nutzers → Namen/Zeiten auflösen → signierter Vorschlag. Gespeichert wird hier nichts; der
 * Text wird nicht aufbewahrt. Ohne Berechtigung oder bei „unbekannt“ gibt es keinen Vorschlag, nur die Karte.
 */

export const MAX_BEFEHL_ZEICHEN = 2000;
export const UNBEKANNT_HINWEIS =
	'Ich kann Kunden, Aufträge, To-dos (auch wiederkehrende), Termine und Anlagen anlegen, Termine verschieben, Mitarbeiter zuweisen, ' +
	'den Auftragsstatus und die Quelle ändern, To-dos abhaken, Nachfassen pausieren, Angebotsentwürfe erstellen, Protokolle starten – und sagen, was heute ansteht, ' +
	'wie die Auslastung ist und wie viel Gewinn diesen Monat verplant ist.';

async function beantworteRoute(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, wer: string | undefined): Promise<Karte> {
	const karte = (titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
		aktion: 'route_heute',
		titel,
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null,
		...(antwort ? { antwort } : {})
	});
	const p = await personAufloesen(k, nutzer, wer);
	let ziel: { benutzerId?: string; kolonneId?: string };
	let name: string;
	let link: string;
	if (p.kolonne) {
		if (!hatRecht(nutzer, 'todos.alle_lesen') && !p.kolonne.mitglieder.some((m) => m.id === nutzer.id)) {
			return karte('Route für heute', 'Sie dürfen nur Ihre eigene Route und die Ihrer Kolonne sehen.');
		}
		ziel = { kolonneId: p.kolonne.id };
		name = p.kolonne.name;
		link = `/karte?route=heute&kolonne=${p.kolonne.id}`;
	} else if (p.id) {
		if (!darfPlanSehen(nutzer, p.id)) return karte('Route für heute', 'Sie dürfen nur Ihre eigene Route sehen.');
		ziel = { benutzerId: p.id };
		name = p.id === nutzer.id ? 'deine' : wer ?? '';
		link = p.id === nutzer.id ? '/karte?route=heute' : `/karte?route=heute&person=${p.id}`;
	} else return karte('Route für heute', p.frage);
	const stopps = await termineAlsStopps(k, sichtVon(nutzer), ziel);
	const start = await firmenStart(k);
	const google = googleRouteLink(start?.adresse ?? null, stopps.map((s) => s.adresse ?? '').filter(Boolean));
	const eintraege = stopps.map((s) => ({ zeit: s.zeit, titel: `${s.titel} – ${s.kundeName}`, ort: s.adresse, link: `/auftraege/${s.auftragId}`, ueberfaellig: false }));
	const links = [
		{ zeit: '', titel: 'Auf der Karte öffnen (Reihenfolge ändern)', ort: null, link, ueberfaellig: false },
		...(google ? [{ zeit: '', titel: 'In Google Maps öffnen', ort: null, link: google, ueberfaellig: false }] : [])
	];
	const vorlesen = stopps.length === 0
		? `Heute gibt es keine Termine für ${name === 'deine' ? 'dich' : name}.`
		: `Route für heute mit ${stopps.length} Stopp${stopps.length === 1 ? '' : 's'}: ${stopps.map((s) => `${s.zeit} ${s.kundeName}${s.adresse ? `, ${s.adresse}` : ''}`).join('; ')}.`;
	return karte(`Route für heute${name === 'deine' ? '' : ` – ${name}`}`, null, {
		abschnitte: [
			{ titel: 'Stopps', eintraege },
			...(stopps.length > 0 ? [{ titel: 'Öffnen', eintraege: links }] : [])
		],
		vorlesen
	});
}

const monatAus = (m: MonatRelativ | undefined, jetzt: Date) =>
	monatPlus(dieserMonat(jetzt), m === 'letzter' ? -1 : m === 'naechster' ? 1 : 0);

const leerKarte = (aktion: 'abfrage_auslastung' | 'abfrage_monatsgewinn', titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
	aktion,
	titel,
	zeilen: [],
	auswahl: [],
	warnungen: [],
	fehler,
	aendern: null,
	...(antwort ? { antwort } : {})
});

/** „Wie ist die Auslastung?“ / „Wie ausgelastet ist Murat im November?“ (Wunsch Jamil msg 2476, Punkt 4). */
async function beantworteAuslastung(
	k: { betriebId: string; benutzerId: string },
	nutzer: Nutzer,
	d: { wer?: string; monat?: MonatRelativ },
	jetzt: Date
): Promise<Karte> {
	const monat = monatAus(d.monat, jetzt);
	const mText = monatText(monat);
	const mitGeld = hatRecht(nutzer, 'preise.sehen');
	const a = await ladeAuslastung(k, monat, { mitGeld });
	let personen = a.personen;
	let wer = '';
	if (d.wer) {
		const p = await personAufloesen(k, nutzer, d.wer);
		if (p.kolonne) {
			const ids = new Set(p.kolonne.mitglieder.map((m) => m.id));
			personen = personen.filter((x) => x.benutzerId && ids.has(x.benutzerId));
			wer = p.kolonne.name;
		} else if (p.id) {
			personen = personen.filter((x) => x.benutzerId === p.id);
			wer = personen[0]?.name ?? d.wer;
		} else return leerKarte('abfrage_auslastung', 'Auslastung', p.frage);
	}
	const link = `/plantafel/auslastung?monat=${monat}`;
	const eintraege = personen.map((x) => ({
		zeit: x.auslastungProzent === null ? '–' : `${x.auslastungProzent} %`,
		titel: `${x.name}: ${stundenText(x.geplant)} h verplant${x.verfuegbar === null ? '' : ` von ${stundenText(x.verfuegbar)} h`}`,
		ort: x.frei === null ? (x.hinweis ?? null) : `${stundenText(x.frei)} h frei${x.ueberbucht ? ' – überbucht' : ''}`,
		link,
		ueberfaellig: x.ueberbucht
	}));
	let vorlesen: string;
	if (d.wer && personen.length === 1) {
		const x = personen[0];
		vorlesen =
			x.verfuegbar === null
				? `${x.name} hat im ${mText} ${stundenText(x.geplant)} Stunden verplant. Verfügbare Stunden sind unbekannt – ${x.name} fehlt in der Kalkulation.`
				: `${x.name} ist im ${mText} zu ${x.auslastungProzent ?? 0} Prozent ausgelastet: ${stundenText(x.geplant)} von ${stundenText(x.verfuegbar)} Stunden verplant, ${stundenText(x.frei ?? 0)} Stunden frei.`;
	} else if (d.wer && personen.length === 0) {
		vorlesen = `Für ${wer} gibt es im ${mText} keine Termine und keine Angaben in der Kalkulation.`;
	} else {
		const verplant = personen.filter((x) => x.verfuegbar !== null).reduce((s, x) => s + x.geplant, 0);
		const verfuegbar = personen.reduce((s, x) => s + (x.verfuegbar ?? 0), 0);
		const frei = personen.reduce((s, x) => s + (x.frei ?? 0), 0);
		vorlesen = a.kalkulationFehlt
			? `Im ${mText} sind ${stundenText(personen.reduce((s, x) => s + x.geplant, 0))} Stunden verplant. Ohne Mitarbeiter in der Kalkulation sind die verfügbaren Stunden unbekannt.`
			: `Im ${mText} sind ${stundenText(verplant)} von ${stundenText(verfuegbar)} Stunden verplant${verfuegbar > 0 ? ` (${Math.round((verplant / verfuegbar) * 100)} Prozent)` : ''}, ${stundenText(frei)} Stunden frei.`;
		if (a.geld && !d.wer) vorlesen += a.geld.erreicht ? ` Break-even erreicht: ${euro(a.geld.ergebnisCent)} Gewinn verplant.` : ` Break-even noch nicht erreicht: Es fehlen ${euro(-a.geld.ergebnisCent)}.`;
	}
	return leerKarte('abfrage_auslastung', `Auslastung ${mText}${wer ? ` – ${wer}` : ''}`, null, {
		abschnitte: [
			{ titel: 'Mitarbeiter', eintraege },
			{ titel: 'Öffnen', eintraege: [{ zeit: '', titel: 'Auslastung öffnen', ort: null, link, ueberfaellig: false }] }
		],
		vorlesen
	});
}

/** „Wie viel Gewinn haben wir diesen Monat verplant?“ (Wunsch Jamil msg 2476, Punkt 5) – nur mit „Preise sehen“. */
async function beantworteMonatsgewinn(k: { betriebId: string; benutzerId: string }, d: { monat?: MonatRelativ }, jetzt: Date): Promise<Karte> {
	const monat = monatAus(d.monat, jetzt);
	const mText = monatText(monat);
	const a = await ladeAuslastung(k, monat, { mitGeld: true });
	const g = a.geld!;
	const link = `/plantafel/auslastung?monat=${monat}`;
	const zeile = (titel: string, betrag: number) => ({ zeit: '', titel: `${titel}: ${euro(betrag)}`, ort: null, link, ueberfaellig: false });
	const frei = a.kalkulationFehlt ? null : a.summe.frei;
	const satz = gewinnSatz(g.ergebnisCent, frei);
	const vorlesen = `${d.monat && d.monat !== 'dieser' ? `Im ${mText}` : 'Diesen Monat'}: ${satz}.${
		a.kalkulationFehlt ? ' Achtung: In der Kalkulation fehlen noch Mitarbeiter – Kosten und freie Stunden sind unvollständig.' : ''
	}`;
	return leerKarte('abfrage_monatsgewinn', `Gewinn ${mText}`, null, {
		abschnitte: [
			{
				titel: g.erreicht ? 'Break-even erreicht' : 'Break-even noch nicht erreicht',
				eintraege: [
					zeile('Verplanter Umsatz', g.umsatzCent),
					zeile('Material', g.materialCent),
					zeile('Monatskosten', g.kostenCent),
					{ ...zeile('Ergebnis', g.ergebnisCent), ueberfaellig: !g.erreicht }
				]
			},
			{ titel: 'Öffnen', eintraege: [{ zeit: '', titel: 'Auslastung und Break-even öffnen', ort: null, link, ueberfaellig: false }] }
		],
		vorlesen
	});
}

/** Frage „Was steht heute an?“ beantworten (nur lesend, ohne Bestätigung). */
async function beantworteTagesplan(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, d: TagesplanDaten, jetzt: Date): Promise<Karte> {
	const karte = (titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
		aktion: 'abfrage_tagesplan',
		titel,
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null,
		...(antwort ? { antwort } : {})
	});
	const p = await personAufloesen(k, nutzer, d.wer);
	const z = zeitraumTage(d.zeitraum, berlinTag(jetzt), d.datum);
	if (p.kolonne) {
		try {
			const plan = await kolonnenplan(k, nutzer, p.kolonne, z);
			return karte(`Tagesplan ${z.text} – ${p.kolonne.name}`, null, { abschnitte: [{ titel: 'Termine', eintraege: plan.termine }], vorlesen: plan.text });
		} catch (e) {
			if (e instanceof ApiFehler && e.status === 403) return karte('Tagesplan', e.message);
			throw e;
		}
	}
	if (!p.id) return karte('Tagesplan', p.frage);
	try {
		const plan = await tagesplan(k, nutzer, p.id, z, { nurUeberfaellig: d.nur_ueberfaellig, jetzt });
		const abschnitte = d.nur_ueberfaellig
			? [{ titel: 'Überfällige To-dos', eintraege: [...plan.todos, ...plan.nachfassen] }]
			: [
					{ titel: 'Termine', eintraege: plan.termine },
					{ titel: 'To-dos', eintraege: plan.todos },
					{ titel: 'Nachfassen', eintraege: plan.nachfassen }
				].filter((a) => a.titel !== 'Nachfassen' || a.eintraege.length > 0);
		const wer = p.id === nutzer.id ? '' : ` – ${plan.person.name}`;
		return karte(d.nur_ueberfaellig ? `Überfällig${wer}` : `Tagesplan ${z.text}${wer}`, null, { abschnitte, vorlesen: plan.text });
	} catch (e) {
		if (e instanceof ApiFehler && (e.status === 403 || e.status === 404)) return karte('Tagesplan', e.message);
		throw e;
	}
}

export type Befehlsergebnis = { text: string; vorschlag: string | null; karte: Karte };

/** Prüft getippten Befehlstext (400 bei leer/zu lang/kein Text). */
export function pruefeBefehlText(w: unknown): string {
	if (typeof w !== 'string') throw new ApiFehler(400, 'Bitte einen Befehl eingeben.');
	const text = w.replaceAll('\u0000', '').replace(/\s+/g, ' ').trim();
	if (text === '') throw new ApiFehler(400, 'Bitte einen Befehl eingeben.');
	if ([...text].length > MAX_BEFEHL_ZEICHEN) throw new ApiFehler(400, `Der Befehl ist zu lang (höchstens ${MAX_BEFEHL_ZEICHEN} Zeichen).`);
	return text;
}

/** Modul `sprache` (+ angemeldet, Betrieb) – vor jedem weiteren Schritt. */
export async function pruefeSprachZugang(locals: { nutzer: Nutzer | null }): Promise<void> {
	betriebKontext(locals);
	await pruefeModul(locals, 'sprache');
}

export async function vorschlagAusText(locals: { nutzer: Nutzer | null }, text: string, jetzt = new Date()): Promise<Befehlsergebnis> {
	const k = betriebKontext(locals);
	const nutzer = locals.nutzer!;
	await verbrauche(k, 'aktion');
	const aktion = await kiAnbieter().aktionAusText(text, kiKontext(jetzt));
	if (aktion.aktion === 'unbekannt') {
		return { text, vorschlag: null, karte: hinweisKarte('unbekannt', UNBEKANNT_HINWEIS) };
	}
	const fehlt = await rechteHinweis(locals, aktion.aktion);
	if (fehlt) return { text, vorschlag: null, karte: hinweisKarte(aktion.aktion, fehlt) };
	// „Route für heute“ (Wunsch Jamil msgs 2602/2645): Stopps + Links zur Karte und zu Google Maps
	if (aktion.aktion === 'route_heute') {
		return { text, vorschlag: null, karte: await beantworteRoute(k, nutzer, aktion.daten.wer) };
	}
	// Auslastung und Gewinn des Monats (Wunsch Jamil msg 2476, Punkte 4 und 5)
	if (aktion.aktion === 'abfrage_auslastung') {
		return { text, vorschlag: null, karte: await beantworteAuslastung(k, nutzer, aktion.daten, jetzt) };
	}
	if (aktion.aktion === 'abfrage_monatsgewinn') {
		return { text, vorschlag: null, karte: await beantworteMonatsgewinn(k, aktion.daten, jetzt) };
	}
	// Fragen: sofort beantworten, kein Vorschlag, keine Bestätigung (Wunsch Jamil msg 2647)
	if (aktion.aktion === 'abfrage_tagesplan') {
		return { text, vorschlag: null, karte: await beantworteTagesplan(k, nutzer, aktion.daten, jetzt) };
	}
	const vorschau = await loeseAuf(k, nutzer, aktion, jetzt);
	if (aktion.aktion === 'auftrag_anlegen' && vorschau.werte.einsaetze?.length > 0) {
		const ohnePlanung = await rechteHinweis(locals, aktion.aktion, { mitEinsaetzen: true });
		if (ohnePlanung) {
			return {
				text,
				vorschlag: null,
				karte: { ...vorschau.karte, fehler: `${ohnePlanung} (Mitarbeiter einplanen).`, aendern: vorschau.karte.aendern }
			};
		}
	}
	// Baustellen-Protokoll (feste Typen) braucht „Protokolle bearbeiten“; eine Vorlage starten reicht „ausfüllen“
	if (aktion.aktion === 'protokoll_ausfuellen' && !vorschau.werte.formular) {
		const fehltRecht = await rechteHinweis(locals, aktion.aktion, { formular: false });
		if (fehltRecht) return { text, vorschlag: null, karte: { ...vorschau.karte, fehler: fehltRecht } };
	}
	const vorschlag =
		vorschau.fehlt.length > 0
			? null
			: signiere({ aktion: vorschau.aktion, werte: vorschau.werte, auswahl: vorschau.auswahl }, nutzer.id, k.betriebId);
	return { text, vorschlag, karte: vorschau.karte };
}
