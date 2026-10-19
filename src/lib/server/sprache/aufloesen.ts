import { mitBetrieb, type Kontext } from '../db';
import { ApiFehler } from '../fehler';
import { listeAuftraege, sichtVon, type Auftrag } from '../auftraege';
import { anzeigeName, listeKunden, pruefeKundeEingabe, type Kunde } from '../kunden';
import { kundeNameAus } from '../auftraege';
import { MAX_STUNDEN } from '../plantafel';
import { aktiveMitarbeiter } from '../todos';
import { berlinTag, berlinUhrzeit, ausTagUndUhrzeit, istTag, tagDeutsch, tagPlus, wochentag, verschiebeAufTag } from '../../zeit';
import {
	WOCHENTAGE,
	type AktionsName,
	type KiAktion,
	type Zeitangabe
} from './aktionen';

/**
 * Löst eine KI-Aktion in einen ausführbaren Vorschlag auf – mit den Rechten und der Sicht des Nutzers (RLS):
 * Namen → IDs (Kunden über die Kundensuche, Mitarbeiter über die aktiven Benutzer, Aufträge über die Auftragssuche),
 * relative Zeitangaben → Berliner Tage/Zeitpunkte. Mehrere Treffer ergeben eine Auswahl („Meinen Sie Kunde Müller in
 * Norderstedt oder in Hamburg?“), keiner einen Hinweis (`fehlt`). Gespeichert wird hier nichts.
 */

export type Option = { id: string; label: string };
export type Auswahl = { feld: string; frage: string; optionen: Option[] };
export type Zeile = { label: string; wert: string };

export type Karte = {
	aktion: AktionsName | 'unbekannt';
	titel: string;
	zeilen: Zeile[];
	auswahl: Auswahl[];
	warnungen: string[];
	/** Blockierender Hinweis (z. B. fehlende Berechtigung, Kunde nicht gefunden) – dann kein Speichern. */
	fehler: string | null;
	/** Link zum normalen Formular, so weit wie möglich vorausgefüllt („Ändern“). */
	aendern: string | null;
};

/** Ausführbare Werte je Aktion (IDs aufgelöst, Zeitpunkte als ISO). `null` an einer Stelle = offene Auswahl. */
export type Vorschau = {
	aktion: AktionsName;
	werte: Record<string, any>;
	auswahl: Auswahl[];
	fehlt: string[];
	warnungen: string[];
	karte: Karte;
};

export const STANDARD_BEGINN = '07:00';
export const STANDARD_DAUER_H = 8;
const MS_H = 3_600_000;

// ---------------------------------------------------------------------------------------------------------------
// Zeit

/** Relative Zeitangabe → Berliner Tag `YYYY-MM-DD`. „Montag“ = nächster Montag, heute ausgeschlossen. */
export function loeseTag(z: Zeitangabe, jetzt: Date): string {
	const heute = berlinTag(jetzt);
	switch (z.tag) {
		case 'heute':
			return heute;
		case 'morgen':
			return tagPlus(heute, 1);
		case 'uebermorgen':
			return tagPlus(heute, 2);
		case 'wochentag': {
			const ziel = WOCHENTAGE.indexOf(z.wochentag!);
			const abstand = ((ziel - wochentag(heute) + 7) % 7) || 7;
			return tagPlus(heute, abstand);
		}
		case 'datum':
			if (!istTag(z.datum)) throw new ApiFehler(400, 'Ungültiges Datum.');
			return z.datum;
	}
}

/** Zeitraum eines Einsatzes: Beginn (Standard 07:00), Ende aus „bis“ oder Beginn + 8 Stunden (Berlin-Zeit). */
export function einsatzZeitraum(tag: string, uhrzeit?: string, endeUhrzeit?: string): { beginn: Date; ende: Date } {
	const beginn = ausTagUndUhrzeit(tag, uhrzeit ?? STANDARD_BEGINN);
	const ende = endeUhrzeit ? ausTagUndUhrzeit(tag, endeUhrzeit) : new Date(beginn.getTime() + STANDARD_DAUER_H * MS_H);
	if (ende.getTime() <= beginn.getTime()) throw new ApiFehler(400, 'Ende muss nach dem Beginn liegen');
	if (ende.getTime() - beginn.getTime() > MAX_STUNDEN * MS_H) throw new ApiFehler(400, 'Ein Einsatz darf höchstens 14 Stunden dauern');
	return { beginn, ende };
}

const WOCHENTAG_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
/** „Montag, 19.10.2026“ */
export const tagLang = (tag: string) => `${WOCHENTAG_LANG[wochentag(tag)]}, ${tagDeutsch(tag)}`;
const zeitraumText = (b: Date, e: Date) =>
	`${tagLang(berlinTag(b))}, ${berlinUhrzeit(b)}–${berlinUhrzeit(e)}${berlinTag(e) !== berlinTag(b) ? ` (${tagDeutsch(berlinTag(e))})` : ''}`;

// ---------------------------------------------------------------------------------------------------------------
// Namen

const normal = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFC')
		.replace(/[^\p{L}\p{N}\s-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const woerter = (s: string) => normal(s).split(' ').filter(Boolean);

const ANREDE = /^(?:(?:den|dem|der|die)\s+)?(?:kunden?|kundin|familie|firma|herrn?|frau|auftrag|baustelle|bei|für)\s+/i;
function ohneAnrede(name: string): string {
	let n = name.trim();
	for (let i = 0; i < 3 && ANREDE.test(n); i++) n = n.replace(ANREDE, '');
	return n.trim();
}

/** Kunden zum gesprochenen Namen (+ Ort). Exakte Wortgleichheit im Namen schlägt Teiltreffer. */
async function findeKunden(k: Kontext, name: string, ort?: string): Promise<{ treffer: Kunde[]; ortIgnoriert: boolean }> {
	const n = ohneAnrede(name).slice(0, 80);
	if (n === '' || n === '?') return { treffer: [], ortIgnoriert: false };
	const exakt = (liste: Kunde[]) => {
		const gesucht = woerter(n);
		const genau = liste.filter((kd) => {
			const namensWoerter = woerter([kd.firma, kd.vorname, kd.nachname].filter(Boolean).join(' '));
			return gesucht.every((w) => namensWoerter.includes(w));
		});
		return genau.length > 0 ? genau : liste;
	};
	if (ort) {
		const mitOrt = await listeKunden(k, `${n} ${ohneAnrede(ort)}`.slice(0, 100));
		if (mitOrt.length > 0) return { treffer: exakt(mitOrt), ortIgnoriert: false };
	}
	return { treffer: exakt(await listeKunden(k, n)), ortIgnoriert: !!ort };
}

const kundenLabel = (kd: Kunde) => [kd.name, kd.ort].filter(Boolean).join(', ');

function kundenFrage(name: string, treffer: Kunde[]): string {
	const orte = treffer.map((kd) => kd.ort);
	const eindeutigeOrte = orte.every(Boolean) && new Set(orte).size === orte.length;
	const teile = eindeutigeOrte ? orte.map((o) => `in ${o}`) : treffer.map(kundenLabel);
	const liste = teile.length > 1 ? `${teile.slice(0, -1).join(', ')} oder ${teile.at(-1)}` : teile[0];
	return eindeutigeOrte ? `Meinen Sie Kunde ${ohneAnrede(name)} ${liste}?` : `Meinen Sie ${liste}?`;
}

type MitarbeiterTreffer = { id: string; name: string };
const ICH = new Set(['ich', 'mich', 'mir', 'selbst', 'mein', 'meine']);

function findeMitarbeiter(alle: MitarbeiterTreffer[], gesprochen: string, nutzerId: string): MitarbeiterTreffer[] {
	const g = woerter(gesprochen);
	if (g.length === 0) return [];
	if (g.every((w) => ICH.has(w))) return alle.filter((m) => m.id === nutzerId);
	const genau = alle.filter((m) => normal(m.name) === g.join(' '));
	if (genau.length > 0) return genau;
	return alle.filter((m) => {
		const nw = woerter(m.name);
		return g.every((w) => nw.includes(w));
	});
}

async function findeAuftraege(k: Kontext, nutzer: Nutzer, text: string, alle: boolean): Promise<Auftrag[]> {
	const suche = ohneAnrede(text)
		.replace(/\b(?:auftrag|kunde|kundin|familie|firma|baustelle|bei|für|von|der|die|das|den)\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
	if (suche === '' || suche === '?') return [];
	const sicht = alle ? { alle: true, benutzerId: nutzer.id } : sichtVon(nutzer);
	return listeAuftraege(k, sicht, { suche, offen: true });
}
const auftragLabel = (a: Auftrag) => `${a.nummer} ${a.titel} – ${a.kundeName}`;

// ---------------------------------------------------------------------------------------------------------------
// Auflösen je Aktion

type Bau = { werte: Record<string, any>; auswahl: Auswahl[]; fehlt: string[]; warnungen: string[]; zeilen: Zeile[] };
const neuerBau = (): Bau => ({ werte: {}, auswahl: [], fehlt: [], warnungen: [], zeilen: [] });

/** Löst eine Liste gesprochener Mitarbeiter auf; Mehrdeutigkeit → Auswahl `mitarbeiter.<i>`, unbekannt → fehlt. */
function mitarbeiterAufloesen(bau: Bau, alle: MitarbeiterTreffer[], namen: string[], nutzerId: string): (string | null)[] {
	return namen.map((n, i) => {
		const t = findeMitarbeiter(alle, n, nutzerId);
		if (t.length === 1) return t[0].id;
		if (t.length === 0) {
			bau.fehlt.push(`Mitarbeiter „${n}“ nicht gefunden.`);
			return null;
		}
		bau.auswahl.push({ feld: `mitarbeiter.${i}`, frage: `Welcher ${n} ist gemeint?`, optionen: t.map((m) => ({ id: m.id, label: m.name })) });
		return null;
	});
}
const mitarbeiterText = (alle: MitarbeiterTreffer[], ids: (string | null)[], namen: string[]) =>
	ids.map((id, i) => (id ? alle.find((m) => m.id === id)?.name ?? namen[i] : `${namen[i]} (bitte wählen)`)).join(' + ');

async function kundeAnlegen(k: Kontext, d: Extract<KiAktion, { aktion: 'kunde_anlegen' }>['daten']): Promise<Bau> {
	const bau = neuerBau();
	const eingabe: Record<string, unknown> = { ...d };
	try {
		bau.werte.kunde = pruefeKundeEingabe(eingabe);
	} catch (e) {
		bau.fehlt.push(e instanceof ApiFehler ? e.message : 'Die Angaben zum Kunden sind unvollständig.');
		bau.werte.kunde = eingabe;
	}
	const w = bau.werte.kunde as Record<string, string | null>;
	const name = anzeigeName({ art: d.art, firma: w.firma ?? null, vorname: w.vorname ?? null, nachname: w.nachname ?? null });
	bau.zeilen.push({ label: 'Name', wert: [w.anrede, name].filter(Boolean).join(' ') || '–' });
	bau.zeilen.push({ label: 'Art', wert: d.art === 'firma' ? 'Firma' : 'Privat' });
	const adresse = [w.strasse, [w.plz, w.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	if (adresse) bau.zeilen.push({ label: 'Adresse', wert: adresse });
	if (w.telefon) bau.zeilen.push({ label: 'Telefon', wert: w.telefon });
	if (w.email) bau.zeilen.push({ label: 'E-Mail', wert: w.email });
	const suchname = d.art === 'firma' ? d.firma : d.nachname;
	if (suchname) {
		const vorhanden = (await findeKunden(k, suchname)).treffer;
		if (vorhanden.length > 0) {
			bau.warnungen.push(`Es gibt schon ${vorhanden.length === 1 ? 'einen Kunden' : 'Kunden'} mit diesem Namen: ${vorhanden.slice(0, 3).map(kundenLabel).join('; ')}`);
		}
	}
	return bau;
}

async function auftragAnlegen(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'auftrag_anlegen' }>['daten'], jetzt: Date): Promise<Bau> {
	const bau = neuerBau();
	bau.werte.titel = d.titel;
	bau.werte.beschreibung = d.beschreibung ?? null;
	bau.zeilen.push({ label: 'Auftrag', wert: d.titel });
	const { treffer, ortIgnoriert } = await findeKunden(k, d.kunde.name, d.kunde.ort);
	bau.werte.kundeId = null;
	bau.werte.objektId = null;
	if (treffer.length === 0) {
		bau.fehlt.push(`Kunde „${ohneAnrede(d.kunde.name)}“ nicht gefunden – bitte zuerst den Kunden anlegen.`);
		bau.zeilen.push({ label: 'Kunde', wert: `${ohneAnrede(d.kunde.name)} (nicht gefunden)` });
	} else if (treffer.length === 1) {
		bau.werte.kundeId = treffer[0].id;
		bau.zeilen.push({ label: 'Kunde', wert: kundenLabel(treffer[0]) });
		if (ortIgnoriert) bau.warnungen.push(`Kein Kunde „${ohneAnrede(d.kunde.name)}“ in ${d.kunde.ort} – gefunden in ${treffer[0].ort ?? 'anderem Ort'}.`);
	} else {
		bau.auswahl.push({
			feld: 'kunde',
			frage: kundenFrage(d.kunde.name, treffer.slice(0, 8)),
			optionen: treffer.slice(0, 8).map((kd) => ({ id: kd.id, label: kundenLabel(kd) }))
		});
		bau.zeilen.push({ label: 'Kunde', wert: `${ohneAnrede(d.kunde.name)} (bitte wählen)` });
	}
	if (d.objekt) {
		bau.warnungen.push(`Objekt „${d.objekt}“ bitte nach dem Speichern am Auftrag wählen.`);
		bau.werte.beschreibung = [bau.werte.beschreibung, `Objekt: ${d.objekt}`].filter(Boolean).join('\n');
	}
	const tag = d.start ? loeseTag(d.start, jetzt) : null;
	bau.werte.geplantAb = tag;
	if (tag) bau.zeilen.push({ label: 'Start', wert: tagLang(tag) });
	if (tag && tag < berlinTag(jetzt)) bau.warnungen.push('Der Tag liegt in der Vergangenheit.');
	bau.werte.einsaetze = [];
	if (d.mitarbeiter?.length) {
		if (!tag) {
			bau.warnungen.push('Kein Tag genannt – die Mitarbeiter werden nicht eingeplant.');
		} else {
			const alle = await aktiveMitarbeiter(k);
			const ids = mitarbeiterAufloesen(bau, alle, d.mitarbeiter, nutzer.id);
			const z = einsatzZeitraum(tag, d.start?.uhrzeit, d.ende_uhrzeit);
			bau.werte.einsaetze = ids.map((benutzerId) => ({ benutzerId, beginn: z.beginn.toISOString(), ende: z.ende.toISOString() }));
			bau.zeilen.push({ label: 'Mitarbeiter', wert: mitarbeiterText(alle, ids, d.mitarbeiter) });
			bau.zeilen.push({ label: 'Einsatz', wert: zeitraumText(z.beginn, z.ende) });
		}
	}
	return bau;
}

async function todoAnlegen(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'todo_anlegen' }>['daten'], jetzt: Date): Promise<Bau> {
	const bau = neuerBau();
	bau.werte.titel = d.titel;
	bau.zeilen.push({ label: 'To-do', wert: d.titel });
	bau.werte.zustaendigId = null;
	if (d.zustaendig) {
		const alle = await aktiveMitarbeiter(k);
		const [id] = mitarbeiterAufloesen(bau, alle, [d.zustaendig], nutzer.id);
		// Auswahl heißt bei To-dos „zustaendig“
		for (const a of bau.auswahl) if (a.feld === 'mitarbeiter.0') a.feld = 'zustaendig';
		bau.werte.zustaendigId = id;
		bau.zeilen.push({ label: 'Zuständig', wert: mitarbeiterText(alle, [id], [d.zustaendig]) });
	}
	const faellig = d.faellig ? loeseTag(d.faellig, jetzt) : null;
	bau.werte.faellig = faellig;
	if (faellig) bau.zeilen.push({ label: 'Fällig', wert: tagLang(faellig) });
	bau.werte.auftragId = null;
	if (d.auftrag) {
		const t = await findeAuftraege(k, nutzer, d.auftrag, false);
		if (t.length === 1) {
			bau.werte.auftragId = t[0].id;
			bau.zeilen.push({ label: 'Auftrag', wert: auftragLabel(t[0]) });
		} else if (t.length > 1) {
			bau.auswahl.push({ feld: 'auftrag', frage: 'Welcher Auftrag ist gemeint?', optionen: t.slice(0, 8).map((a) => ({ id: a.id, label: auftragLabel(a) })) });
			bau.zeilen.push({ label: 'Auftrag', wert: `${d.auftrag} (bitte wählen)` });
		} else {
			bau.warnungen.push(`Auftrag „${d.auftrag}“ nicht gefunden – das To-do wird ohne Auftrag angelegt.`);
		}
	}
	return bau;
}

async function einsatzAnlegen(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'einsatz_anlegen' }>['daten'], jetzt: Date): Promise<Bau> {
	const bau = neuerBau();
	const t = await findeAuftraege(k, nutzer, d.auftrag, true);
	bau.werte.auftragId = null;
	if (t.length === 1) {
		bau.werte.auftragId = t[0].id;
		bau.zeilen.push({ label: 'Auftrag', wert: auftragLabel(t[0]) });
	} else if (t.length > 1) {
		bau.auswahl.push({ feld: 'auftrag', frage: 'Welcher Auftrag ist gemeint?', optionen: t.slice(0, 8).map((a) => ({ id: a.id, label: auftragLabel(a) })) });
		bau.zeilen.push({ label: 'Auftrag', wert: `${d.auftrag} (bitte wählen)` });
	} else {
		bau.fehlt.push(`Kein offener Auftrag zu „${ohneAnrede(d.auftrag)}“ gefunden.`);
		bau.zeilen.push({ label: 'Auftrag', wert: `${ohneAnrede(d.auftrag)} (nicht gefunden)` });
	}
	const alle = await aktiveMitarbeiter(k);
	const ids = mitarbeiterAufloesen(bau, alle, d.mitarbeiter, nutzer.id);
	const tag = loeseTag(d.start, jetzt);
	const z = einsatzZeitraum(tag, d.start.uhrzeit, d.ende_uhrzeit);
	if (tag < berlinTag(jetzt)) bau.warnungen.push('Der Tag liegt in der Vergangenheit.');
	bau.werte.einsaetze = ids.map((benutzerId) => ({ benutzerId, beginn: z.beginn.toISOString(), ende: z.ende.toISOString() }));
	bau.werte.notiz = d.notiz ?? null;
	bau.zeilen.push({ label: 'Mitarbeiter', wert: mitarbeiterText(alle, ids, d.mitarbeiter) });
	bau.zeilen.push({ label: 'Termin', wert: zeitraumText(z.beginn, z.ende) });
	if (!d.start.uhrzeit) bau.warnungen.push(`Keine Uhrzeit genannt – eingeplant ab ${STANDARD_BEGINN} Uhr für ${STANDARD_DAUER_H} Stunden.`);
	return bau;
}

/** Termine (Einsätze), auf die die Beschreibung passt: Mitarbeiter, Auftrag/Kunde, bisheriger Tag – sonst ab jetzt. */
async function einsatzVerschieben(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'einsatz_verschieben' }>['daten'], jetzt: Date): Promise<Bau> {
	const bau = neuerBau();
	const alle = await aktiveMitarbeiter(k);
	const mitarbeiter = d.mitarbeiter ? findeMitarbeiter(alle, d.mitarbeiter, nutzer.id) : null;
	if (d.mitarbeiter && mitarbeiter!.length === 0) bau.fehlt.push(`Mitarbeiter „${d.mitarbeiter}“ nicht gefunden.`);
	const auftraege = d.auftrag ? await findeAuftraege(k, nutzer, d.auftrag, true) : null;
	if (d.auftrag && auftraege!.length === 0) bau.fehlt.push(`Kein offener Auftrag zu „${ohneAnrede(d.auftrag)}“ gefunden.`);
	const vonTag = d.von ? loeseTag(d.von, jetzt) : null;
	let kandidaten: { id: string; label: string; beginn: Date; ende: Date }[] = [];
	if (bau.fehlt.length === 0) {
		const bisAb = vonTag ? ausTagUndUhrzeit(vonTag, '00:00') : jetzt;
		const bisEnde = vonTag ? ausTagUndUhrzeit(tagPlus(vonTag, 1), '00:00') : new Date(jetzt.getTime() + 60 * 24 * MS_H);
		const zeilen = await mitBetrieb(k, (tx) => tx`
			select e.id, e.beginn, e.ende, b.name as benutzer_name, a.nummer, a.titel,
				k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname, a.einmal_name
			from app.einsaetze e
			join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
			left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
			join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id
			where e.betrieb_id = ${k.betriebId} and e.ende > ${bisAb} and e.beginn < ${bisEnde}
				${mitarbeiter ? tx`and e.benutzer_id = any(${mitarbeiter.map((m) => m.id)}::uuid[])` : tx``}
				${auftraege ? tx`and e.auftrag_id = any(${auftraege.map((a) => a.id)}::uuid[])` : tx``}
			order by e.beginn, e.id
			limit 9`);
		kandidaten = zeilen.map((z) => {
			const beginn = new Date(z.beginn);
			const ende = new Date(z.ende);
			const kunde = kundeNameAus(z);
			return { id: z.id, beginn, ende, label: `${zeitraumText(beginn, ende)} · ${z.benutzer_name} · ${z.titel} (${kunde})` };
		});
		if (kandidaten.length === 0) bau.fehlt.push('Keinen passenden Termin gefunden.');
	}
	const nachTag = d.nach.tag ? loeseTag(d.nach, jetzt) : kandidaten.length > 0 ? berlinTag(kandidaten[0].beginn) : berlinTag(jetzt);
	bau.werte.nachTag = nachTag;
	bau.werte.nachUhrzeit = d.nach.uhrzeit ?? null;
	bau.werte.einsatzId = null;
	if (kandidaten.length === 1) {
		bau.werte.einsatzId = kandidaten[0].id;
		bau.zeilen.push({ label: 'Termin', wert: kandidaten[0].label });
		const neu = neueZeiten(kandidaten[0].beginn, kandidaten[0].ende, nachTag, d.nach.uhrzeit ?? null);
		bau.zeilen.push({ label: 'Neu', wert: zeitraumText(neu.beginn, neu.ende) });
	} else if (kandidaten.length > 1) {
		bau.auswahl.push({ feld: 'einsatz', frage: 'Welcher Termin ist gemeint?', optionen: kandidaten.slice(0, 8).map((x) => ({ id: x.id, label: x.label })) });
		bau.zeilen.push({ label: 'Termin', wert: 'bitte wählen' });
		bau.zeilen.push({ label: 'Neu', wert: `${tagLang(nachTag)}${d.nach.uhrzeit ? `, ab ${d.nach.uhrzeit}` : ' (gleiche Uhrzeit)'}` });
	}
	if (nachTag < berlinTag(jetzt)) bau.warnungen.push('Der neue Tag liegt in der Vergangenheit.');
	return bau;
}

/** Neuer Zeitraum: gleicher Uhrzeit-Beginn (oder neue Uhrzeit) am Zieltag, gleiche Dauer. */
export function neueZeiten(beginn: Date, ende: Date, nachTag: string, uhrzeit: string | null): { beginn: Date; ende: Date } {
	if (!uhrzeit) return verschiebeAufTag(beginn, ende, nachTag);
	const neu = ausTagUndUhrzeit(nachTag, uhrzeit);
	return { beginn: neu, ende: new Date(neu.getTime() + (ende.getTime() - beginn.getTime())) };
}

async function angebotEntwurf(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'angebot_entwurf' }>['daten']): Promise<Bau> {
	const bau = neuerBau();
	const t = await findeAuftraege(k, nutzer, d.auftrag, false);
	bau.werte.auftragId = null;
	bau.werte.stichworte = d.stichworte;
	if (t.length === 1) {
		bau.werte.auftragId = t[0].id;
		bau.zeilen.push({ label: 'Auftrag', wert: auftragLabel(t[0]) });
	} else if (t.length > 1) {
		bau.auswahl.push({ feld: 'auftrag', frage: 'Welcher Auftrag ist gemeint?', optionen: t.slice(0, 8).map((a) => ({ id: a.id, label: auftragLabel(a) })) });
		bau.zeilen.push({ label: 'Auftrag', wert: `${d.auftrag} (bitte wählen)` });
	} else {
		bau.fehlt.push(`Kein offener Auftrag zu „${ohneAnrede(d.auftrag)}“ gefunden.`);
		bau.zeilen.push({ label: 'Auftrag', wert: `${ohneAnrede(d.auftrag)} (nicht gefunden)` });
	}
	bau.zeilen.push({ label: 'Leistungen', wert: d.stichworte });
	bau.warnungen.push('Die KI wählt nur Positionen aus dem Katalog; Preise kommen aus dem Katalog. Bitte den Entwurf prüfen.');
	return bau;
}

const PROTOKOLL_TYP_TITEL: Record<string, string> = {
	abnahme: 'Abnahme',
	regiebericht: 'Regiebericht',
	aufmass: 'Aufmaß',
	maengelliste: 'Mängelliste'
};

async function protokollAusfuellen(k: Kontext, nutzer: Nutzer, d: Extract<KiAktion, { aktion: 'protokoll_ausfuellen' }>['daten']): Promise<Bau> {
	const bau = neuerBau();
	const t = await findeAuftraege(k, nutzer, d.auftrag.nummer, false);
	bau.werte.auftragId = null;
	bau.werte.typ = d.typ;
	bau.werte.inhalt = d.inhalt ?? {};
	if (t.length === 1) {
		bau.werte.auftragId = t[0].id;
		bau.zeilen.push({ label: 'Auftrag', wert: auftragLabel(t[0]) });
	} else if (t.length > 1) {
		bau.auswahl.push({ feld: 'auftrag', frage: 'Welcher Auftrag ist gemeint?', optionen: t.slice(0, 8).map((a) => ({ id: a.id, label: auftragLabel(a) })) });
		bau.zeilen.push({ label: 'Auftrag', wert: `${d.auftrag.nummer} (bitte wählen)` });
	} else {
		bau.fehlt.push(`Kein offener Auftrag zu „${d.auftrag.nummer}" gefunden.`);
		bau.zeilen.push({ label: 'Auftrag', wert: `${d.auftrag.nummer} (nicht gefunden)` });
	}
	bau.zeilen.push({ label: 'Typ', wert: PROTOKOLL_TYP_TITEL[d.typ] ?? d.typ });
	if (d.inhalt?.bemerkung) bau.zeilen.push({ label: 'Bemerkung', wert: d.inhalt.bemerkung });
	if (d.inhalt?.maengel) bau.zeilen.push({ label: 'Mängel', wert: d.inhalt.maengel });
	return bau;
}

const TITEL: Record<AktionsName, string> = {
	kunde_anlegen: 'Kunde anlegen',
	auftrag_anlegen: 'Auftrag anlegen',
	todo_anlegen: 'To-do anlegen',
	einsatz_anlegen: 'Termin einplanen',
	einsatz_verschieben: 'Termin verschieben',
	angebot_entwurf: 'Angebotsentwurf (KI)',
	protokoll_ausfuellen: 'Protokoll ausfüllen'
};

/** Link „Ändern“: normales Formular, so weit wie möglich vorausgefüllt (nur unkritische Felder in der URL). */
function aendernLink(aktion: KiAktion, werte: Record<string, any>): string {
	const q = (o: Record<string, unknown>) => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v !== '') p.set(k, v);
		const s = p.toString();
		return s ? `?${s}` : '';
	};
	switch (aktion.aktion) {
		case 'kunde_anlegen':
			return `/kunden/neu${q({ ...(werte.kunde ?? {}) })}`;
		case 'auftrag_anlegen':
			return `/auftraege/neu${q({ kunde: werte.kundeId, titel: werte.titel, geplantAb: werte.geplantAb, beschreibung: werte.beschreibung })}`;
		case 'todo_anlegen':
			return werte.auftragId ? `/auftraege/${werte.auftragId}` : `/todos${q({ titel: werte.titel, faellig: werte.faellig })}`;
		case 'einsatz_anlegen':
			return `/plantafel${q({ tag: werte.einsaetze?.[0]?.beginn ? berlinTag(new Date(werte.einsaetze[0].beginn)) : undefined })}`;
		case 'einsatz_verschieben':
			return `/plantafel${q({ tag: werte.nachTag })}`;
		case 'angebot_entwurf':
			return werte.auftragId ? `/auftraege/${werte.auftragId}` : '/auftraege';
		default:
			return '/';
	}
}

/** Löst die Aktion auf (Rechte prüft der Aufrufer vorher, siehe `ausfuehren.ts`). */
export async function loeseAuf(k: Kontext, nutzer: Nutzer, aktion: Exclude<KiAktion, { aktion: 'unbekannt' }>, jetzt: Date): Promise<Vorschau> {
	let bau: Bau;
	try {
		switch (aktion.aktion) {
			case 'kunde_anlegen':
				bau = await kundeAnlegen(k, aktion.daten);
				break;
			case 'auftrag_anlegen':
				bau = await auftragAnlegen(k, nutzer, aktion.daten, jetzt);
				break;
			case 'todo_anlegen':
				bau = await todoAnlegen(k, nutzer, aktion.daten, jetzt);
				break;
			case 'einsatz_anlegen':
				bau = await einsatzAnlegen(k, nutzer, aktion.daten, jetzt);
				break;
			case 'einsatz_verschieben':
				bau = await einsatzVerschieben(k, nutzer, aktion.daten, jetzt);
				break;
			case 'angebot_entwurf':
				bau = await angebotEntwurf(k, nutzer, aktion.daten);
				break;
			case 'protokoll_ausfuellen':
				bau = await protokollAusfuellen(k, nutzer, aktion.daten);
				break;
		}
	} catch (e) {
		// Unpassende Angaben (z. B. Ende vor Beginn) werden zum Hinweis auf der Karte statt zum Fehler der Anfrage
		if (!(e instanceof ApiFehler) || e.status !== 400) throw e;
		bau = { ...neuerBau(), fehlt: [e.message] };
	}
	return {
		aktion: aktion.aktion,
		werte: bau.werte,
		auswahl: bau.auswahl,
		fehlt: bau.fehlt,
		warnungen: bau.warnungen,
		karte: {
			aktion: aktion.aktion,
			titel: TITEL[aktion.aktion],
			zeilen: bau.zeilen,
			auswahl: bau.auswahl,
			warnungen: bau.warnungen,
			fehler: bau.fehlt.length > 0 ? bau.fehlt.join(' ') : null,
			aendern: aendernLink(aktion, bau.werte)
		}
	};
}

/** Karte ohne Vorschlag (nicht unterstützt, fehlende Berechtigung). */
export function hinweisKarte(aktion: AktionsName | 'unbekannt', fehler: string): Karte {
	return {
		aktion,
		titel: aktion === 'unbekannt' ? 'Das kann ich noch nicht' : TITEL[aktion],
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null
	};
}

