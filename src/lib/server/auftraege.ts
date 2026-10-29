import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { anzeigeName, likeMuster, sucheWoerter, textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { darfEines } from './tarif';
import { erlaubterWechsel, istStatus, STATUS, type AuftragStatus } from '../auftrag-status';
import { istArbeitsstand, naechsterGeltenderStatus, startStatus, statusUebersprungen, vorigerGeltenderStatus, type Arbeitsstand } from '../auftrag-board';
import { uebersprungeneSchritte } from './quellen';
import { istTag } from '../zeit';

/**
 * Fachlogik für Aufträge (Modul `auftraege`), gemeinsam genutzt von der API (`/api/auftraege`) und den Seiten unter
 * `/auftraege`. Alles läuft in `mitBetrieb` (RLS) und filtert zusätzlich ausdrücklich nach `betrieb_id`.
 *
 * Sichtbarkeit: Mit `auftraege.alle_lesen` sieht man alle Aufträge des Betriebs. Mit nur `auftraege.lesen` („eigene
 * Aufträge“) nur die, in denen man mindestens einen Einsatz hat oder für die einem eine Aufgabe zugewiesen ist. Fremde,
 * unsichtbare oder unbekannte Aufträge (auch kaputte IDs) sind immer ein 404, nie ein 403 – so verrät die Antwort
 * nicht, dass es sie gibt. Das gilt auch beim Schreiben: Ändern, Status und Löschen bekommen die `Sicht` des
 * Nutzers – wer `auftraege.bearbeiten`, aber nicht `auftraege.alle_lesen` hat, ändert nur seine sichtbaren Aufträge
 * (Rechteprüfung macht der Aufrufer).
 */

/** Wem der Auftrag gehört: Kunde aus der Kundendatenbank, Einmal-Kunde (nur am Auftrag) oder keinem (Phase 3). */
export const KUNDEN_ARTEN = ['kunde', 'einmal', 'ohne'] as const;
export type KundenArt = (typeof KUNDEN_ARTEN)[number];
export const OHNE_KUNDE = 'Ohne Kunde';

export type EinmalKunde = {
	name: string;
	telefon: string | null;
	email: string | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
};

export type Auftrag = {
	id: string;
	nummer: string;
	titel: string;
	kundeArt: KundenArt;
	/** null bei Einmal-Kunde oder ohne Kunde. */
	kundeId: string | null;
	/** Anzeigename: Kunde, Einmal-Kunde oder „Ohne Kunde“. */
	kundeName: string;
	einmalKunde: EinmalKunde | null;
	/** Telefon für „Anrufen“: Kunde bzw. Einmal-Kunde (Objekte haben keine eigene Nummer). */
	telefon: string | null;
	objektId: string | null;
	objektBezeichnung: string | null;
	/** Anlage am Objekt (z. B. Wärmepumpe), für die der Auftrag ist – optional. */
	anlageId: string | null;
	anlageBezeichnung: string | null;
	/** Woher kam der Auftrag (Website, Hornbach, …) – Wunsch Jamil msg 2593. */
	quelleId: string | null;
	quelleName: string | null;
	quelleFarbe: string | null;
	/** Übersprungene Schritte der Auftragsquelle (Jamil msg 3703, Migration 112); leer = alles gilt */
	quelleUebersprungen: string[];
	/** Einsatzort: Adresse des Objekts, sonst die Adresse des Kunden (Standard), sonst null. */
	adresse: string | null;
	adresseVonObjekt: boolean;
	/** Zuständige Mitarbeiter (nach Name). */
	zustaendige: { id: string; name: string }[];
	/** Nur in Listen: Bezug des angemeldeten Nutzers – zuständig, eigene Aufgabe, eigener Termin (Einsatz). */
	meinBezug?: ('zustaendig' | 'todo' | 'termin')[];
	status: AuftragStatus;
	beschreibung: string | null;
	/** Alt (vor den Terminen): nicht mehr im Formular; wird nur noch angezeigt, wenn es keine Termine gibt. */
	geplantAb: string | null;
	/** Nächster anstehender Termin (Einsatz, der noch nicht vorbei ist) – ersetzt „Geplant ab“ (Wunsch Jamil). */
	kommenderTermin: { beginn: string; art: string } | null;
	/** Gibt es überhaupt einen Termin (auch einen vergangenen)? – Untergruppe „Termin vereinbart“ bei Anfragen (Jamil msg 3601) */
	hatTermin: boolean;
	/**
	 * Kommender (oder gerade laufender) Termin zur Umsetzung eingetragen – Art Montage oder Wartung, keine Besichtigung?
	 * Untergruppe in „Beauftragt“ (msg 3655). VORLÄUFIGE Regel, bis Jamil sie festlegt (msg 3685). Nur kommende zählen: Termine haben standardmäßig die Art „Montage“, eine
	 * frühere Besichtigung aus der Anfrage-Zeit mit falscher Art soll den Auftrag nicht als „Termin bestätigt“ zeigen.
	 */
	hatUmsetzungstermin: boolean;
	/** Arbeitsstand im Status „In Arbeit“ (msg 3658, Migration 111): null = Arbeiten durchführen */
	arbeitsstand: Arbeitsstand | null;
	/** Abzeichen „Angebot verschickt 18.10.“ / „angenommen“ / „abgelehnt“ (Wunsch Jamil msg 2674). */
	angebotInfo: { status: 'versendet' | 'angenommen' | 'abgelehnt'; tag: string } | null;
	/** Nächstes Nachfassen (Tag in Berlin) und ob pausiert. */
	nachfassenInfo: { tag: string; pausiert: boolean } | null;
	angelegt: string;
	geaendert: string;
};

/** Wer liest: alle Aufträge des Betriebs oder nur die eigenen des Benutzers. */
export type Sicht = { alle: boolean; benutzerId: string };

export type AuftragWerte = {
	titel: string;
	kundeArt: KundenArt;
	kundeId: string | null;
	einmal: EinmalKunde | null;
	objektId: string | null;
	anlageId: string | null;
	quelleId: string | null;
	beschreibung: string | null;
	geplantAb: string | null;
};

/** `offen`: ohne abgerechnete Aufträge (z. B. Auswahl beim Einplanen). */
/** `meine`: nur Aufträge mit Bezug zum Nutzer (zuständig, eigene Aufgabe oder eigener Termin) – auch für Chefs. */
export type AuftragFilter = { status?: AuftragStatus; kundeId?: string; suche?: string; offen?: boolean; meine?: boolean; quelleId?: string; nachfassenFaellig?: boolean };

export const MAX_AUFTRAEGE = 100;
export const MAX_ZUSTAENDIGE = 20;

/** Felder, die beim Anlegen/Ändern angenommen werden (Formular und JSON). Status/Nummer gehören nicht dazu. */
export const EINMAL_FELDER = ['einmalName', 'einmalTelefon', 'einmalEmail', 'einmalStrasse', 'einmalPlz', 'einmalOrt'] as const;
export const AUFTRAG_FELDER = ['titel', 'kundeArt', 'kundeId', 'objektId', 'anlageId', 'quelleId', 'beschreibung', 'geplantAb', ...EINMAL_FELDER] as const;
/**
 * Felder der Auftrags-Formulare: ohne „Geplant ab“ (Wunsch Jamil, msgs 2525/2526 – dafür gibt es Termine). Die Spalte
 * bleibt (keine Daten verlieren); das Formular schickt das Feld nicht mehr, damit es beim Speichern nicht geleert wird.
 */
export const AUFTRAG_FORM_FELDER = AUFTRAG_FELDER.filter((f) => f !== 'geplantAb' && f !== 'anlageId');

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
	// Ohne Angabe: Kunde aus der Kundendatenbank (wie vor Phase 3 – API, Sprachsteuerung)
	const kundeArt = e.kundeArt === undefined || e.kundeArt === null || e.kundeArt === '' ? 'kunde' : e.kundeArt;
	if (!(KUNDEN_ARTEN as readonly unknown[]).includes(kundeArt)) throw new ApiFehler(400, 'Unbekannte Kundenart.');
	let kundeId: string | null = null;
	let einmal: EinmalKunde | null = null;
	if (kundeArt === 'kunde') {
		kundeId = idFeld(e.kundeId, 'Bitte einen Kunden wählen.');
		if (kundeId === null) throw new ApiFehler(400, 'Bitte einen Kunden wählen.');
	} else if (kundeArt === 'einmal') {
		const name = textFeld(e.einmalName, 'Name des Einmal-Kunden', 200);
		if (name === null) throw new ApiFehler(400, 'Bitte den Namen des Einmal-Kunden eingeben.');
		einmal = {
			name,
			telefon: textFeld(e.einmalTelefon, 'Telefon', 50),
			email: textFeld(e.einmalEmail, 'E-Mail', 200),
			strasse: textFeld(e.einmalStrasse, 'Straße', 200),
			plz: textFeld(e.einmalPlz, 'PLZ', 20),
			ort: textFeld(e.einmalOrt, 'Ort', 200)
		};
	}
	const objektId = idFeld(e.objektId, 'Das Objekt ist ungültig.');
	if (objektId !== null && kundeId === null) throw new ApiFehler(400, 'Ein Objekt gibt es nur mit einem Kunden aus der Kundendatenbank.');
	const anlageId = idFeld(e.anlageId, 'Die Anlage ist ungültig.');
	if (anlageId !== null && objektId === null) throw new ApiFehler(400, 'Eine Anlage gibt es nur mit einem Objekt.');
	const quelleId = idFeld(e.quelleId, 'Die Auftragsquelle ist ungültig.');
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 4000);
	let geplantAb: string | null = null;
	if (e.geplantAb !== undefined && e.geplantAb !== null && e.geplantAb !== '') {
		if (!istTag(e.geplantAb)) throw new ApiFehler(400, 'Das Datum „Geplant ab“ ist ungültig.');
		geplantAb = e.geplantAb;
	}
	return { titel, kundeArt: kundeArt as KundenArt, kundeId, einmal, objektId, anlageId, quelleId, beschreibung, geplantAb };
}

/** Prüft einen Statusfilter bzw. Zielstatus (400 bei unbekanntem Wert). */
export function pruefeStatus(w: unknown): AuftragStatus {
	if (!istStatus(w)) throw new ApiFehler(400, 'Unbekannter Status.');
	return w;
}

/**
 * SQL-Bedingung „für diese Sicht sichtbar“ (Alias `a` = app.auftraege). Eigene Aufträge: eine Aufgabe ist dem Benutzer
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
			-- Mitarbeiter einer Aufgabe (mehrere je Aufgabe, Jamil msgs 2977/2978)
			select 1 from app.todo_mitarbeiter tm join app.todos t on t.id = tm.todo_id and t.betrieb_id = tm.betrieb_id
			where t.auftrag_id = a.id and t.betrieb_id = a.betrieb_id and tm.benutzer_id = ${sicht.benutzerId}
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

/**
 * Nächstes Nachfassen eines Auftrags (Wunsch Jamil msg 2674): neuestes versendetes Angebot (Kunde nicht „kein
 * Nachfassen“) → frühestes von (offenes Nachfass-Aufgabe, nächste noch nicht gelaufene aktive Stufe = Versandtag + Tage).
 * Liefert Tag (Berlin) und ob pausiert – oder null.
 */
const NACHFASSEN_SQL = `(select json_build_object('tag', to_char(n.tag, 'YYYY-MM-DD'), 'pausiert', n.pausiert) from (
		select ag.nachfassen_pausiert as pausiert, least(
			(select min(t.faellig) from app.todos t
				join app.nachfass_laeufe l on l.id = t.nachfass_id and l.betrieb_id = t.betrieb_id
				where l.angebot_id = ag.id and l.betrieb_id = ag.betrieb_id and t.erledigt_am is null),
			(select (ag.versendet_am at time zone 'Europe/Berlin')::date + min(s.tage)
				from app.nachfass_stufen s
				where s.betrieb_id = ag.betrieb_id and s.art = 'angebot' and s.aktiv
					and s.tage > coalesce((select max(l2.tage) from app.nachfass_laeufe l2
						where l2.angebot_id = ag.id and l2.betrieb_id = ag.betrieb_id), -1))
		) as tag
		from app.angebote ag
		left join app.kunden kn on kn.id = coalesce(ag.kunde_id, a.kunde_id) and kn.betrieb_id = ag.betrieb_id
		where ag.auftrag_id = a.id and ag.betrieb_id = a.betrieb_id and ag.status = 'versendet' and ag.versendet_am is not null
			and not coalesce(kn.kein_nachfassen, false)
		order by ag.versendet_am desc, ag.id limit 1
	) n where n.tag is not null)`;

/** Maßgebliches Angebot für das Abzeichen: angenommen vor versendet vor abgelehnt (Entwürfe nicht), mit Tag. */
const ANGEBOT_SQL = `(select json_build_object('status', ag.status, 'tag',
		to_char((case when ag.status = 'versendet' then coalesce(ag.versendet_am, ag.geaendert) else ag.geaendert end) at time zone 'Europe/Berlin', 'YYYY-MM-DD'))
		from app.angebote ag
		where ag.auftrag_id = a.id and ag.betrieb_id = a.betrieb_id and ag.status in ('angenommen', 'versendet', 'abgelehnt')
		order by case ag.status when 'angenommen' then 0 when 'versendet' then 1 else 2 end, ag.angelegt desc limit 1)`;

/** Filter „Nachfassen fällig“: nächstes Nachfassen heute oder überfällig, nicht pausiert. */
export const NACHFASSEN_FAELLIG_SQL = `exists (select 1 from json_to_record(${NACHFASSEN_SQL}) as nf(tag date, pausiert boolean)
	where nf.tag <= (now() at time zone 'Europe/Berlin')::date and not nf.pausiert)`;

export const AUSWAHL = `a.id, a.nummer, a.titel, a.kunde_id, a.objekt_id, a.anlage_id, an.bezeichnung as anlage_bezeichnung,
	a.quelle_id, qu.name as quelle_name, qu.farbe as quelle_farbe, coalesce(qu.uebersprungen, '{}') as quelle_uebersprungen, a.status, a.beschreibung,
	to_char(a.geplant_ab, 'YYYY-MM-DD') as geplant_ab, a.angelegt, a.geaendert,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	o.bezeichnung as objekt_bezeichnung, o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
	k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort, k.telefon as kunde_telefon,
	a.einmal_name, a.einmal_telefon, a.einmal_email, a.einmal_strasse, a.einmal_plz, a.einmal_ort,
	(select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by public.unaccent(lower(b.name)), b.id), '[]')
		from app.auftrag_zustaendige z join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
		where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id) as zustaendige,
	(select json_build_object('beginn', e.beginn, 'art', e.art) from app.einsaetze e
		where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id and e.ende >= now()
		order by e.beginn, e.id limit 1) as kommender_termin,
	exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id) as hat_termin,
	exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
		and e.art in ('montage', 'wartung') and e.ende >= now()) as hat_umsetzungstermin,
	a.arbeitsstand,
	${ANGEBOT_SQL} as angebot_info,
	${NACHFASSEN_SQL} as nachfassen_info`;

export const VON = `app.auftraege a
	left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
	left join app.objekte o on o.id = a.objekt_id and o.betrieb_id = a.betrieb_id
	left join app.anlagen an on an.id = a.anlage_id and an.betrieb_id = a.betrieb_id
	left join app.auftrag_quellen qu on qu.id = a.quelle_id and qu.betrieb_id = a.betrieb_id`;

const iso = (d: unknown) => new Date(d as string | Date).toISOString();
const json = (w: unknown) => (typeof w === 'string' ? JSON.parse(w) : (w ?? null));

const adresseAus = (strasse: string | null, plz: string | null, ort: string | null) =>
	[strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

/**
 * Anzeigename aus einer Zeile mit Kunden-Spalten (`kunde_art`, `kunde_firma`, `kunde_vorname`, `kunde_nachname`; bei
 * left join ggf. null) und `einmal_name` – für Aufträge, Einsätze, Angebote, Sprachsteuerung und Protokolle.
 */
export function kundeNameAus(z: Record<string, any>): string {
	if (z.kunde_art) {
		return anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname });
	}
	return z.einmal_name ?? OHNE_KUNDE;
}

/** Einsatzort einer Zeile: Objekt, sonst Kunde, sonst Einmal-Kunde. */
export function ortAus(z: Record<string, any>): string | null {
	return (
		(z.objekt_id ? adresseAus(z.objekt_strasse, z.objekt_plz, z.objekt_ort) : null) ??
		adresseAus(z.kunde_strasse, z.kunde_plz, z.kunde_ort) ??
		adresseAus(z.einmal_strasse ?? null, z.einmal_plz ?? null, z.einmal_ort ?? null)
	);
}

export function zuAuftrag(z: Record<string, any>): Auftrag {
	const objektAdresse = z.objekt_id ? adresseAus(z.objekt_strasse, z.objekt_plz, z.objekt_ort) : null;
	return {
		id: z.id,
		nummer: z.nummer,
		titel: z.titel,
		kundeArt: z.kunde_id ? 'kunde' : z.einmal_name ? 'einmal' : 'ohne',
		kundeId: z.kunde_id ?? null,
		kundeName: kundeNameAus(z),
		einmalKunde: z.einmal_name
			? { name: z.einmal_name, telefon: z.einmal_telefon, email: z.einmal_email, strasse: z.einmal_strasse, plz: z.einmal_plz, ort: z.einmal_ort }
			: null,
		telefon: z.kunde_telefon ?? z.einmal_telefon ?? null,
		objektId: z.objekt_id,
		objektBezeichnung: z.objekt_bezeichnung ?? null,
		anlageId: z.anlage_id ?? null,
		anlageBezeichnung: z.anlage_bezeichnung ?? null,
		quelleId: z.quelle_id ?? null,
		quelleName: z.quelle_name ?? null,
		quelleFarbe: z.quelle_farbe ?? null,
		quelleUebersprungen: Array.isArray(z.quelle_uebersprungen) ? z.quelle_uebersprungen : [],
		adresse: ortAus(z),
		adresseVonObjekt: objektAdresse !== null,
		zustaendige: typeof z.zustaendige === 'string' ? JSON.parse(z.zustaendige) : (z.zustaendige ?? []),
		status: z.status,
		beschreibung: z.beschreibung,
		geplantAb: z.geplant_ab,
		kommenderTermin: (() => {
			const t = typeof z.kommender_termin === 'string' ? JSON.parse(z.kommender_termin) : z.kommender_termin;
			return t ? { beginn: iso(t.beginn), art: t.art } : null;
		})(),
		hatTermin: z.hat_termin === true,
		hatUmsetzungstermin: z.hat_umsetzungstermin === true,
		arbeitsstand: istArbeitsstand(z.arbeitsstand) ? z.arbeitsstand : null,
		angebotInfo: json(z.angebot_info),
		nachfassenInfo: json(z.nachfassen_info),
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
	if (filter.quelleId !== undefined && filter.quelleId !== 'ohne' && !UUID.test(filter.quelleId)) throw new ApiFehler(400, 'Ungültige Auftragsquelle.');
	return mitBetrieb(k, async (tx) => {
		const ich = sicht.benutzerId;
		const z = await tx`
			select ${tx.unsafe(AUSWAHL)},
				exists (select 1 from app.auftrag_zustaendige z where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id
					and z.benutzer_id = ${ich}) as mein_zustaendig,
				exists (select 1 from app.todos t where t.auftrag_id = a.id and t.betrieb_id = a.betrieb_id
					and t.zustaendig_id = ${ich}) as mein_todo,
				exists (select 1 from app.einsaetze e where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id
					and e.benutzer_id = ${ich}) as mein_termin
			from ${tx.unsafe(VON)}
			where a.betrieb_id = ${k.betriebId}
				and ${sichtbar(tx, sicht)}
				${filter.meine ? tx`and ${sichtbar(tx, { alle: false, benutzerId: ich })}` : tx``}
				${filter.status ? tx`and a.status = ${filter.status}` : tx``}
				${filter.kundeId ? tx`and a.kunde_id = ${filter.kundeId}` : tx``}
				${filter.quelleId ? (filter.quelleId === 'ohne' ? tx`and a.quelle_id is null` : tx`and a.quelle_id = ${filter.quelleId}`) : tx``}
				${filter.offen ? tx`and a.status <> 'abgerechnet'` : tx``}
				${filter.nachfassenFaellig ? tx`and ${tx.unsafe(NACHFASSEN_FAELLIG_SQL)}` : tx``}
				and not exists (
					select 1 from unnest(${muster}::text[]) as s(m)
					where not (
						lower(a.nummer) like lower(s.m)
						or lower(a.titel) like lower(s.m)
						or lower(coalesce(k.firma, '')) like lower(s.m)
						or lower(coalesce(k.vorname, '')) like lower(s.m)
						or lower(coalesce(k.nachname, '')) like lower(s.m)
						or lower(coalesce(a.einmal_name, '')) like lower(s.m)
					)
				)
			order by ${
				filter.meine || !sicht.alle
					? // „Meine Aufträge“: zuerst nach dem nächsten Termin (ohne Termin zuletzt), dann die neuesten
						tx`(select min(e.beginn) from app.einsaetze e
							where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id and e.ende >= now()) asc nulls last,`
					: tx``
			} a.angelegt desc, a.nummer desc
			limit ${MAX_AUFTRAEGE}`;
		return z.map((r) => ({
			...zuAuftrag(r),
			meinBezug: [
				...(r.mein_zustaendig ? ['zustaendig' as const] : []),
				...(r.mein_todo ? ['todo' as const] : []),
				...(r.mein_termin ? ['termin' as const] : [])
			]
		}));
	});
}

export async function holeAuftrag(k: Kontext, sicht: Sicht, id: string): Promise<Auftrag> {
	pruefeAuftragsId(id);
	return mitBetrieb(k, (tx) => ladeEinen(tx, k, sicht, id));
}

/** Kunde (und ggf. Objekt) müssen im eigenen Betrieb liegen und zusammenpassen – sonst 400 mit klarer Meldung. */
async function pruefeBezuege(tx: TransactionSql, k: Kontext, w: AuftragWerte): Promise<void> {
	if (w.kundeId === null) return;
	const [kunde] = await tx`
		select id from app.kunden where id = ${w.kundeId} and betrieb_id = ${k.betriebId} for key share`;
	if (!kunde) throw new ApiFehler(400, 'Der Kunde wurde nicht gefunden.');
	if (w.objektId !== null) {
		const [objekt] = await tx`
			select id from app.objekte
			where id = ${w.objektId} and kunde_id = ${w.kundeId} and betrieb_id = ${k.betriebId} for key share`;
		if (!objekt) throw new ApiFehler(400, 'Das Objekt gehört nicht zu diesem Kunden.');
	}
	if (w.quelleId !== null) {
		const [q] = await tx`select 1 from app.auftrag_quellen where id = ${w.quelleId} and betrieb_id = ${k.betriebId}`;
		if (!q) throw new ApiFehler(400, 'Die Auftragsquelle wurde nicht gefunden.');
	}
	if (w.anlageId !== null) {
		const [anlage] = await tx`
			select id from app.anlagen
			where id = ${w.anlageId} and objekt_id = ${w.objektId} and betrieb_id = ${k.betriebId} for key share`;
		if (!anlage) throw new ApiFehler(400, 'Die Anlage gehört nicht zu diesem Objekt.');
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
		// Überspringt die Auftragsquelle „Anfrage“, beginnt der Auftrag im ersten geltenden Status (msg 3703)
		const status = startStatus(await uebersprungeneSchritte(tx, k.betriebId, w.quelleId));
		const [z] = await tx`
			insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id, anlage_id, quelle_id, status, beschreibung, geplant_ab,
				einmal_name, einmal_telefon, einmal_email, einmal_strasse, einmal_plz, einmal_ort)
			values (${k.betriebId}, ${w.titel}, ${w.kundeId}, ${w.objektId}, ${w.anlageId}, ${w.quelleId}, ${status}, ${w.beschreibung}, ${w.geplantAb},
				${w.einmal?.name ?? null}, ${w.einmal?.telefon ?? null}, ${w.einmal?.email ?? null}, ${w.einmal?.strasse ?? null},
				${w.einmal?.plz ?? null}, ${w.einmal?.ort ?? null})
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
			select a.titel, a.kunde_id, a.objekt_id, a.anlage_id, a.quelle_id, a.beschreibung, to_char(a.geplant_ab, 'YYYY-MM-DD') as geplant_ab,
				a.einmal_name, a.einmal_telefon, a.einmal_email, a.einmal_strasse, a.einmal_plz, a.einmal_ort
			from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!alt) throw nichtGefunden();
		const bisher: Record<string, unknown> = {
			titel: alt.titel,
			kundeArt: alt.kunde_id ? 'kunde' : alt.einmal_name ? 'einmal' : 'ohne',
			einmalName: alt.einmal_name,
			einmalTelefon: alt.einmal_telefon,
			einmalEmail: alt.einmal_email,
			einmalStrasse: alt.einmal_strasse,
			einmalPlz: alt.einmal_plz,
			einmalOrt: alt.einmal_ort,
			kundeId: alt.kunde_id,
			objektId: alt.objekt_id,
			anlageId: alt.anlage_id,
			quelleId: alt.quelle_id,
			beschreibung: alt.beschreibung,
			geplantAb: alt.geplant_ab
		};
		const neu: Record<string, unknown> = { ...bisher, ...Object.fromEntries(felder.map((f) => [f, e[f]])) };
		// Neuer Kunde (auch: kein Kunde mehr) und kein Objekt angegeben → bisheriges Objekt entfällt
		const zielKunde = neu.kundeArt === 'kunde' || neu.kundeArt === undefined || neu.kundeArt === '' ? neu.kundeId : null;
		const kundeNeu = (typeof zielKunde === 'string' ? zielKunde.trim().toLowerCase() : null) !== alt.kunde_id;
		if (kundeNeu && !felder.includes('objektId')) neu.objektId = null;
		// Anderes Objekt und keine Anlage angegeben → bisherige Anlage entfällt (sie gehört zum alten Objekt)
		const zielObjekt = typeof neu.objektId === 'string' && neu.objektId !== '' ? neu.objektId.trim().toLowerCase() : null;
		if (zielObjekt !== alt.objekt_id && !felder.includes('anlageId')) neu.anlageId = null;
		const w = pruefeAuftragEingabe(neu);
		await pruefeBezuege(tx, k, w);
		await tx`
			update app.auftraege set titel = ${w.titel}, kunde_id = ${w.kundeId}, objekt_id = ${w.objektId}, anlage_id = ${w.anlageId},
				quelle_id = ${w.quelleId},
				beschreibung = ${w.beschreibung}, geplant_ab = ${w.geplantAb},
				einmal_name = ${w.einmal?.name ?? null}, einmal_telefon = ${w.einmal?.telefon ?? null},
				einmal_email = ${w.einmal?.email ?? null}, einmal_strasse = ${w.einmal?.strasse ?? null},
				einmal_plz = ${w.einmal?.plz ?? null}, einmal_ort = ${w.einmal?.ort ?? null}
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (zustaendige) await setzeZustaendige(tx, k, id, zustaendige);
		// Wer sich selbst als Zuständigen entfernt und den Auftrag sonst nicht sieht, bekommt ihn trotzdem zurück
		return ladeEinen(tx, k, ALLE(k.benutzerId), id);
	});
}

/**
 * Einmal-Kunden in die Kundendatenbank übernehmen: legt einen Privatkunden (Nachname = Name, Kontakt und Adresse) an
 * und verknüpft ihn; die Einmal-Angaben am Auftrag entfallen. Kein Einmal-Kunde → 409.
 */
export async function uebernimmEinmalKunde(k: Kontext, id: string, sicht: Sicht = ALLE(k.benutzerId)): Promise<Auftrag> {
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const [a] = await tx`
			select a.einmal_name, a.einmal_telefon, a.einmal_email, a.einmal_strasse, a.einmal_plz, a.einmal_ort
			from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!a) throw nichtGefunden();
		if (!a.einmal_name) throw new ApiFehler(409, 'Dieser Auftrag hat keinen Einmal-Kunden.');
		const [kd] = await tx`
			insert into app.kunden (betrieb_id, art, nachname, telefon, email, strasse, plz, ort)
			values (${k.betriebId}, 'privat', ${a.einmal_name}, ${a.einmal_telefon}, ${a.einmal_email}, ${a.einmal_strasse},
				${a.einmal_plz}, ${a.einmal_ort})
			returning id`;
		await tx`
			update app.auftraege set kunde_id = ${kd.id}, einmal_name = null, einmal_telefon = null, einmal_email = null,
				einmal_strasse = null, einmal_plz = null, einmal_ort = null
			where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, ALLE(k.benutzerId), id);
	});
}

/** Statuswechsel um genau einen (geltenden) Schritt (sonst 409 `Statuswechsel nicht erlaubt`). */
export async function setzeStatus(
	k: Kontext,
	id: string,
	nach: AuftragStatus,
	sicht: Sicht = ALLE(k.benutzerId),
	/** Statusleiste im Auftrag (Wunsch Jamil, msg 2581): direkt auf eine Station springen, nicht nur einen Schritt. */
	opts: { sprung?: boolean } = {}
): Promise<Auftrag> {
	pruefeStatus(nach);
	pruefeAuftragsId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select a.status, coalesce(q.uebersprungen, '{}') as uebersprungen from app.auftraege a
			left join app.auftrag_quellen q on q.id = a.quelle_id and q.betrieb_id = a.betrieb_id
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!alt) throw nichtGefunden();
		// Ablauf je Auftragsquelle (msg 3703): Ein Schritt vor/zurück landet im nächsten bzw. vorigen GELTENDEN Status –
		// übersprungene Status werden dabei ausgelassen. Ein ausdrücklicher Sprung (Statusleiste) darf jede Station wählen.
		const ueb: string[] = alt.uebersprungen ?? [];
		let ziel: AuftragStatus | null = nach;
		if (!opts.sprung) {
			const vor = STATUS.indexOf(nach) > STATUS.indexOf(alt.status);
			const geltend = vor ? naechsterGeltenderStatus(alt.status, ueb) : vorigerGeltenderStatus(alt.status, ueb);
			ziel = erlaubterWechsel(alt.status, nach) || nach === geltend ? (statusUebersprungen(nach, ueb) ? geltend : nach) : null;
		}
		const erlaubt = ziel !== null && ziel !== alt.status;
		if (!erlaubt) throw new ApiFehler(409, 'Statuswechsel nicht erlaubt');
		await tx`update app.auftraege set status = ${ziel} where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, sicht, id);
	});
}

/**
 * Arbeitsstand im Status „In Arbeit“ setzen (msg 3658): `null` = Arbeiten durchführen, `qualitaet`, `abnahme`.
 * Nur solange der Auftrag „In Arbeit“ ist (sonst 409); bei jedem Statuswechsel leert ein Trigger das Feld (Migration 111).
 */
export async function setzeArbeitsstand(k: Kontext, id: string, stand: unknown, sicht: Sicht = ALLE(k.benutzerId)): Promise<Auftrag> {
	pruefeAuftragsId(id);
	const wert = stand === null || stand === '' || stand === 'arbeiten' ? null : istArbeitsstand(stand) ? stand : undefined;
	if (wert === undefined) throw new ApiFehler(400, 'Unbekannter Arbeitsstand');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select a.status from app.auftraege a
			where a.id = ${id} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of a`;
		if (!alt) throw nichtGefunden();
		if (alt.status !== 'in_arbeit') throw new ApiFehler(409, 'Den Arbeitsstand gibt es nur im Status „In Arbeit“');
		await tx`update app.auftraege set arbeitsstand = ${wert} where id = ${id} and betrieb_id = ${k.betriebId}`;
		return ladeEinen(tx, k, sicht, id);
	});
}

/** Löscht einen Auftrag samt Aufgaben – nur im Status „Anfrage“ und ohne Angebote (sonst 409). */
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
