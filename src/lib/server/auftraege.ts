import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { anzeigeName, likeMuster, sucheWoerter, textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { darfEines } from './tarif';
import { erlaubterWechsel, istStatus, type AuftragStatus } from '../auftrag-status';
import { istTag } from '../zeit';

/**
 * Fachlogik für Aufträge (Modul `auftraege`), gemeinsam genutzt von der API (`/api/auftraege`) und den Seiten unter
 * `/auftraege`. Alles läuft in `mitBetrieb` (RLS) und filtert zusätzlich ausdrücklich nach `betrieb_id`.
 *
 * Sichtbarkeit: Mit `auftraege.alle_lesen` sieht man alle Aufträge des Betriebs. Mit nur `auftraege.lesen` („eigene
 * Aufträge“) nur die, in denen man mindestens einen Einsatz hat oder für die einem ein To-do zugewiesen ist. Fremde,
 * unsichtbare oder unbekannte Aufträge (auch kaputte IDs) sind immer ein 404, nie ein 403 – so verrät die Antwort
 * nicht, dass es sie gibt. Schreibende Funktionen bekommen keine `Sicht`: Wer `auftraege.bearbeiten` hat, darf jeden
 * Auftrag seines Betriebs ändern (Rechteprüfung macht der Aufrufer).
 */

export type Auftrag = {
	id: string;
	nummer: string;
	titel: string;
	kundeId: string;
	kundeName: string;
	objektId: string | null;
	objektBezeichnung: string | null;
	status: AuftragStatus;
	beschreibung: string | null;
	geplantAb: string | null;
	angelegt: string;
	geaendert: string;
};

/** Wer liest: alle Aufträge des Betriebs oder nur die eigenen des Benutzers. */
export type Sicht = { alle: boolean; benutzerId: string };

export type AuftragWerte = {
	titel: string;
	kundeId: string;
	objektId: string | null;
	beschreibung: string | null;
	geplantAb: string | null;
};

export type AuftragFilter = { status?: AuftragStatus; kundeId?: string; suche?: string };

export const MAX_AUFTRAEGE = 100;

/** Felder, die beim Anlegen/Ändern angenommen werden (Formular und JSON). Status/Nummer gehören nicht dazu. */
export const AUFTRAG_FELDER = ['titel', 'kundeId', 'objektId', 'beschreibung', 'geplantAb'] as const;

const nichtGefunden = () => new ApiFehler(404, 'Auftrag nicht gefunden.');

export function pruefeAuftragsId(id: string): string {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	return id;
}

/** Sicht aus den Rechten des Nutzers. */
export function sichtVon(nutzer: Nutzer): Sicht {
	return { alle: hatRecht(nutzer, 'auftraege.alle_lesen'), benutzerId: nutzer.id };
}

/** Leserecht prüfen (Modul `auftraege` + `auftraege.lesen` oder `auftraege.alle_lesen`) und die Sicht liefern. */
export async function auftragsSicht(locals: { nutzer: Nutzer | null }): Promise<Sicht> {
	await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	return sichtVon(locals.nutzer!);
}

function idFeld(wert: unknown, meldung: string): string | null {
	if (wert === undefined || wert === null || wert === '') return null;
	if (typeof wert !== 'string' || !UUID.test(wert.trim())) throw new ApiFehler(400, meldung);
	return wert.trim().toLowerCase();
}

/** Prüft die Eingaben eines Auftrags (vollständiger Satz) und liefert bereinigte Werte (400 bei Fehlern). */
export function pruefeAuftragEingabe(e: Record<string, unknown>): AuftragWerte {
	const titel = textFeld(e.titel, 'Titel', 200);
	if (titel === null) throw new ApiFehler(400, 'Bitte einen Titel eingeben.');
	const kundeId = idFeld(e.kundeId, 'Bitte einen Kunden wählen.');
	if (kundeId === null) throw new ApiFehler(400, 'Bitte einen Kunden wählen.');
	const objektId = idFeld(e.objektId, 'Das Objekt ist ungültig.');
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 4000);
	let geplantAb: string | null = null;
	if (e.geplantAb !== undefined && e.geplantAb !== null && e.geplantAb !== '') {
		if (!istTag(e.geplantAb)) throw new ApiFehler(400, 'Das Datum „Geplant ab“ ist ungültig.');
		geplantAb = e.geplantAb;
	}
	return { titel, kundeId, objektId, beschreibung, geplantAb };
}

/** Prüft einen Statusfilter bzw. Zielstatus (400 bei unbekanntem Wert). */
export function pruefeStatus(w: unknown): AuftragStatus {
	if (!istStatus(w)) throw new ApiFehler(400, 'Unbekannter Status.');
	return w;
}

/**
 * SQL-Bedingung „für diese Sicht sichtbar“ (Alias `a` = app.auftraege). Eigene Aufträge: ein To-do ist dem Benutzer
 * zugewiesen oder er hat einen Einsatz darin (Tabelle einsaetze ab Migration 012 – vorher nur To-dos).
 */
export function sichtbar(tx: TransactionSql, sicht: Sicht) {
	if (sicht.alle) return tx`true`;
	return tx`(
		exists (
			select 1 from app.todos t
			where t.auftrag_id = a.id and t.betrieb_id = a.betrieb_id and t.zustaendig_id = ${sicht.benutzerId}
		)
		${EINSAETZE_SICHTBAR ? tx`or exists (
			select 1 from app.einsaetze e
			where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id and e.benutzer_id = ${sicht.benutzerId}
		)` : tx``}
	)`;
}

/** Ab Task 6 (Migration 012) machen auch Einsätze einen Auftrag zum „eigenen“. */
const EINSAETZE_SICHTBAR = false;

const AUSWAHL = `a.id, a.nummer, a.titel, a.kunde_id, a.objekt_id, a.status, a.beschreibung,
	to_char(a.geplant_ab, 'YYYY-MM-DD') as geplant_ab, a.angelegt, a.geaendert,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	o.bezeichnung as objekt_bezeichnung`;

const VON = `app.auftraege a
	join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
	left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id`;

const iso = (d: unknown) => new Date(d as string | Date).toISOString();

function zuAuftrag(z: Record<string, any>): Auftrag {
	return {
		id: z.id,
		nummer: z.nummer,
		titel: z.titel,
		kundeId: z.kunde_id,
		kundeName: anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname }),
		objektId: z.objekt_id,
		objektBezeichnung: z.objekt_bezeichnung ?? null,
		status: z.status,
		beschreibung: z.beschreibung,
		geplantAb: z.geplant_ab,
		angelegt: iso(z.angelegt),
		geaendert: iso(z.geaendert)
	};
}

async function ladeEinen(tx: TransactionSql, k: Kontext, sicht: Sicht, id: string): Promise<Auftrag> {
	const [z] = await tx`
		select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
		where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}`;
	if (!z) throw nichtGefunden();
	return zuAuftrag(z);
}

/**
 * Aufträge, neueste zuerst, höchstens 100. Filter: Status, Kunde, Suche (jedes Wort muss in Nummer, Titel oder
 * Kundenname vorkommen; Groß-/Kleinschreibung egal, LIKE-Platzhalter wirken nicht – wie bei Kunden).
 */
export async function listeAuftraege(k: Kontext, sicht: Sicht, filter: AuftragFilter): Promise<Auftrag[]> {
	const muster = sucheWoerter(filter.suche).map(likeMuster);
	if (filter.status !== undefined) pruefeStatus(filter.status);
	if (filter.kundeId !== undefined && !UUID.test(filter.kundeId)) throw new ApiFehler(400, 'Ungültiger Kunde.');
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
			where a.betrieb_id = ${k.betriebId}
				and ${sichtbar(tx, sicht)}
				${filter.status ? tx`and a.status = ${filter.status}` : tx``}
				${filter.kundeId ? tx`and a.kunde_id = ${filter.kundeId}` : tx``}
				and not exists (
					select 1 from unnest(${muster}::text[]) as s(m)
					where not (
						lower(a.nummer) like lower(s.m)
						or lower(a.titel) like lower(s.m)
						or lower(coalesce(k.firma, '')) like lower(s.m)
						or lower(coalesce(k.vorname, '')) like lower(s.m)
						or lower(coalesce(k.nachname, '')) like lower(s.m)
					)
				)
			order by a.angelegt desc, a.nummer desc
			limit ${MAX_AUFTRAEGE}`;
		return z.map(zuAuftrag);
	});
}

export async function holeAuftrag(k: Kontext, sicht: Sicht, id: string): Promise<Auftrag> {
	pruefeAuftragsId(id);
	return mitBetrieb(k, (tx) => ladeEinen(tx, k, sicht, id));
}

/** Kunde (und ggf. Objekt) müssen im eigenen Betrieb liegen und zusammenpassen – sonst 400 mit klarer Meldung. */
async function pruefeBezuege(tx: TransactionSql, k: Kontext, w: AuftragWerte): Promise<void> {
	const [kunde] = await tx`
		select id from app.kunden where id = ${w.kundeId} and betrieb_id = ${k.betriebId} for key share`;
	if (!kunde) throw new ApiFehler(400, 'Der Kunde wurde nicht gefunden.');
	if (w.objektId !== null) {
		const [objekt] = await tx`
			select id from app.objekte
			where id = ${w.objektId} and kunde_id = ${w.kundeId} and betrieb_id = ${k.betriebId} for key share`;
		if (!objekt) throw new ApiFehler(400, 'Das Objekt gehört nicht zu diesem Kunden.');
	}
}

const ALLE: (benutzerId: string) => Sicht = (benutzerId) => ({ alle: true, benutzerId });

export async function legeAuftragAn(k: Kontext, e: Record<string, unknown>): Promise<Auftrag> {
	const w = pruefeAuftragEingabe(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeBezuege(tx, k, w);
		const [z] = await tx`
			insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id, beschreibung, geplant_ab)
			values (${k.betriebId}, ${w.titel}, ${w.kundeId}, ${w.objektId}, ${w.beschreibung}, ${w.geplantAb})
			returning id`;
		return ladeEinen(tx, k, ALLE(k.benutzerId), z.id);
	});
}

/**
 * Ändert einen Auftrag teilweise (angegebene Felder ersetzen die bisherigen; das Ergebnis wird als Ganzes geprüft).
 * Wechselt der Kunde und wird kein Objekt angegeben, entfällt das bisherige Objekt (es gehört zum alten Kunden).
 * Den Status ändert nur `setzeStatus`.
 */
export async function aendereAuftrag(k: Kontext, id: string, e: Record<string, unknown>): Promise<Auftrag> {
	pruefeAuftragsId(id);
	const felder = AUFTRAG_FELDER.filter((f) => Object.hasOwn(e, f));
	if (felder.length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select titel, kunde_id, objekt_id, beschreibung, to_char(geplant_ab, 'YYYY-MM-DD') as geplant_ab
			from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		const bisher: Record<string, unknown> = {
			titel: alt.titel,
			kundeId: alt.kunde_id,
			objektId: alt.objekt_id,
			beschreibung: alt.beschreibung,
			geplantAb: alt.geplant_ab
		};
		const neu: Record<string, unknown> = { ...bisher, ...Object.fromEntries(felder.map((f) => [f, e[f]])) };
		const kundeNeu = typeof neu.kundeId === 'string' && neu.kundeId.trim().toLowerCase() !== alt.kunde_id;
		if (kundeNeu && !felder.includes('objektId')) neu.objektId = null;
		const w = pruefeAuftragEingabe(neu);
		await pruefeBezuege(tx, k, w);
		await tx`
			update app.auftraege set titel = ${w.titel}, kunde_id = ${w.kundeId}, objekt_id = ${w.objektId},
				beschreibung = ${w.beschreibung}, geplant_ab = ${w.geplantAb}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, ALLE(k.benutzerId), id);
	});
}

/** Statuswechsel um genau einen Schritt (sonst 409 `Statuswechsel nicht erlaubt`). */
export async function setzeStatus(k: Kontext, id: string, nach: AuftragStatus): Promise<Auftrag> {
	pruefeStatus(nach);
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select status from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		if (!erlaubterWechsel(alt.status, nach)) throw new ApiFehler(409, 'Statuswechsel nicht erlaubt');
		await tx`update app.auftraege set status = ${nach} where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, ALLE(k.benutzerId), id);
	});
}

/** Löscht einen Auftrag samt To-dos – nur im Status „Anfrage“ (sonst 409). */
export async function loescheAuftrag(k: Kontext, id: string): Promise<void> {
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			delete from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId} and status = 'anfrage' returning id`;
		if (z.length > 0) return;
		const [da] = await tx`select 1 from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (da) throw new ApiFehler(409, 'Nur Anfragen können gelöscht werden');
		throw nichtGefunden();
	});
}

export type KundenAuswahl = {
	kunde: { id: string; name: string } | null;
	objekte: { id: string; bezeichnung: string; adresse: string }[];
};

/**
 * Für das Auftragsformular: Name und Objekte eines Kunden (z. B. aus `?kunde=` oder nach einem Formularfehler).
 * Unbekannte, fremde oder kaputte IDs ergeben einfach „kein Kunde gewählt“ statt einer Fehlerseite.
 */
export async function ladeKundenAuswahl(k: Kontext, kundeId: string | null | undefined): Promise<KundenAuswahl> {
	if (!kundeId || !UUID.test(kundeId)) return { kunde: null, objekte: [] };
	return mitBetrieb(k, async (tx) => {
		const [kunde] = await tx`
			select id, art, firma, vorname, nachname from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		if (!kunde) return { kunde: null, objekte: [] };
		const objekte = await tx`
			select id, bezeichnung, strasse, plz, ort from app.objekte
			where kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(bezeichnung)), id`;
		return {
			kunde: { id: kunde.id, name: anzeigeName(kunde as never) },
			objekte: objekte.map((o) => ({
				id: o.id,
				bezeichnung: o.bezeichnung,
				adresse: [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
			}))
		};
	});
}
