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
 * nicht, dass es sie gibt. Das gilt auch beim Schreiben: Ändern, Status und Löschen bekommen die `Sicht` des
 * Nutzers – wer `auftraege.bearbeiten`, aber nicht `auftraege.alle_lesen` hat, ändert nur seine sichtbaren Aufträge
 * (Rechteprüfung macht der Aufrufer).
 */

export type Auftrag = {
	id: string;
	nummer: string;
	titel: string;
	kundeId: string;
	kundeName: string;
	objektId: string | null;
	objektBezeichnung: string | null;
	/** Einsatzort: Adresse des Objekts, sonst die Adresse des Kunden (Standard), sonst null. */
	adresse: string | null;
	adresseVonObjekt: boolean;
	/** Zuständige Mitarbeiter (nach Name). */
	zustaendige: { id: string; name: string }[];
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

/** `offen`: ohne abgerechnete Aufträge (z. B. Auswahl beim Einplanen). */
export type AuftragFilter = { status?: AuftragStatus; kundeId?: string; suche?: string; offen?: boolean };

export const MAX_AUFTRAEGE = 100;
export const MAX_ZUSTAENDIGE = 20;

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
 * zugewiesen oder er hat einen Einsatz darin.
 */
export function sichtbar(tx: TransactionSql, sicht: Sicht) {
	if (sicht.alle) return tx`true`;
	return tx`(
		exists (
			select 1 from app.todos t
			where t.auftrag_id = a.id and t.betrieb_id = a.betrieb_id and t.zustaendig_id = ${sicht.benutzerId}
		)
		or exists (
			select 1 from app.einsaetze e
			where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id and e.benutzer_id = ${sicht.benutzerId}
		)
		or exists (
			select 1 from app.auftrag_zustaendige z
			where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id and z.benutzer_id = ${sicht.benutzerId}
		)
	)`;
}

const AUSWAHL = `a.id, a.nummer, a.titel, a.kunde_id, a.objekt_id, a.status, a.beschreibung,
	to_char(a.geplant_ab, 'YYYY-MM-DD') as geplant_ab, a.angelegt, a.geaendert,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	o.bezeichnung as objekt_bezeichnung, o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
	k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort,
	(select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by public.unaccent(lower(b.name)), b.id), '[]')
		from app.auftrag_zustaendige z join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
		where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id) as zustaendige`;

const VON = `app.auftraege a
	join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
	left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id`;

const iso = (d: unknown) => new Date(d as string | Date).toISOString();

const adresseAus = (strasse: string | null, plz: string | null, ort: string | null) =>
	[strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

function zuAuftrag(z: Record<string, any>): Auftrag {
	const objektAdresse = z.objekt_id ? adresseAus(z.objekt_strasse, z.objekt_plz, z.objekt_ort) : null;
	return {
		id: z.id,
		nummer: z.nummer,
		titel: z.titel,
		kundeId: z.kunde_id,
		kundeName: anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname }),
		objektId: z.objekt_id,
		objektBezeichnung: z.objekt_bezeichnung ?? null,
		adresse: objektAdresse ?? adresseAus(z.kunde_strasse, z.kunde_plz, z.kunde_ort),
		adresseVonObjekt: objektAdresse !== null,
		zustaendige: typeof z.zustaendige === 'string' ? JSON.parse(z.zustaendige) : (z.zustaendige ?? []),
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
				${filter.offen ? tx`and a.status <> 'abgerechnet'` : tx``}
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

/** Liste zuständiger Mitarbeiter prüfen (IDs, ohne Doppelte, höchstens 20) – ohne Datenbank. */
export function pruefeZustaendigeEingabe(w: unknown): string[] {
	if (w === undefined || w === null || w === '') return [];
	const liste = Array.isArray(w) ? w : [w];
	if (liste.length > MAX_ZUSTAENDIGE) throw new ApiFehler(400, `Höchstens ${MAX_ZUSTAENDIGE} zuständige Mitarbeiter.`);
	const ids = liste.filter((x) => x !== '').map((x) => idFeld(x, 'Zuständig: ungültige Auswahl.')!);
	return [...new Set(ids)];
}

/** Formular: Häkchen „zustaendige“ – nur wenn das Formular sie gezeigt hat (Marker `zustaendigeGesendet`). */
export const zustaendigeAus = (f: FormData): { zustaendige?: FormDataEntryValue[] } =>
	f.has('zustaendigeGesendet') ? { zustaendige: f.getAll('zustaendige') } : {};

/** Zuständige setzen (ersetzt die bisherigen); jeder muss ein aktiver Mitarbeiter des Betriebs sein (sonst 400). */
async function setzeZustaendige(tx: TransactionSql, k: Kontext, auftragId: string, ids: string[]): Promise<void> {
	if (ids.length > 0) {
		const da = await tx`
			select id from app.benutzer where betrieb_id = ${k.betriebId} and aktiv and id = any(${ids}::uuid[])`;
		if (da.length !== ids.length) throw new ApiFehler(400, 'Zuständig kann nur ein aktiver Mitarbeiter des Betriebs sein.');
	}
	await tx`delete from app.auftrag_zustaendige where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId}`;
	if (ids.length > 0) {
		await tx`
			insert into app.auftrag_zustaendige ${tx(
				ids.map((b) => ({ betrieb_id: k.betriebId, auftrag_id: auftragId, benutzer_id: b })),
				'betrieb_id',
				'auftrag_id',
				'benutzer_id'
			)}`;
	}
}

/** Neuer Auftrag; optional `zustaendige` (Liste von Mitarbeiter-IDs). */
export async function legeAuftragAn(k: Kontext, e: Record<string, unknown>): Promise<Auftrag> {
	const w = pruefeAuftragEingabe(e);
	const zustaendige = pruefeZustaendigeEingabe(e.zustaendige);
	return mitBetrieb(k, async (tx) => {
		await pruefeBezuege(tx, k, w);
		const [z] = await tx`
			insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id, beschreibung, geplant_ab)
			values (${k.betriebId}, ${w.titel}, ${w.kundeId}, ${w.objektId}, ${w.beschreibung}, ${w.geplantAb})
			returning id`;
		await setzeZustaendige(tx, k, z.id, zustaendige);
		return ladeEinen(tx, k, ALLE(k.benutzerId), z.id);
	});
}

/**
 * Ändert einen Auftrag teilweise (angegebene Felder ersetzen die bisherigen; das Ergebnis wird als Ganzes geprüft).
 * Wechselt der Kunde und wird kein Objekt angegeben, entfällt das bisherige Objekt (es gehört zum alten Kunden).
 * Den Status ändert nur `setzeStatus`. `zustaendige` (falls angegeben) ersetzt die bisherigen Zuständigen.
 */
export async function aendereAuftrag(
	k: Kontext,
	id: string,
	e: Record<string, unknown>,
	sicht: Sicht = ALLE(k.benutzerId)
): Promise<Auftrag> {
	pruefeAuftragsId(id);
	const felder = AUFTRAG_FELDER.filter((f) => Object.hasOwn(e, f));
	const mitZustaendigen = Object.hasOwn(e, 'zustaendige');
	if (felder.length === 0 && !mitZustaendigen) throw new ApiFehler(400, 'Nichts zu ändern.');
	const zustaendige = mitZustaendigen ? pruefeZustaendigeEingabe(e.zustaendige) : null;
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select a.titel, a.kunde_id, a.objekt_id, a.beschreibung, to_char(a.geplant_ab, 'YYYY-MM-DD') as geplant_ab
			from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
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
		if (zustaendige) await setzeZustaendige(tx, k, id, zustaendige);
		// Wer sich selbst als Zuständigen entfernt und den Auftrag sonst nicht sieht, bekommt ihn trotzdem zurück
		return ladeEinen(tx, k, ALLE(k.benutzerId), id);
	});
}

/** Statuswechsel um genau einen Schritt (sonst 409 `Statuswechsel nicht erlaubt`). */
export async function setzeStatus(
	k: Kontext,
	id: string,
	nach: AuftragStatus,
	sicht: Sicht = ALLE(k.benutzerId)
): Promise<Auftrag> {
	pruefeStatus(nach);
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select a.status from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!alt) throw nichtGefunden();
		if (!erlaubterWechsel(alt.status, nach)) throw new ApiFehler(409, 'Statuswechsel nicht erlaubt');
		await tx`update app.auftraege set status = ${nach} where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, sicht, id);
	});
}

/** Löscht einen Auftrag samt To-dos – nur im Status „Anfrage“ und ohne Angebote (sonst 409). */
export async function loescheAuftrag(k: Kontext, id: string, sicht: Sicht = ALLE(k.benutzerId)): Promise<void> {
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const [sichtbarerAuftrag] = await tx`
			select a.id from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!sichtbarerAuftrag) throw nichtGefunden();
		// Angebote hängen ohne Kaskade am Auftrag (Stufe 1c): sie verschwinden nie „nebenbei“.
		const [mitAngebot] = await tx`select 1 from app.angebote where auftrag_id = ${id} and betrieb_id = ${k.betriebId} limit 1`;
		if (mitAngebot) throw new ApiFehler(409, 'Aufträge mit Angeboten können nicht gelöscht werden');
		const z = await tx`
			delete from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId} and status = 'anfrage' returning id`;
		if (z.length > 0) return;
		const [da] = await tx`select 1 from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (da) throw new ApiFehler(409, 'Nur Anfragen können gelöscht werden');
		throw nichtGefunden();
	});
}

export type KundenAuswahl = {
	/** `adresse`: Standardadresse des Kunden (Einsatzort, wenn kein Objekt gewählt ist). */
	kunde: { id: string; name: string; adresse: string | null } | null;
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
			select id, art, firma, vorname, nachname, strasse, plz, ort from app.kunden
			where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		if (!kunde) return { kunde: null, objekte: [] };
		const objekte = await tx`
			select id, bezeichnung, strasse, plz, ort from app.objekte
			where kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(bezeichnung)), id`;
		return {
			kunde: { id: kunde.id, name: anzeigeName(kunde as never), adresse: adresseAus(kunde.strasse, kunde.plz, kunde.ort) },
			objekte: objekte.map((o) => ({
				id: o.id,
				bezeichnung: o.bezeichnung,
				adresse: [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
			}))
		};
	});
}
