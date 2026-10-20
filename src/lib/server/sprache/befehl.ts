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
import { monatAusName, monatName } from '../../kalender';
import { euro } from '../../geld';
import { firmenStart, termineAlsStopps } from '../karte';
import { listeAuftraege, sichtVon } from '../auftraege';
import { nachfassenAbzeichen } from '../../auftrag-hinweise';
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
	'den Auftragsstatus und die Auftragsquelle ändern, To-dos abhaken, Nachfassen pausieren, Angebotsentwürfe erstellen, Protokolle starten – und sagen, was heute ansteht, ' +
	'wie die Auslastung ist, wie viel Gewinn diesen Monat verplant ist, wo Nachfassen fällig ist, wie ein Auftrag gelaufen ist und welche Aufträge Verlust machen.';

/** Aufträge zum gesprochenen Namen – auch abgerechnete (für Nachkalkulation, Portal, Foto-Aufmaß). */
async function sucheAuftraege(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, text: string, alle: boolean) {
	const suche = text
		.replace(/\b(?:auftrag|auftrags|kunde|kundin|familie|firma|baustelle|bei|beim|für|fuer|von|der|die|das|den|dem)\b/gi, ' ')
		.replace(/[?.!,]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
	if (suche === '') return [];
	return listeAuftraege(k, alle ? { alle: true, benutzerId: nutzer.id } : sichtVon(nutzer), { suche });
}

const karteVon = (aktion: Karte['aktion'], titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
	aktion, titel, zeilen: [], auswahl: [], warnungen: [], fehler, aendern: null, ...(antwort ? { antwort } : {})
});

/** „Wie lief der Auftrag Müller?“ – Plan gegen Ist mit Ampel (Nachkalkulation). */
async function beantworteNachkalkulation(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, auftrag: string): Promise<Karte> {
	const { nachkalkulationAuftrag, nachkalkZugriff } = await import('../nachkalkulation');
	// Gleiche Schranke wie die Seite (Preise sehen + alle Aufträge + Modul) – zusätzlich zur Prüfung in rechte.ts
	const gesperrt = await nachkalkZugriff({ nutzer }).then(() => null, (e) => (e instanceof ApiFehler ? e.message : 'Dafür fehlt Ihnen die Berechtigung'));
	if (gesperrt) return karteVon('abfrage_nachkalkulation', 'Nachkalkulation', gesperrt === 'Im aktuellen Tarif nicht enthalten' ? gesperrt : 'Dafür fehlt Ihnen die Berechtigung');
	const treffer = await sucheAuftraege(k, nutzer, auftrag, hatRecht(nutzer, 'auftraege.alle_lesen'));
	if (treffer.length === 0) return karteVon('abfrage_nachkalkulation', 'Nachkalkulation', `Keinen Auftrag zu „${auftrag}“ gefunden.`);
	if (treffer.length > 1) {
		return karteVon('abfrage_nachkalkulation', 'Welcher Auftrag?', null, {
			abschnitte: [{ titel: 'Aufträge', eintraege: treffer.slice(0, 8).map((a) => ({ zeit: '', titel: `${a.nummer} ${a.titel} – ${a.kundeName}`, ort: null, link: `/auftraege/${a.id}#nachkalkulation`, ueberfaellig: false })) }],
			vorlesen: `Ich habe ${treffer.length} passende Aufträge gefunden – bitte einen antippen.`
		});
	}
	const a = treffer[0];
	const nk = await nachkalkulationAuftrag(k, a.id, sichtVon(nutzer));
	const std = (h: number) => `${String(h).replace('.', ',')} Stunden`;
	const AMPEL = { rot: 'Verlust', gelb: 'deckt gerade die Kosten', gruen: 'mit Gewinn' } as const;
	const zeilen = [
		`Stunden: geplant ${std(nk.plan.stunden)}, gebraucht ${std(nk.ist.stunden)}${nk.ist.fahrtStunden ? ` plus ${std(nk.ist.fahrtStunden)} Fahrt` : ''}`,
		`Material: geplant ${euro(nk.plan.materialCent)}, Ist ${euro(nk.ist.materialCent)}`,
		`Gewinn: geplant ${nk.plan.gewinnCent === null ? '–' : euro(nk.plan.gewinnCent)}, Ist ${nk.ist.gewinnCent === null ? '–' : euro(nk.ist.gewinnCent)}`
	];
	const vorlesen = `${a.titel}: geplant ${std(nk.plan.stunden)}, gebraucht ${std(nk.ist.stunden)}. ${nk.ist.gewinnCent === null ? 'Gewinn unbekannt, die Kalkulation fehlt.' : `Gewinn ${euro(nk.ist.gewinnCent)}`}${nk.ampel ? ` – ${AMPEL[nk.ampel]}.` : '.'}`;
	return karteVon('abfrage_nachkalkulation', `Nachkalkulation ${a.nummer}${nk.ampel ? ` · ${AMPEL[nk.ampel]}` : ''}`, null, {
		oeffnen: `/auftraege/${a.id}#nachkalkulation`,
		abschnitte: [
			{ titel: `${a.nummer} ${a.titel} – ${a.kundeName}`, eintraege: zeilen.map((z) => ({ zeit: '', titel: z, ort: null, link: `/auftraege/${a.id}#nachkalkulation`, ueberfaellig: nk.ampel === 'rot' })) },
			...(nk.hinweise.length ? [{ titel: 'Hinweise', eintraege: nk.hinweise.map((h) => ({ zeit: '', titel: h, ort: null, link: '/kalkulation', ueberfaellig: false })) }] : [])
		],
		vorlesen
	});
}

/** „Welche Aufträge machen Verlust?“ – letzte 90 Tage, schlechteste zuerst. */
async function beantworteVerlust(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer): Promise<Karte> {
	const { verlustAuftraege, nachkalkZugriff } = await import('../nachkalkulation');
	const gesperrt = await nachkalkZugriff({ nutzer }).then(() => null, (e) => (e instanceof ApiFehler ? e.message : 'Dafür fehlt Ihnen die Berechtigung'));
	if (gesperrt) return karteVon('abfrage_verlust', 'Aufträge mit Verlust', gesperrt === 'Im aktuellen Tarif nicht enthalten' ? gesperrt : 'Dafür fehlt Ihnen die Berechtigung');
	const liste = await verlustAuftraege(k, 90);
	const vorlesen = liste.length === 0 ? 'In den letzten 90 Tagen hat kein Auftrag Verlust gemacht.' : `${liste.length} Auftr${liste.length === 1 ? 'ag macht' : 'äge machen'} Verlust, am meisten ${liste[0].kundeName} mit ${euro(-(liste[0].nk.ist.gewinnCent ?? 0))}.`;
	return karteVon('abfrage_verlust', 'Aufträge mit Verlust (90 Tage)', null, {
		oeffnen: '/auswertung/nachkalkulation',
		abschnitte: [{ titel: 'Aufträge', eintraege: liste.slice(0, 10).map((a) => ({ zeit: euro(a.nk.ist.gewinnCent ?? 0), titel: `${a.nummer} ${a.titel} – ${a.kundeName}`, ort: null, link: `/auftraege/${a.id}#nachkalkulation`, ueberfaellig: true })) }],
		vorlesen
	});
}

/** „Kundenportal für Müller“ bzw. „Foto-Aufmaß für Müller“: Auftrag finden und die Stelle öffnen. */
async function beantworteAuftragsLink(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, aktion: 'portallink_zeigen' | 'foto_aufmass', auftrag: string): Promise<Karte> {
	const titel = aktion === 'portallink_zeigen' ? 'Kundenportal' : 'Foto-Aufmaß';
	const ziel = (id: string) => (aktion === 'portallink_zeigen' ? `/auftraege/${id}#kundenportal` : `/auftraege/${id}/foto-aufmass`);
	const treffer = await sucheAuftraege(k, nutzer, auftrag, false);
	if (treffer.length === 0) return karteVon(aktion, titel, `Keinen Auftrag zu „${auftrag}“ gefunden.`);
	return karteVon(aktion, treffer.length === 1 ? `${titel} ${treffer[0].nummer}` : `${titel} – welcher Auftrag?`, null, {
		...(treffer.length === 1 ? { oeffnen: ziel(treffer[0].id) } : {}),
		abschnitte: [{ titel: 'Aufträge', eintraege: treffer.slice(0, 8).map((a) => ({ zeit: '', titel: `${a.nummer} ${a.titel} – ${a.kundeName}`, ort: null, link: ziel(a.id), ueberfaellig: false })) }],
		vorlesen: treffer.length === 1 ? `${titel} für ${treffer[0].titel} – tippe auf Öffnen.` : `Ich habe ${treffer.length} passende Aufträge gefunden.`
	});
}

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

/** „Zeig mir den Kalender von Kolonne 3 im November“ (Wunsch Jamil msg 2676): öffnet die gefilterte Plantafel. */
async function beantworteKalender(
	k: { betriebId: string; benutzerId: string },
	nutzer: Nutzer,
	d: { wer?: string; monat?: string; ansicht?: 'monat' | 'woche' | 'tag' },
	jetzt: Date
): Promise<Karte> {
	const heute = berlinTag(jetzt);
	const karte = (titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
		aktion: 'kalender_zeigen', titel, zeilen: [], auswahl: [], warnungen: [], fehler, aendern: null, ...(antwort ? { antwort } : {})
	});
	const m = (d.monat ?? '').trim().toLowerCase();
	const monat = !m || m === 'dieser' ? heute.slice(0, 7) : m === 'naechster' || m === 'nächster' ? monatPlus(heute.slice(0, 7), 1) : m === 'letzter' ? monatPlus(heute.slice(0, 7), -1) : monatAusName(m, heute);
	if (!monat) return karte('Kalender', `Monat „${d.monat}“ nicht verstanden.`);
	const p = new URLSearchParams();
	if (d.ansicht && d.ansicht !== 'monat') p.set('ansicht', d.ansicht);
	p.set('tag', monat === heute.slice(0, 7) ? heute : `${monat}-01`);
	let wer = 'alle';
	if (d.wer) {
		const x = await personAufloesen(k, nutzer, d.wer);
		if (x.kolonne) {
			p.append('ko', x.kolonne.id);
			wer = x.kolonne.name;
		} else if (x.id) {
			p.append('ma', x.id);
			wer = x.id === nutzer.id ? 'meine' : d.wer;
		} else return karte('Kalender', x.frage);
	}
	const link = `/plantafel?${p.toString()}`;
	const was = `${wer === 'alle' ? 'Kalender' : wer === 'meine' ? 'Mein Kalender' : `Kalender ${wer}`} · ${monatName(monat)}`;
	return karte(was, null, {
		oeffnen: link,
		abschnitte: [{ titel: 'Öffnen', eintraege: [{ zeit: '', titel: `${was} öffnen`, ort: null, link, ueberfaellig: false }] }],
		vorlesen: `Ich öffne ${wer === 'alle' ? 'den Kalender' : wer === 'meine' ? 'deinen Kalender' : `den Kalender von ${wer}`} für ${monatName(monat)}.`
	});
}

/**
 * „Buchungslink für Besichtigung“ (Online-Buchung, msgs 2684/2686): zeigt den Link des Dienstes (alle Mitarbeiter) zum
 * Kopieren und Öffnen; ohne Namen alle aktiven Dienste.
 */
async function beantworteBuchungslink(k: { betriebId: string; benutzerId: string }, d: { dienst?: string }): Promise<Karte> {
	const { listeDienste } = await import('../buchung');
	const basis = (process.env.ORIGIN ?? '').replace(/\/$/, '');
	const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\b(termin|termine|dienst)\b/g, ' ').replace(/\s+/g, ' ').trim();
	const alle = (await listeDienste(k)).filter((x) => x.aktiv);
	const g = d.dienst ? norm(d.dienst) : '';
	const genau = alle.filter((x) => norm(x.name) === g);
	const treffer = !g ? alle : genau.length > 0 ? genau : alle.filter((x) => norm(x.name).includes(g) || g.includes(norm(x.name)));
	const karte = (titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
		aktion: 'buchungslink_zeigen', titel, zeilen: [], auswahl: [], warnungen: [], fehler, aendern: '/einstellungen/online-buchung', ...(antwort ? { antwort } : {})
	});
	if (treffer.length === 0) return karte('Buchungslink', d.dienst ? `Keinen aktiven Dienst „${d.dienst}“ gefunden.` : 'Es gibt noch keinen aktiven Dienst.');
	const linkVon = (x: (typeof alle)[number]) => {
		const l = x.links.find((y) => !y.benutzerId && y.aktiv) ?? x.links.find((y) => y.aktiv);
		return l ? `${basis}/buchen/${l.token}` : null;
	};
	const eintraege = treffer.flatMap((x) => {
		const url = linkVon(x);
		return url ? [{ zeit: '', titel: `${x.name} – Buchungsseite öffnen`, ort: url, link: url, ueberfaellig: false }] : [];
	});
	const erster = linkVon(treffer[0]);
	return karte(treffer.length === 1 ? `Buchungslink „${treffer[0].name}“` : 'Buchungslinks', null, {
		abschnitte: [
			{ titel: 'Links', eintraege },
			{ titel: 'Einstellungen', eintraege: treffer.map((x) => ({ zeit: '', titel: `${x.name} bearbeiten (Einbett-Code)`, ort: null, link: `/einstellungen/online-buchung/${x.id}`, ueberfaellig: false })) }
		],
		...(treffer.length === 1 && erster ? { kopieren: erster } : {}),
		vorlesen: treffer.length === 1 ? `Hier ist der Buchungslink für ${treffer[0].name}. Tippe auf Kopieren.` : `Ich habe ${treffer.length} Buchungslinks gefunden.`
	});
}

/** „Wo muss ich nachfassen?“ (Wunsch Jamil msg 2674): Aufträge mit Nachfassen heute oder überfällig (nicht pausiert). */
async function beantworteNachfassen(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, jetzt: Date): Promise<Karte> {
	const heute = berlinTag(jetzt);
	const liste = await listeAuftraege(k, sichtVon(nutzer), { nachfassenFaellig: true });
	const link = '/auftraege?ansicht=liste&nachfassen=faellig';
	const eintraege = liste.map((a) => ({
		zeit: nachfassenAbzeichen(a.nachfassenInfo, heute)?.text.replace('Nachfassen: ', '') ?? '',
		titel: `${a.nummer} ${a.titel} – ${a.kundeName}`,
		ort: null,
		link: `/auftraege/${a.id}`,
		ueberfaellig: !!a.nachfassenInfo && a.nachfassenInfo.tag < heute
	}));
	const vorlesen =
		liste.length === 0
			? 'Heute ist kein Nachfassen fällig.'
			: `Nachfassen fällig bei ${liste.length} Auftr${liste.length === 1 ? 'ag' : 'ägen'}: ${liste.map((a) => a.kundeName).slice(0, 5).join(', ')}${liste.length > 5 ? ' und weiteren' : ''}.`;
	return {
		aktion: 'abfrage_nachfassen',
		titel: 'Nachfassen fällig',
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler: null,
		aendern: null,
		antwort: {
			abschnitte: [
				{ titel: 'Aufträge', eintraege },
				{ titel: 'Öffnen', eintraege: [{ zeit: '', titel: 'Liste „Nachfassen fällig“ öffnen', ort: null, link, ueberfaellig: false }] }
			],
			vorlesen
		}
	};
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
	// Eigener Termin für mich (msg 2682): Vorab-Prüfung mit dem schwächeren Recht; endgültig prüft das Ausführen
	const fuerMich = (m?: string[]) => !m || m.length === 0 || m.every((x) => /^(ich|mich|mir)$/i.test(x.trim()));
	const eigenerTermin = aktion.aktion === 'einsatz_anlegen' && (!!aktion.daten.eigener_titel || !aktion.daten.auftrag) && fuerMich(aktion.daten.mitarbeiter);
	const fehlt = await rechteHinweis(locals, aktion.aktion, { eigenerTermin });
	if (fehlt) return { text, vorschlag: null, karte: hinweisKarte(aktion.aktion, fehlt) };
	// „Route für heute“ (Wunsch Jamil msgs 2602/2645): Stopps + Links zur Karte und zu Google Maps
	if (aktion.aktion === 'route_heute') {
		return { text, vorschlag: null, karte: await beantworteRoute(k, nutzer, aktion.daten.wer) };
	}
	// Auslastung und Gewinn des Monats (Wunsch Jamil msg 2476, Punkte 4 und 5)
	if (aktion.aktion === 'abfrage_auslastung') {
		return { text, vorschlag: null, karte: await beantworteAuslastung(k, nutzer, aktion.daten, jetzt) };
	}
	if (aktion.aktion === 'buchungslink_zeigen') {
		return { text, vorschlag: null, karte: await beantworteBuchungslink(k, aktion.daten) };
	}
	if (aktion.aktion === 'abfrage_nachkalkulation') {
		return { text, vorschlag: null, karte: await beantworteNachkalkulation(k, nutzer, aktion.daten.auftrag) };
	}
	if (aktion.aktion === 'abfrage_verlust') {
		return { text, vorschlag: null, karte: await beantworteVerlust(k, nutzer) };
	}
	if (aktion.aktion === 'portallink_zeigen' || aktion.aktion === 'foto_aufmass') {
		return { text, vorschlag: null, karte: await beantworteAuftragsLink(k, nutzer, aktion.aktion, aktion.daten.auftrag) };
	}
	if (aktion.aktion === 'kalender_zeigen') {
		return { text, vorschlag: null, karte: await beantworteKalender(k, nutzer, aktion.daten, jetzt) };
	}
	if (aktion.aktion === 'abfrage_nachfassen') {
		return { text, vorschlag: null, karte: await beantworteNachfassen(k, nutzer, jetzt) };
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

/** Nur für Tests: die Antwort-Funktionen direkt (prüfen die Rechte selbst noch einmal). */
export const _fuerTests = { beantworteNachkalkulation, beantworteVerlust };
