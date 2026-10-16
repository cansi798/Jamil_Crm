import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { anzeigeName, textFeld, UUID } from './kunden';
import { berlinTag, istTag } from '../zeit';

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
	auftragId: string;
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
	warnungen: Warnung[];
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

type EinsatzWerte = { auftragId: string; benutzerId: string; beginn: Date; ende: Date; notiz: string | null };

export const EINSATZ_FELDER = ['auftragId', 'benutzerId', 'beginn', 'ende', 'notiz'] as const;

/** Prüft einen vollständigen Einsatz (400 mit klarer Meldung). */
export function pruefeEinsatzEingabe(e: Record<string, unknown>): EinsatzWerte {
	const auftragId = idFeld(e.auftragId, 'Bitte einen Auftrag wählen.');
	const benutzerId = idFeld(e.benutzerId, 'Bitte einen Mitarbeiter wählen.');
	const beginn = zeitpunkt(e.beginn, 'Beginn');
	const ende = zeitpunkt(e.ende, 'Ende');
	if (ende.getTime() <= beginn.getTime()) throw new ApiFehler(400, 'Ende muss nach dem Beginn liegen');
	if (ende.getTime() - beginn.getTime() > MAX_STUNDEN * MS_STUNDE) {
		throw new ApiFehler(400, 'Ein Einsatz darf höchstens 14 Stunden dauern');
	}
	return { auftragId, benutzerId, beginn, ende, notiz: textFeld(e.notiz, 'Notiz', 500) };
}

const iso = (d: unknown) => new Date(d as string | Date).toISOString();
const adresse = (strasse: string | null, plz: string | null, ort: string | null) =>
	[strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

export const EINSATZ_AUSWAHL = `e.id, e.auftrag_id, e.benutzer_id, e.beginn, e.ende, e.notiz,
	a.nummer as auftrag_nummer, a.titel as auftrag_titel, b.name as benutzer_name,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort,
	o.id as objekt_id, o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort`;

export const EINSATZ_VON = `app.einsaetze e
	join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
	join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
	left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
	join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id`;

export function zuEinsatz(z: Record<string, any>, warnungen: Warnung[] = []): Einsatz {
	const objektOrt = z.objekt_id ? adresse(z.objekt_strasse, z.objekt_plz, z.objekt_ort) : null;
	return {
		id: z.id,
		auftragId: z.auftrag_id,
		auftragNummer: z.auftrag_nummer,
		auftragTitel: z.auftrag_titel,
		kundeName: anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname }),
		ort: objektOrt ?? adresse(z.kunde_strasse, z.kunde_plz, z.kunde_ort),
		benutzerId: z.benutzer_id,
		benutzerName: z.benutzer_name,
		beginn: iso(z.beginn),
		ende: iso(z.ende),
		notiz: z.notiz,
		warnungen
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
		await pruefeAuftrag(tx, k, w.auftragId);
		await pruefeMitarbeiter(tx, k, w.benutzerId);
		const [z] = await tx`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz)
			values (${k.betriebId}, ${w.auftragId}, ${w.benutzerId}, ${w.beginn}, ${w.ende}, ${w.notiz})
			returning id`;
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
	if (felder.length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select auftrag_id, benutzer_id, beginn, ende, notiz from app.einsaetze
			where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw einsatzNichtGefunden();
		const w = pruefeEinsatzEingabe({
			auftragId: alt.auftrag_id,
			benutzerId: alt.benutzer_id,
			beginn: iso(alt.beginn),
			ende: iso(alt.ende),
			notiz: alt.notiz,
			...Object.fromEntries(felder.map((f) => [f, e[f]]))
		});
		if (w.auftragId !== alt.auftrag_id) await pruefeAuftrag(tx, k, w.auftragId);
		if (w.benutzerId !== alt.benutzer_id) await pruefeMitarbeiter(tx, k, w.benutzerId);
		await tx`
			update app.einsaetze set auftrag_id = ${w.auftragId}, benutzer_id = ${w.benutzerId}, beginn = ${w.beginn},
				ende = ${w.ende}, notiz = ${w.notiz}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
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
