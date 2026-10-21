import { erinnerungenAusEingabe, setzeErinnerungen } from './erinnerungen';
import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { kundeNameAus, ortAus } from './auftraege';
import { darf, darfEines } from './tarif';
import { ausTagUndUhrzeit, berlinTag, istTag, tagesGrenzen, tagPlus, verschiebeAufTag, wocheVon } from '../zeit';
import { istEinsatzArt, type EinsatzArt } from '../einsatz-art';

/**
 * Plantafel (Modul `plantafel`): Einsätze (Mitarbeiter × Zeitraum in einem Auftrag) und Abwesenheiten (Urlaub,
 * Krankheit, Sonstiges; ganztägig). Planen darf, wer `plantafel.bearbeiten` hat (prüft der Aufrufer).
 *
 * Warnungen blockieren nie: Doppelbelegung (überlappende Einsätze desselben Mitarbeiters, halboffen [beginn, ende))
 * und Einsätze an Tagen einer Abwesenheit werden beim Speichern gespeichert UND zurückgemeldet. Tage zählen in
 * Europe/Berlin. Fremde und unbekannte Datensätze sind ein 404.
 */

export type Warnung =
	| { art: 'doppelt'; einsatzId: string }
	| { art: 'urlaub' | 'krank' | 'sonstiges'; abwesenheitId: string };

export const ABWESENHEIT_ARTEN = ['urlaub', 'krank', 'sonstiges'] as const;
export type AbwesenheitArt = (typeof ABWESENHEIT_ARTEN)[number];
export const ABWESENHEIT_NAMEN: Record<AbwesenheitArt, string> = {
	urlaub: 'Urlaub',
	krank: 'Krank',
	sonstiges: 'Abwesend'
};

export type Einsatz = {
	id: string;
	/** null = eigener Termin ohne Auftrag (Titel in `auftragTitel`, Wunsch Jamil msg 2682) */
	auftragId: string | null;
	auftragNummer: string;
	auftragTitel: string;
	kundeName: string;
	/** Adresse des Objekts, sonst des Kunden (oder `null`). */
	ort: string | null;
	benutzerId: string;
	benutzerName: string;
	beginn: string;
	ende: string;
	notiz: string | null;
	/** Besichtigung, Montage oder Wartung. */
	art: EinsatzArt;
	/** Terminart aus der gepflegten Liste des Betriebs (Jamil msg 3074) oder keine. */
	terminart: { id: string; name: string; farbe: string } | null;
	warnungen: Warnung[];
	/** Mehrtägiger Termin bzw. Kolonnen-Einsatz: gemeinsame Gruppe (erster/letzter Tag), sonst null. */
	gruppe: { id: string; vonTag: string; bisTag: string } | null;
	kolonne: { id: string; name: string } | null;
	/** Status des Auftrags (Kalender: Farbe nach Status). */
	auftragStatus: string;
};

export type Abwesenheit = {
	id: string;
	benutzerId: string;
	benutzerName: string;
	art: AbwesenheitArt;
	von: string;
	bis: string;
	notiz: string | null;
};

export const MAX_STUNDEN = 14;

/** Plantafel lesen: Modul `plantafel` + `plantafel.bearbeiten` oder `auftraege.alle_lesen`. */
export const darfPlantafelLesen = (locals: { nutzer: Nutzer | null }) =>
	darfEines(locals, 'plantafel', ['plantafel.bearbeiten', 'auftraege.alle_lesen']);

/** Planen (Einsätze, Abwesenheiten anlegen/ändern/löschen): Modul `plantafel` + `plantafel.bearbeiten`. */
export const darfPlanen = (locals: { nutzer: Nutzer | null }) => darf(locals, 'plantafel', 'plantafel.bearbeiten');
const MS_STUNDE = 3_600_000;

type Zeitraum = { id?: string; benutzerId: string; beginn: Date; ende: Date };
type AbwesenheitKurz = { id: string; benutzerId: string; art: string; von: string; bis: string };

/**
 * Warnungen für einen Einsatz – rein, ohne Datenbank. Doppelt: ein anderer Einsatz desselben Mitarbeiters überlappt
 * (halboffen: angrenzend zählt nicht). Abwesenheit: ein Berliner Tag des Einsatzes (vom Tag des Beginns bis zum Tag
 * der letzten Millisekunde) liegt zwischen `von` und `bis` (einschließlich).
 */
export function berechneWarnungen(
	einsatz: Zeitraum,
	andere: (Zeitraum & { id: string })[],
	abwesenheiten: AbwesenheitKurz[]
): Warnung[] {
	const warnungen: Warnung[] = [];
	for (const o of andere) {
		if (o.benutzerId !== einsatz.benutzerId || (einsatz.id !== undefined && o.id === einsatz.id)) continue;
		if (o.beginn.getTime() < einsatz.ende.getTime() && einsatz.beginn.getTime() < o.ende.getTime()) {
			warnungen.push({ art: 'doppelt', einsatzId: o.id });
		}
	}
	const ersterTag = berlinTag(einsatz.beginn);
	const letzterTag = berlinTag(new Date(einsatz.ende.getTime() - 1));
	for (const a of abwesenheiten) {
		if (a.benutzerId !== einsatz.benutzerId) continue;
		if (a.von <= letzterTag && a.bis >= ersterTag) {
			warnungen.push({ art: a.art as AbwesenheitArt, abwesenheitId: a.id });
		}
	}
	return warnungen;
}

const einsatzNichtGefunden = () => new ApiFehler(404, 'Einsatz nicht gefunden.');
const abwesenheitNichtGefunden = () => new ApiFehler(404, 'Abwesenheit nicht gefunden.');

function pruefeId(id: string, fehler: () => ApiFehler): string {
	if (typeof id !== 'string' || !UUID.test(id)) throw fehler();
	return id;
}

function idFeld(wert: unknown, meldung: string): string {
	if (typeof wert !== 'string' || !UUID.test(wert.trim())) throw new ApiFehler(400, meldung);
	return wert.trim().toLowerCase();
}

/** ISO-Zeitpunkt (mit Zeitzone, z. B. `2026-10-21T06:00:00.000Z`) → Date; sonst 400. */
function zeitpunkt(wert: unknown, name: string): Date {
	if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(wert)) {
		throw new ApiFehler(400, `${name}: Bitte einen Zeitpunkt angeben.`);
	}
	const d = new Date(wert);
	if (Number.isNaN(d.getTime())) throw new ApiFehler(400, `${name}: Bitte einen Zeitpunkt angeben.`);
	return d;
}

type EinsatzWerte = {
	auftragId: string | null;
	titel: string | null;
	benutzerId: string;
	beginn: Date;
	ende: Date;
	notiz: string | null;
	art: EinsatzArt;
	terminartId: string | null;
};

export const EINSATZ_FELDER = ['auftragId', 'titel', 'benutzerId', 'beginn', 'ende', 'notiz', 'art', 'terminartId'] as const;

/** Terminart (optional): leer = keine, sonst eine ID; ob sie zum Betrieb gehört, prüft `pruefeTerminart`. */
function terminartFeld(w: unknown): string | null {
	if (w === undefined || w === null || w === '') return null;
	return idFeld(w, 'Terminart: ungültige Auswahl.');
}

/** Prüft einen vollständigen Einsatz (400 mit klarer Meldung). */
export function pruefeEinsatzEingabe(e: Record<string, unknown>): EinsatzWerte {
	// Eigener Termin: ohne Auftrag, dann mit Titel (z. B. „Zahnarzt“)
	const titel = textFeld(e.titel, 'Titel', 200);
	const ohneAuftrag = e.auftragId === undefined || e.auftragId === null || e.auftragId === '';
	if (ohneAuftrag && !titel) throw new ApiFehler(400, 'Bitte einen Auftrag wählen (oder bei einem eigenen Termin einen Titel angeben).');
	const auftragId = ohneAuftrag ? null : idFeld(e.auftragId, 'Bitte einen Auftrag wählen.');
	const benutzerId = idFeld(e.benutzerId, 'Bitte einen Mitarbeiter wählen.');
	const beginn = zeitpunkt(e.beginn, 'Beginn');
	const ende = zeitpunkt(e.ende, 'Ende');
	if (ende.getTime() <= beginn.getTime()) throw new ApiFehler(400, 'Ende muss nach dem Beginn liegen');
	if (ende.getTime() - beginn.getTime() > MAX_STUNDEN * MS_STUNDE) {
		throw new ApiFehler(400, 'Ein Einsatz darf höchstens 14 Stunden dauern');
	}
	// Art: ohne Angabe „Montage“ (wie bisherige Einsätze)
	const art = e.art === undefined || e.art === null || e.art === '' ? 'montage' : e.art;
	if (!istEinsatzArt(art)) throw new ApiFehler(400, 'Bitte eine Art wählen: Besichtigung, Montage oder Wartung.');
	return {
		auftragId,
		titel: auftragId ? null : titel,
		benutzerId,
		beginn,
		ende,
		notiz: textFeld(e.notiz, 'Notiz', 500),
		art,
		terminartId: terminartFeld(e.terminartId)
	};
}

const iso = (d: unknown) => new Date(d as string | Date).toISOString();
const adresse = (strasse: string | null, plz: string | null, ort: string | null) =>
	[strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

export const EINSATZ_AUSWAHL = `e.id, e.auftrag_id, e.titel as eigener_titel, e.benutzer_id, e.beginn, e.ende, e.notiz, e.art,
	e.terminart_id, ta.name as terminart_name, ta.farbe as terminart_farbe,
	a.nummer as auftrag_nummer, a.titel as auftrag_titel, a.status as auftrag_status, b.name as benutzer_name,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort,
	o.id as objekt_id, o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
	a.einmal_name, a.einmal_strasse, a.einmal_plz, a.einmal_ort,
	e.gruppe_id, e.kolonne_id, ko.name as kolonne_name,
	(select to_char(min(g.beginn at time zone 'Europe/Berlin'), 'YYYY-MM-DD') from app.einsaetze g
		where g.gruppe_id = e.gruppe_id and g.betrieb_id = e.betrieb_id) as gruppe_von,
	(select to_char(max(g.beginn at time zone 'Europe/Berlin'), 'YYYY-MM-DD') from app.einsaetze g
		where g.gruppe_id = e.gruppe_id and g.betrieb_id = e.betrieb_id) as gruppe_bis`;

export const EINSATZ_VON = `app.einsaetze e
	left join app.kolonnen ko on ko.id = e.kolonne_id and ko.betrieb_id = e.betrieb_id
	left join app.buchung_dienste ta on ta.id = e.terminart_id and ta.betrieb_id = e.betrieb_id
	left join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
	left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
	left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
	join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id`;

export function zuEinsatz(z: Record<string, any>, warnungen: Warnung[] = []): Einsatz {
	const objektOrt = z.objekt_id ? adresse(z.objekt_strasse, z.objekt_plz, z.objekt_ort) : null;
	return {
		id: z.id,
		auftragId: z.auftrag_id ?? null,
		auftragNummer: z.auftrag_nummer ?? '',
		auftragTitel: z.auftrag_id ? z.auftrag_titel : (z.eigener_titel ?? 'Termin'),
		kundeName: z.auftrag_id ? kundeNameAus(z) : '',
		ort: objektOrt ?? ortAus(z),
		benutzerId: z.benutzer_id,
		benutzerName: z.benutzer_name,
		beginn: iso(z.beginn),
		ende: iso(z.ende),
		notiz: z.notiz,
		art: z.art ?? 'montage',
		terminart: z.terminart_id ? { id: z.terminart_id, name: z.terminart_name, farbe: z.terminart_farbe } : null,
		warnungen,
		gruppe: z.gruppe_id ? { id: z.gruppe_id, vonTag: z.gruppe_von, bisTag: z.gruppe_bis } : null,
		kolonne: z.kolonne_id ? { id: z.kolonne_id, name: z.kolonne_name } : null,
		auftragStatus: z.auftrag_status ?? 'eigen'
	};
}

const ABWESENHEIT_AUSWAHL = `w.id, w.benutzer_id, b.name as benutzer_name, w.art, to_char(w.von, 'YYYY-MM-DD') as von,
	to_char(w.bis, 'YYYY-MM-DD') as bis, w.notiz`;
const ABWESENHEIT_VON = `app.abwesenheiten w join app.benutzer b on b.id = w.benutzer_id and b.betrieb_id = w.betrieb_id`;

export function zuAbwesenheit(z: Record<string, any>): Abwesenheit {
	return {
		id: z.id,
		benutzerId: z.benutzer_id,
		benutzerName: z.benutzer_name,
		art: z.art,
		von: z.von,
		bis: z.bis,
		notiz: z.notiz
	};
}

/** Warnungen eines Einsatzes aus der Datenbank (überlappende Einsätze und Abwesenheiten desselben Mitarbeiters). */
async function warnungenFuer(tx: TransactionSql, k: Kontext, e: Zeitraum & { id: string }): Promise<Warnung[]> {
	const andere = await tx`
		select id, benutzer_id, beginn, ende from app.einsaetze
		where betrieb_id = ${k.betriebId} and benutzer_id = ${e.benutzerId} and id <> ${e.id}
			and beginn < ${e.ende} and ende > ${e.beginn}
		order by beginn, id`;
	const ersterTag = berlinTag(e.beginn);
	const letzterTag = berlinTag(new Date(e.ende.getTime() - 1));
	const abw = await tx`
		select id, benutzer_id, art, to_char(von, 'YYYY-MM-DD') as von, to_char(bis, 'YYYY-MM-DD') as bis
		from app.abwesenheiten
		where betrieb_id = ${k.betriebId} and benutzer_id = ${e.benutzerId}
			and von <= ${letzterTag}::date and bis >= ${ersterTag}::date
		order by von, id`;
	return berechneWarnungen(
		e,
		andere.map((o) => ({ id: o.id, benutzerId: o.benutzer_id, beginn: new Date(o.beginn), ende: new Date(o.ende) })),
		abw.map((a) => ({ id: a.id, benutzerId: a.benutzer_id, art: a.art, von: a.von, bis: a.bis }))
	);
}

async function ladeEinsatz(tx: TransactionSql, k: Kontext, id: string, mitWarnungen = true): Promise<Einsatz> {
	const [z] = await tx`
		select ${tx.unsafe(EINSATZ_AUSWAHL)} from ${tx.unsafe(EINSATZ_VON)}
		where e.id = ${id} and e.betrieb_id = ${k.betriebId}`;
	if (!z) throw einsatzNichtGefunden();
	const warnungen = mitWarnungen
		? await warnungenFuer(tx, k, { id: z.id, benutzerId: z.benutzer_id, beginn: new Date(z.beginn), ende: new Date(z.ende) })
		: [];
	return zuEinsatz(z, warnungen);
}

async function pruefeAuftrag(tx: TransactionSql, k: Kontext, auftragId: string): Promise<void> {
	const [a] = await tx`select 1 from app.auftraege where id = ${auftragId} and betrieb_id = ${k.betriebId} for key share`;
	if (!a) throw new ApiFehler(400, 'Der Auftrag wurde nicht gefunden.');
}

/** Neu gewählte Terminart: muss zum Betrieb gehören und eingeschaltet sein. */
async function pruefeTerminart(tx: TransactionSql, k: Kontext, terminartId: string | null): Promise<void> {
	if (!terminartId) return;
	const [t] = await tx`select 1 from app.buchung_dienste where id = ${terminartId} and betrieb_id = ${k.betriebId} and aktiv`;
	if (!t) throw new ApiFehler(400, 'Terminart: ungültige Auswahl.');
}

async function pruefeMitarbeiter(tx: TransactionSql, k: Kontext, benutzerId: string): Promise<void> {
	const [b] = await tx`select 1 from app.benutzer where id = ${benutzerId} and betrieb_id = ${k.betriebId} and aktiv`;
	if (!b) throw new ApiFehler(400, 'Eingeplant werden kann nur ein aktiver Mitarbeiter des Betriebs.');
}

export async function holeEinsatz(k: Kontext, id: string): Promise<Einsatz> {
	pruefeId(id, einsatzNichtGefunden);
	return mitBetrieb(k, (tx) => ladeEinsatz(tx, k, id));
}

/** Neuer Einsatz; die Antwort enthält die Warnungen (gespeichert wird trotzdem). */
export async function legeEinsatzAn(k: Kontext, e: Record<string, unknown>): Promise<Einsatz> {
	const w = pruefeEinsatzEingabe(e);
	return mitBetrieb(k, async (tx) => {
		if (w.auftragId) await pruefeAuftrag(tx, k, w.auftragId);
		await pruefeMitarbeiter(tx, k, w.benutzerId);
		await pruefeTerminart(tx, k, w.terminartId);
		const [z] = await tx`
			insert into app.einsaetze (betrieb_id, auftrag_id, titel, benutzer_id, beginn, ende, notiz, art, terminart_id)
			values (${k.betriebId}, ${w.auftragId}, ${w.titel}, ${w.benutzerId}, ${w.beginn}, ${w.ende}, ${w.notiz}, ${w.art}, ${w.terminartId})
			returning id`;
		// Erinnerungen (msg 2679) für den, der den Termin anlegt
		const erinnerungen = erinnerungenAusEingabe(e);
		if (erinnerungen && erinnerungen.length > 0) await setzeErinnerungen(tx, k, { einsatzId: z.id }, erinnerungen, w.beginn);
		return ladeEinsatz(tx, k, z.id);
	});
}

/**
 * Ändert einen Einsatz teilweise (z. B. Verschieben: `beginn`, `ende`, `benutzerId`); das Ergebnis wird als Ganzes
 * geprüft. Der Mitarbeiter wird nur geprüft, wenn er wechselt. Liefert die Warnungen des neuen Stands.
 */
export async function aendereEinsatz(k: Kontext, id: string, e: Record<string, unknown>): Promise<Einsatz> {
	pruefeId(id, einsatzNichtGefunden);
	const felder = EINSATZ_FELDER.filter((f) => Object.hasOwn(e, f));
	const erinnerungen = erinnerungenAusEingabe(e);
	if (felder.length === 0 && !erinnerungen) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select auftrag_id, titel, benutzer_id, beginn, ende, notiz, art, terminart_id from app.einsaetze
			where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw einsatzNichtGefunden();
		const w = pruefeEinsatzEingabe({
			auftragId: alt.auftrag_id,
			titel: alt.titel,
			benutzerId: alt.benutzer_id,
			beginn: iso(alt.beginn),
			ende: iso(alt.ende),
			notiz: alt.notiz,
			art: alt.art,
			terminartId: alt.terminart_id,
			...Object.fromEntries(felder.map((f) => [f, e[f]]))
		});
		if (w.auftragId && w.auftragId !== alt.auftrag_id) await pruefeAuftrag(tx, k, w.auftragId);
		if (w.benutzerId !== alt.benutzer_id) await pruefeMitarbeiter(tx, k, w.benutzerId);
		// eine (inzwischen ausgeschaltete) Terminart darf am Einsatz bleiben; nur eine neu gewählte wird geprüft
		if (w.terminartId !== alt.terminart_id) await pruefeTerminart(tx, k, w.terminartId);
		await tx`
			update app.einsaetze set auftrag_id = ${w.auftragId}, titel = ${w.titel}, benutzer_id = ${w.benutzerId}, beginn = ${w.beginn},
				ende = ${w.ende}, notiz = ${w.notiz}, art = ${w.art}, terminart_id = ${w.terminartId}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (erinnerungen) await setzeErinnerungen(tx, k, { einsatzId: id }, erinnerungen, w.beginn);
		return ladeEinsatz(tx, k, id);
	});
}

export async function loescheEinsatz(k: Kontext, id: string): Promise<void> {
	pruefeId(id, einsatzNichtGefunden);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.einsaetze where id = ${id} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw einsatzNichtGefunden();
	});
}

// ---------------------------------------------------------------------------------------------------------------
// Gruppen: mehrtägige Termine und Kolonnen (Wünsche Jamil msgs 2510, 2513)

export const MAX_GRUPPEN_TAGE = 62;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

export type GruppenWerte = {
	auftragId: string;
	benutzerIds: string[];
	kolonneId: string | null;
	vonTag: string;
	bisTag: string;
	vonZeit: string;
	bisZeit: string;
	art: EinsatzArt;
	terminartId: string | null;
	notiz: string | null;
	ohneWochenende: boolean;
};

/** Tage eines Zeitraums (inklusive), ohne Samstag/Sonntag, wenn gewünscht. */
export function gruppenTage(vonTag: string, bisTag: string, ohneWochenende: boolean): string[] {
	const tage: string[] = [];
	for (let t = vonTag; t <= bisTag; t = tagPlus(t, 1)) {
		const wt = new Date(`${t}T12:00:00Z`).getUTCDay();
		if (ohneWochenende && (wt === 0 || wt === 6)) continue;
		tage.push(t);
	}
	return tage;
}

export function pruefeGruppe(e: Record<string, unknown>): GruppenWerte {
	const auftragId = idFeld(e.auftragId, 'Bitte einen Auftrag wählen.');
	const kolonneId = e.kolonneId === undefined || e.kolonneId === null || e.kolonneId === '' ? null : idFeld(e.kolonneId, 'Kolonne: ungültige Auswahl.');
	const roh = e.benutzerIds === undefined || e.benutzerIds === null || e.benutzerIds === '' ? [] : Array.isArray(e.benutzerIds) ? e.benutzerIds : [e.benutzerIds];
	const benutzerIds = [...new Set(roh.map((b) => idFeld(b, 'Mitarbeiter: ungültige Auswahl.')))];
	if (!kolonneId && benutzerIds.length === 0) throw new ApiFehler(400, 'Bitte Mitarbeiter oder eine Kolonne wählen.');
	if (!istTag(e.vonTag)) throw new ApiFehler(400, 'Bitte den ersten Tag wählen.');
	const bisTag = e.bisTag === undefined || e.bisTag === null || e.bisTag === '' ? e.vonTag : e.bisTag;
	if (!istTag(bisTag)) throw new ApiFehler(400, 'Bitte den letzten Tag wählen.');
	if (bisTag < e.vonTag) throw new ApiFehler(400, 'Der letzte Tag liegt vor dem ersten.');
	if (Date.parse(`${bisTag}T00:00:00Z`) - Date.parse(`${e.vonTag}T00:00:00Z`) > (MAX_GRUPPEN_TAGE - 1) * 86_400_000) {
		throw new ApiFehler(400, `Ein Termin darf höchstens ${MAX_GRUPPEN_TAGE} Tage lang sein.`);
	}
	const vonZeit = typeof e.vonZeit === 'string' && e.vonZeit !== '' ? e.vonZeit : '07:00';
	const bisZeit = typeof e.bisZeit === 'string' && e.bisZeit !== '' ? e.bisZeit : '16:00';
	if (!UHRZEIT.test(vonZeit) || !UHRZEIT.test(bisZeit)) throw new ApiFehler(400, 'Arbeitszeit: Bitte Uhrzeiten wie 07:00 angeben.');
	if (bisZeit <= vonZeit) throw new ApiFehler(400, 'Arbeitszeit: Ende muss nach dem Beginn liegen.');
	const art = e.art === undefined || e.art === null || e.art === '' ? 'montage' : e.art;
	if (!istEinsatzArt(art)) throw new ApiFehler(400, 'Bitte eine Art wählen: Besichtigung, Montage oder Wartung.');
	const ohneWochenende = e.ohneWochenende === undefined || e.ohneWochenende === '' ? true : e.ohneWochenende === true || e.ohneWochenende === 'true' || e.ohneWochenende === 'on';
	if (gruppenTage(e.vonTag, bisTag, ohneWochenende).length === 0) throw new ApiFehler(400, 'Im Zeitraum liegen keine Arbeitstage.');
	return {
		auftragId,
		benutzerIds,
		kolonneId,
		vonTag: e.vonTag,
		bisTag,
		vonZeit,
		bisZeit,
		art,
		terminartId: terminartFeld(e.terminartId),
		notiz: textFeld(e.notiz, 'Notiz', 500),
		ohneWochenende
	};
}

async function ladeGruppe(tx: TransactionSql, k: Kontext, gruppeId: string): Promise<Einsatz[]> {
	const z = await tx`
		select ${tx.unsafe(EINSATZ_AUSWAHL)} from ${tx.unsafe(EINSATZ_VON)}
		where e.gruppe_id = ${gruppeId} and e.betrieb_id = ${k.betriebId} order by e.beginn, b.name, e.id`;
	if (z.length === 0) throw new ApiFehler(404, 'Termin nicht gefunden.');
	const liste: Einsatz[] = [];
	for (const r of z) {
		liste.push(zuEinsatz(r, await warnungenFuer(tx, k, { id: r.id, benutzerId: r.benutzer_id, beginn: new Date(r.beginn), ende: new Date(r.ende) })));
	}
	return liste;
}

/**
 * Mehrtägigen Termin und/oder Kolonne einplanen: je Arbeitstag und Person ein Einsatz mit den täglichen Arbeitszeiten,
 * alle mit derselben gruppe_id. Bei einer Kolonne sind die Personen ihre aktiven Mitglieder (plus ausdrücklich gewählte).
 */
export async function legeGruppeAn(k: Kontext, e: Record<string, unknown>): Promise<{ gruppeId: string; einsaetze: Einsatz[] }> {
	const w = pruefeGruppe(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeAuftrag(tx, k, w.auftragId);
		await pruefeTerminart(tx, k, w.terminartId);
		let personen = [...w.benutzerIds];
		if (w.kolonneId) {
			const [ko] = await tx`select 1 from app.kolonnen where id = ${w.kolonneId} and betrieb_id = ${k.betriebId} and aktiv`;
			if (!ko) throw new ApiFehler(400, 'Die Kolonne wurde nicht gefunden.');
			const m = await tx`
				select m.benutzer_id from app.kolonnen_mitglieder m join app.benutzer b on b.id = m.benutzer_id and b.betrieb_id = m.betrieb_id
				where m.kolonne_id = ${w.kolonneId} and m.betrieb_id = ${k.betriebId} and b.aktiv`;
			personen = [...new Set([...personen, ...m.map((r) => r.benutzer_id as string)])];
			if (personen.length === 0) throw new ApiFehler(400, 'Die Kolonne hat keine aktiven Mitglieder.');
		}
		for (const p of personen) await pruefeMitarbeiter(tx, k, p);
		const [{ id: gruppeId }] = await tx`select gen_random_uuid() as id`;
		for (const tag of gruppenTage(w.vonTag, w.bisTag, w.ohneWochenende)) {
			const beginn = ausTagUndUhrzeit(tag, w.vonZeit);
			const ende = ausTagUndUhrzeit(tag, w.bisZeit);
			for (const p of personen) {
				await tx`
					insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz, art, terminart_id, gruppe_id, kolonne_id)
					values (${k.betriebId}, ${w.auftragId}, ${p}, ${beginn}, ${ende}, ${w.notiz}, ${w.art}, ${w.terminartId}, ${gruppeId}, ${w.kolonneId})`;
			}
		}
		return { gruppeId, einsaetze: await ladeGruppe(tx, k, gruppeId) };
	});
}

const gruppenId = (id: unknown) => {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Termin nicht gefunden.');
	return id.toLowerCase();
};

/** Ganze Gruppe um `tage` Tage verschieben (Ziehen auf der Plantafel). */
export async function verschiebeGruppe(k: Kontext, id: unknown, tage: number): Promise<Einsatz[]> {
	const gid = gruppenId(id);
	if (!Number.isInteger(tage) || Math.abs(tage) > 366) throw new ApiFehler(400, 'Ungültige Verschiebung.');
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			-- in Berliner Ortszeit verschieben (Uhrzeit bleibt auch über die Zeitumstellung gleich)
			update app.einsaetze
			set beginn = ((beginn at time zone 'Europe/Berlin') + make_interval(days => ${tage})) at time zone 'Europe/Berlin',
				ende = ((ende at time zone 'Europe/Berlin') + make_interval(days => ${tage})) at time zone 'Europe/Berlin'
			where gruppe_id = ${gid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Termin nicht gefunden.');
		return ladeGruppe(tx, k, gid);
	});
}

/**
 * Letzten Tag ändern (Ziehen am Ende des Balkens): verlängern legt für die neuen Tage Einsätze mit den Personen und
 * Zeiten des bisher letzten Tags an (Wochenenden nur, wenn die Gruppe schon Wochenendtage hat); kürzen löscht die
 * Tage danach. Mindestens der erste Tag bleibt.
 */
export async function aendereGruppenEnde(k: Kontext, id: unknown, bisTag: unknown): Promise<Einsatz[]> {
	const gid = gruppenId(id);
	if (!istTag(bisTag)) throw new ApiFehler(400, 'Bitte den letzten Tag wählen.');
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select id, auftrag_id, benutzer_id, beginn, ende, notiz, art, terminart_id, kolonne_id,
				to_char(beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD') as tag
			from app.einsaetze where gruppe_id = ${gid} and betrieb_id = ${k.betriebId} order by beginn for update`;
		if (zeilen.length === 0) throw new ApiFehler(404, 'Termin nicht gefunden.');
		const ersterTag = zeilen[0].tag as string;
		const letzterTag = zeilen.at(-1)!.tag as string;
		if (bisTag < ersterTag) throw new ApiFehler(400, 'Der letzte Tag liegt vor dem ersten.');
		if (Date.parse(`${bisTag}T00:00:00Z`) - Date.parse(`${ersterTag}T00:00:00Z`) > (MAX_GRUPPEN_TAGE - 1) * 86_400_000) {
			throw new ApiFehler(400, `Ein Termin darf höchstens ${MAX_GRUPPEN_TAGE} Tage lang sein.`);
		}
		if (bisTag < letzterTag) {
			await tx`
				delete from app.einsaetze where gruppe_id = ${gid} and betrieb_id = ${k.betriebId}
					and (beginn at time zone 'Europe/Berlin')::date > ${bisTag}::date`;
		} else if (bisTag > letzterTag) {
			const mitWochenende = zeilen.some((z) => [0, 6].includes(new Date(`${z.tag}T12:00:00Z`).getUTCDay()));
			const vorlage = zeilen.filter((z) => z.tag === letzterTag);
			for (const tag of gruppenTage(tagPlus(letzterTag, 1), bisTag, !mitWochenende)) {
				for (const v of vorlage) {
					const b = new Date(v.beginn);
					const en = new Date(v.ende);
					const neu = verschiebeAufTag(b, en, tag);
					await tx`
						insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz, art, terminart_id, gruppe_id, kolonne_id)
						values (${k.betriebId}, ${v.auftrag_id}, ${v.benutzer_id}, ${neu.beginn}, ${neu.ende}, ${v.notiz}, ${v.art}, ${v.terminart_id}, ${gid}, ${v.kolonne_id})`;
				}
			}
		}
		return ladeGruppe(tx, k, gid);
	});
}

export async function loescheGruppe(k: Kontext, id: unknown): Promise<number> {
	const gid = gruppenId(id);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.einsaetze where gruppe_id = ${gid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Termin nicht gefunden.');
		return z.length;
	});
}

// ---------------------------------------------------------------------------------------------------------------
// Abwesenheiten

export const ABWESENHEIT_FELDER = ['benutzerId', 'art', 'von', 'bis', 'notiz'] as const;
const ABWESENHEIT_AENDERBAR = ['art', 'von', 'bis', 'notiz'] as const;

export const istAbwesenheitArt = (w: unknown): w is AbwesenheitArt =>
	typeof w === 'string' && (ABWESENHEIT_ARTEN as readonly string[]).includes(w);

type AbwesenheitWerte = { benutzerId: string; art: AbwesenheitArt; von: string; bis: string; notiz: string | null };

function pruefeAbwesenheitEingabe(e: Record<string, unknown>): AbwesenheitWerte {
	const benutzerId = idFeld(e.benutzerId, 'Bitte einen Mitarbeiter wählen.');
	if (!istAbwesenheitArt(e.art)) throw new ApiFehler(400, 'Die Art muss Urlaub, Krank oder Sonstiges sein.');
	if (!istTag(e.von)) throw new ApiFehler(400, 'Das Datum „Von“ ist ungültig.');
	if (!istTag(e.bis)) throw new ApiFehler(400, 'Das Datum „Bis“ ist ungültig.');
	if (e.bis < e.von) throw new ApiFehler(400, '„Bis“ darf nicht vor „Von“ liegen.');
	return { benutzerId, art: e.art, von: e.von, bis: e.bis, notiz: textFeld(e.notiz, 'Notiz', 200) };
}

async function ladeAbwesenheit(tx: TransactionSql, k: Kontext, id: string): Promise<Abwesenheit> {
	const [z] = await tx`
		select ${tx.unsafe(ABWESENHEIT_AUSWAHL)} from ${tx.unsafe(ABWESENHEIT_VON)}
		where w.id = ${id} and w.betrieb_id = ${k.betriebId}`;
	if (!z) throw abwesenheitNichtGefunden();
	return zuAbwesenheit(z);
}

export async function legeAbwesenheitAn(k: Kontext, e: Record<string, unknown>): Promise<Abwesenheit> {
	const w = pruefeAbwesenheitEingabe(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeMitarbeiter(tx, k, w.benutzerId);
		const [z] = await tx`
			insert into app.abwesenheiten (betrieb_id, benutzer_id, art, von, bis, notiz)
			values (${k.betriebId}, ${w.benutzerId}, ${w.art}, ${w.von}, ${w.bis}, ${w.notiz})
			returning id`;
		return ladeAbwesenheit(tx, k, z.id);
	});
}

/** Teiländerung (Art, Von, Bis, Notiz); der Mitarbeiter einer Abwesenheit ändert sich nicht. */
export async function aendereAbwesenheit(k: Kontext, id: string, e: Record<string, unknown>): Promise<Abwesenheit> {
	pruefeId(id, abwesenheitNichtGefunden);
	const felder = ABWESENHEIT_AENDERBAR.filter((f) => Object.hasOwn(e, f));
	if (felder.length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select benutzer_id, art, to_char(von, 'YYYY-MM-DD') as von, to_char(bis, 'YYYY-MM-DD') as bis, notiz
			from app.abwesenheiten where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw abwesenheitNichtGefunden();
		const w = pruefeAbwesenheitEingabe({
			benutzerId: alt.benutzer_id,
			art: alt.art,
			von: alt.von,
			bis: alt.bis,
			notiz: alt.notiz,
			...Object.fromEntries(felder.map((f) => [f, e[f]]))
		});
		await tx`
			update app.abwesenheiten set art = ${w.art}, von = ${w.von}, bis = ${w.bis}, notiz = ${w.notiz}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeAbwesenheit(tx, k, id);
	});
}

export async function loescheAbwesenheit(k: Kontext, id: string): Promise<void> {
	pruefeId(id, abwesenheitNichtGefunden);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.abwesenheiten where id = ${id} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw abwesenheitNichtGefunden();
	});
}

/** Abwesenheiten, die den Zeitraum [von, bis] (Tage, einschließlich) berühren – nach Beginn und Name. */
export async function listeAbwesenheiten(k: Kontext, von: string, bis: string): Promise<Abwesenheit[]> {
	if (!istTag(von) || !istTag(bis)) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(ABWESENHEIT_AUSWAHL)} from ${tx.unsafe(ABWESENHEIT_VON)}
			where w.betrieb_id = ${k.betriebId} and w.von <= ${bis}::date and w.bis >= ${von}::date
			order by w.von, b.name, w.id`;
		return z.map(zuAbwesenheit);
	});
}

// ---------------------------------------------------------------------------------------------------------------
// Lesen: Woche der Plantafel, Einsätze eines Auftrags, „Meine Einsätze heute“

export type Wochenansicht = {
	tage: string[];
	mitarbeiter: { id: string; name: string; aktiv: boolean }[];
	einsaetze: Einsatz[];
	abwesenheiten: Abwesenheit[];
};

/**
 * Plantafel einer Woche (Montag–Sonntag, Berlin) mit dem Tag `tag`: Einsätze, die in der Woche beginnen (jeder steht
 * an seinem Berliner Beginn-Tag), mit Warnungen; Abwesenheiten, die die Woche berühren; Mitarbeiter = aktive Benutzer
 * des Betriebs plus deaktivierte mit Einsätzen in dieser Woche (`aktiv: false`), nach Name.
 */
export async function ladeWoche(k: Kontext, tag: string): Promise<Wochenansicht> {
	if (!istTag(tag)) throw new ApiFehler(400, 'Ungültiger Tag.');
	return ladeTage(k, wocheVon(tag));
}

/** Wie `ladeWoche`, aber für beliebige aufeinanderfolgende Tage (Kalender: Monat mit bis zu 6 Wochen, Tag). */
export async function ladeTage(k: Kontext, tage: string[]): Promise<Wochenansicht> {
	if (tage.length === 0 || tage.length > 43 || !tage.every(istTag)) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	const letzter = tage[tage.length - 1];
	const beginn = tagesGrenzen(tage[0]).beginn;
	const ende = tagesGrenzen(letzter).ende;
	// Für Warnungen auch Einsätze bis 14 Stunden vor und nach der Woche (so lang darf ein Einsatz höchstens sein:
	// Sonntag 22–6 Uhr kollidiert mit Montag 1 Uhr) und Abwesenheiten der Tage davor und danach.
	const vorlauf = new Date(beginn.getTime() - MAX_STUNDEN * MS_STUNDE);
	const nachlauf = new Date(ende.getTime() + MAX_STUNDEN * MS_STUNDE);
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select ${tx.unsafe(EINSATZ_AUSWAHL)} from ${tx.unsafe(EINSATZ_VON)}
			where e.betrieb_id = ${k.betriebId} and e.beginn >= ${vorlauf} and e.beginn < ${nachlauf}
			order by e.beginn, b.name, e.id`;
		const abw = await tx`
			select ${tx.unsafe(ABWESENHEIT_AUSWAHL)} from ${tx.unsafe(ABWESENHEIT_VON)}
			where w.betrieb_id = ${k.betriebId} and w.von <= ${tagPlus(letzter, 1)}::date and w.bis >= ${tagPlus(tage[0], -1)}::date
			order by w.von, b.name, w.id`;
		const mitarbeiter = await tx`
			select b.id, b.name, b.aktiv from app.benutzer b
			where b.betrieb_id = ${k.betriebId}
				and (b.aktiv or exists (
					select 1 from app.einsaetze e
					where e.benutzer_id = b.id and e.betrieb_id = b.betrieb_id and e.beginn >= ${beginn} and e.beginn < ${ende}
				))
			order by public.unaccent(lower(b.name)), b.id`;
		const vergleich = abw.map(zuAbwesenheit);
		const abwesenheiten = vergleich.filter((a) => a.von <= letzter && a.bis >= tage[0]);
		const alle = zeilen.map((z) => ({
			id: z.id as string,
			benutzerId: z.benutzer_id as string,
			beginn: new Date(z.beginn),
			ende: new Date(z.ende)
		}));
		const inWoche = (d: Date) => d.getTime() >= beginn.getTime() && d.getTime() < ende.getTime();
		const einsaetze = zeilen.flatMap((z, i) =>
			inWoche(alle[i].beginn) ? [zuEinsatz(z, berechneWarnungen(alle[i], alle, vergleich))] : []
		);
		return {
			tage,
			mitarbeiter: mitarbeiter.map((m) => ({ id: m.id as string, name: m.name as string, aktiv: m.aktiv as boolean })),
			einsaetze,
			abwesenheiten
		};
	});
}

/** Einsätze eines Auftrags (für die Auftragsseite), nach Beginn. Die Sichtbarkeit des Auftrags prüft der Aufrufer. */
export async function einsaetzeZumAuftrag(k: Kontext, auftragId: string): Promise<Einsatz[]> {
	if (!UUID.test(auftragId)) return [];
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(EINSATZ_AUSWAHL)} from ${tx.unsafe(EINSATZ_VON)}
			where e.betrieb_id = ${k.betriebId} and e.auftrag_id = ${auftragId}
			order by e.beginn, b.name, e.id`;
		return z.map((zeile) => zuEinsatz(zeile));
	});
}

/**
 * „Meine Einsätze heute“: Einsätze des Benutzers, die den heutigen Berliner Tag (von `jetzt`) berühren, nach Beginn –
 * mit Kunde und Ort (Objekt- bzw. Kundenadresse). Ohne Warnungen (die betreffen die Planung, nicht den Monteur).
 */
export async function meineEinsaetzeHeute(k: Kontext, benutzerId: string, jetzt = new Date()): Promise<Einsatz[]> {
	const { beginn, ende } = tagesGrenzen(berlinTag(jetzt));
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(EINSATZ_AUSWAHL)} from ${tx.unsafe(EINSATZ_VON)}
			where e.betrieb_id = ${k.betriebId} and e.benutzer_id = ${benutzerId}
				and e.beginn < ${ende} and e.ende > ${beginn}
			order by e.beginn, e.id`;
		return z.map((zeile) => zuEinsatz(zeile));
	});
}
