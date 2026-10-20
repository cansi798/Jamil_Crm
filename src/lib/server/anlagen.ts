import { randomBytes } from 'node:crypto';
import { mitBetrieb, systemAbfrage, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { pruefeDateiInhalt, bereinigeDateiname, KUNDEN_DATEI_MAX } from './kundenakte';
import { sichtbar, type Sicht } from './auftraege';
import { legeTodoAn, type TodoSicht } from './todos';
import { ANLAGEN_TYPEN, TYP_NAMEN, istAnlagenTyp, pruefeExtra, type AnlagenTyp, type Extra } from '../anlagen-typen';
import { istRegel, regelText, type Regel } from '../wiederholung';
import { berlinTag, istTag, tagPlus } from '../zeit';

/**
 * Anlagen an Objekten (Wunsch Jamil, msgs 2503/2505; Migration 032): Stammdaten mit typabhängigen Zusatzfeldern,
 * Verlauf (Aufträge, Aufgaben, Störungen), Fotos/Dokumente und ein QR-Code mit zufälligem Kürzel (`qrToken`).
 *
 * Lesen: `kunden.lesen`, Schreiben: `kunden.bearbeiten` – geprüft von den Aufrufern. Fremde oder unbekannte Anlagen
 * sind immer ein 404. Der QR-Code ohne Anmeldung (`anlagePerQr`) liefert nur Typ und Kontakt des Betriebs.
 */

export type Anlage = {
	id: string;
	objektId: string;
	objektBezeichnung: string;
	objektAdresse: string | null;
	kundeId: string;
	kundeName: string;
	typ: AnlagenTyp;
	typName: string;
	bezeichnung: string;
	hersteller: string | null;
	modell: string | null;
	seriennummer: string | null;
	baujahr: number | null;
	einbaudatum: string | null;
	standort: string | null;
	garantieBis: string | null;
	wartungRegel: Regel | null;
	wartungIntervall: number | null;
	/** „jährlich“, „alle 6 Monate“ … oder null. */
	wartungText: string | null;
	extra: Extra;
	notiz: string | null;
	qrToken: string;
	/** Offene Störungen (nicht behoben). */
	offeneStoerungen: number;
	angelegt: string;
	geaendert: string;
};

export const ANLAGE_FELDER = [
	'typ',
	'bezeichnung',
	'hersteller',
	'modell',
	'seriennummer',
	'baujahr',
	'einbaudatum',
	'standort',
	'garantieBis',
	'wartungRegel',
	'wartungIntervall',
	'notiz'
] as const;

export type AnlageWerte = {
	typ: AnlagenTyp;
	bezeichnung: string;
	hersteller: string | null;
	modell: string | null;
	seriennummer: string | null;
	baujahr: number | null;
	einbaudatum: string | null;
	standort: string | null;
	garantieBis: string | null;
	wartungRegel: Regel | null;
	wartungIntervall: number | null;
	extra: Extra;
	notiz: string | null;
};

/** Garantie-Erinnerung: Aufgabe so viele Tage vor Ablauf (nicht vor heute). */
export const GARANTIE_VORLAUF_TAGE = 30;
export const GARANTIE_TITEL = 'Garantie endet:';

const nichtGefunden = (was = 'Anlage') => new ApiFehler(404, `${was} nicht gefunden.`);

function idOder404(id: unknown, was = 'Anlage'): string {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden(was);
	return id.trim().toLowerCase();
}

/** Zufälliges, nicht erratbares Kürzel für den QR-Code (24 Zeichen base64url = 144 Bit). */
export function neuesQrToken(): string {
	return randomBytes(18).toString('base64url');
}

const leer = (w: unknown) => w === undefined || w === null || w === '';

/** Prüft die Eingaben einer Anlage (vollständiger Satz) – 400 mit deutscher Meldung bei Fehlern. */
export function pruefeAnlageEingabe(e: Record<string, unknown>, extraRoh: Record<string, unknown> = {}): AnlageWerte {
	if (!istAnlagenTyp(e.typ)) throw new ApiFehler(400, 'Bitte einen Anlagentyp wählen.');
	const bezeichnung = textFeld(e.bezeichnung, 'Bezeichnung', 200) ?? TYP_NAMEN[e.typ];
	let baujahr: number | null = null;
	if (!leer(e.baujahr)) {
		const n = Number(String(e.baujahr).trim());
		if (!Number.isInteger(n) || n < 1900 || n > 2100) throw new ApiFehler(400, 'Baujahr: Bitte eine Jahreszahl (z. B. 2021) eingeben.');
		baujahr = n;
	}
	const datum = (w: unknown, name: string): string | null => {
		if (leer(w)) return null;
		if (!istTag(w)) throw new ApiFehler(400, `${name}: Bitte ein gültiges Datum wählen.`);
		return w;
	};
	let wartungRegel: Regel | null = null;
	let wartungIntervall: number | null = null;
	if (!leer(e.wartungRegel)) {
		if (!istRegel(e.wartungRegel)) throw new ApiFehler(400, 'Wartung: Bitte einen Rhythmus wählen.');
		wartungRegel = e.wartungRegel;
		const n = leer(e.wartungIntervall) ? 1 : Number(String(e.wartungIntervall).trim());
		if (!Number.isInteger(n) || n < 1 || n > 365) throw new ApiFehler(400, 'Wartung: „alle …“ muss eine Zahl von 1 bis 365 sein.');
		wartungIntervall = n;
	}
	let extra: Extra;
	try {
		extra = pruefeExtra(e.typ, extraRoh);
	} catch (f) {
		throw new ApiFehler(400, (f as Error).message);
	}
	return {
		typ: e.typ,
		bezeichnung,
		hersteller: textFeld(e.hersteller, 'Hersteller', 200),
		modell: textFeld(e.modell, 'Modell', 200),
		seriennummer: textFeld(e.seriennummer, 'Seriennummer', 100),
		baujahr,
		einbaudatum: datum(e.einbaudatum, 'Einbaudatum'),
		standort: textFeld(e.standort, 'Standort im Objekt', 200),
		garantieBis: datum(e.garantieBis, 'Garantie bis'),
		wartungRegel,
		wartungIntervall,
		extra,
		notiz: textFeld(e.notiz, 'Notiz', 2000)
	};
}

const AUSWAHL = `an.id, an.objekt_id, an.typ, an.bezeichnung, an.hersteller, an.modell, an.seriennummer, an.baujahr,
	to_char(an.einbaudatum, 'YYYY-MM-DD') as einbaudatum, an.standort, to_char(an.garantie_bis, 'YYYY-MM-DD') as garantie_bis,
	an.wartung_regel, an.wartung_intervall, an.extra, an.notiz, an.qr_token, an.angelegt, an.geaendert,
	o.bezeichnung as objekt_bezeichnung, o.strasse as objekt_strasse, o.plz as objekt_plz, o.ort as objekt_ort,
	k.id as kunde_id, k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	(select count(*) from app.anlagen_stoerungen st
		where st.anlage_id = an.id and st.betrieb_id = an.betrieb_id and st.behoben_am is null)::int as offene_stoerungen`;

const VON = `app.anlagen an
	join app.objekte o on o.id = an.objekt_id and o.betrieb_id = an.betrieb_id
	join app.kunden k on k.id = o.kunde_id and k.betrieb_id = o.betrieb_id`;

function zuAnlage(z: Record<string, any>): Anlage {
	const typ = z.typ as AnlagenTyp;
	const ort = [z.objekt_strasse, [z.objekt_plz, z.objekt_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return {
		id: z.id,
		objektId: z.objekt_id,
		objektBezeichnung: z.objekt_bezeichnung,
		objektAdresse: ort || null,
		kundeId: z.kunde_id,
		kundeName: z.kunde_art === 'firma' ? (z.kunde_firma ?? '') : [z.kunde_vorname, z.kunde_nachname].filter(Boolean).join(' '),
		typ,
		typName: TYP_NAMEN[typ],
		bezeichnung: z.bezeichnung,
		hersteller: z.hersteller ?? null,
		modell: z.modell ?? null,
		seriennummer: z.seriennummer ?? null,
		baujahr: z.baujahr ?? null,
		einbaudatum: z.einbaudatum ?? null,
		standort: z.standort ?? null,
		garantieBis: z.garantie_bis ?? null,
		wartungRegel: z.wartung_regel ?? null,
		wartungIntervall: z.wartung_intervall ?? null,
		wartungText: z.wartung_regel ? regelText(z.wartung_regel, Number(z.wartung_intervall), null) : null,
		extra: (typeof z.extra === 'string' ? JSON.parse(z.extra) : z.extra) ?? {},
		notiz: z.notiz ?? null,
		qrToken: z.qr_token,
		offeneStoerungen: Number(z.offene_stoerungen ?? 0),
		angelegt: new Date(z.angelegt).toISOString(),
		geaendert: new Date(z.geaendert).toISOString()
	};
}

async function ladeEine(tx: TransactionSql, k: Kontext, id: string): Promise<Anlage> {
	const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)} where an.id = ${id} and an.betrieb_id = ${k.betriebId}`;
	if (!z) throw nichtGefunden();
	return zuAnlage(z);
}

/** Anlagen eines Objekts (Objekt muss zum Kunden gehören, sonst 404). */
export async function listeAnlagen(k: Kontext, kundeId: string, objektId: string): Promise<Anlage[]> {
	const kid = idOder404(kundeId, 'Objekt');
	const oid = idOder404(objektId, 'Objekt');
	return mitBetrieb(k, async (tx) => {
		const [o] = await tx`select 1 from app.objekte where id = ${oid} and kunde_id = ${kid} and betrieb_id = ${k.betriebId}`;
		if (!o) throw nichtGefunden('Objekt');
		const z = await tx`
			select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
			where an.objekt_id = ${oid} and an.betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(an.bezeichnung)), an.id`;
		return z.map(zuAnlage);
	});
}

/** Kurze Auswahlliste der Anlagen eines Objekts (z. B. für den Auftrag) – unbekanntes Objekt → leere Liste. */
export async function anlagenAuswahl(k: Kontext, objektId: string | null): Promise<{ id: string; bezeichnung: string; typName: string }[]> {
	if (!objektId || !UUID.test(objektId)) return [];
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id, bezeichnung, typ from app.anlagen where objekt_id = ${objektId} and betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(bezeichnung)), id`;
		return z.map((r) => ({ id: r.id, bezeichnung: r.bezeichnung, typName: TYP_NAMEN[r.typ as AnlagenTyp] }));
	});
}

export async function holeAnlage(k: Kontext, id: string): Promise<Anlage> {
	const aid = idOder404(id);
	return mitBetrieb(k, (tx) => ladeEine(tx, k, aid));
}

/**
 * Garantie-Erinnerung als Aufgabe an der Anlage: offenes Erinnerungs-Aufgabe ersetzen (fällig 30 Tage vor Ablauf, nicht
 * vor heute). Liegt das Ende in der Vergangenheit oder gibt es keins, bleibt nur das Entfernen.
 */
async function setzeGarantieErinnerung(tx: TransactionSql, k: Kontext, anlageId: string, bezeichnung: string, garantieBis: string | null) {
	await tx`
		delete from app.todos
		where anlage_id = ${anlageId} and betrieb_id = ${k.betriebId} and erledigt_am is null and serie_id is null
			and titel like ${GARANTIE_TITEL + '%'}`;
	const heute = berlinTag(new Date());
	if (!garantieBis || garantieBis < heute) return;
	const vorher = tagPlus(garantieBis, -GARANTIE_VORLAUF_TAGE);
	const faellig = vorher < heute ? heute : vorher;
	const deutsch = `${garantieBis.slice(8, 10)}.${garantieBis.slice(5, 7)}.${garantieBis.slice(0, 4)}`;
	await tx`
		insert into app.todos (betrieb_id, titel, beschreibung, faellig, anlage_id)
		values (${k.betriebId}, ${`${GARANTIE_TITEL} ${bezeichnung}`.slice(0, 200)},
			${`Die Garantie läuft am ${deutsch} ab – Kunden informieren bzw. Wartung/Verlängerung anbieten.`}, ${faellig}, ${anlageId})`;
}

export async function legeAnlageAn(
	k: Kontext,
	kundeId: string,
	objektId: string,
	e: Record<string, unknown>,
	extraRoh: Record<string, unknown> = {}
): Promise<Anlage> {
	const kid = idOder404(kundeId, 'Objekt');
	const oid = idOder404(objektId, 'Objekt');
	const w = pruefeAnlageEingabe(e, extraRoh);
	return mitBetrieb(k, async (tx) => {
		const [o] = await tx`
			select 1 from app.objekte where id = ${oid} and kunde_id = ${kid} and betrieb_id = ${k.betriebId} for key share`;
		if (!o) throw nichtGefunden('Objekt');
		const [z] = await tx`
			insert into app.anlagen (betrieb_id, objekt_id, typ, bezeichnung, hersteller, modell, seriennummer, baujahr, einbaudatum,
				standort, garantie_bis, wartung_regel, wartung_intervall, extra, notiz, qr_token)
			values (${k.betriebId}, ${oid}, ${w.typ}, ${w.bezeichnung}, ${w.hersteller}, ${w.modell}, ${w.seriennummer}, ${w.baujahr},
				${w.einbaudatum}, ${w.standort}, ${w.garantieBis}, ${w.wartungRegel}, ${w.wartungIntervall}, ${tx.json(w.extra)},
				${w.notiz}, ${neuesQrToken()})
			returning id`;
		await setzeGarantieErinnerung(tx, k, z.id, w.bezeichnung, w.garantieBis);
		return ladeEine(tx, k, z.id);
	});
}

export async function aendereAnlage(k: Kontext, id: string, e: Record<string, unknown>, extraRoh: Record<string, unknown> = {}): Promise<Anlage> {
	const aid = idOder404(id);
	const w = pruefeAnlageEingabe(e, extraRoh);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select bezeichnung, to_char(garantie_bis, 'YYYY-MM-DD') as garantie_bis from app.anlagen
			where id = ${aid} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		await tx`
			update app.anlagen set typ = ${w.typ}, bezeichnung = ${w.bezeichnung}, hersteller = ${w.hersteller}, modell = ${w.modell},
				seriennummer = ${w.seriennummer}, baujahr = ${w.baujahr}, einbaudatum = ${w.einbaudatum}, standort = ${w.standort},
				garantie_bis = ${w.garantieBis}, wartung_regel = ${w.wartungRegel}, wartung_intervall = ${w.wartungIntervall},
				extra = ${tx.json(w.extra)}, notiz = ${w.notiz}
			where id = ${aid} and betrieb_id = ${k.betriebId}`;
		if (alt.garantie_bis !== w.garantieBis || alt.bezeichnung !== w.bezeichnung) {
			await setzeGarantieErinnerung(tx, k, aid, w.bezeichnung, w.garantieBis);
		}
		return ladeEine(tx, k, aid);
	});
}

/** Löscht die Anlage samt Störungen und Dateien; Aufträge und Aufgaben bleiben (ohne Anlage). */
export async function loescheAnlage(k: Kontext, id: string): Promise<{ kundeId: string; objektId: string }> {
	const aid = idOder404(id);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			delete from app.anlagen an using app.objekte o
			where an.id = ${aid} and an.betrieb_id = ${k.betriebId} and o.id = an.objekt_id and o.betrieb_id = an.betrieb_id
			returning an.objekt_id, o.kunde_id`;
		if (!z) throw nichtGefunden();
		return { kundeId: z.kunde_id, objektId: z.objekt_id };
	});
}

/**
 * Wartung planen: wiederkehrende Aufgabe an der Anlage nach ihrem Wartungsintervall (erster Termin `faellig`).
 * Ohne Intervall → 400; läuft schon eine aktive Wartungs-Serie → 409.
 */
export async function planeWartung(k: Kontext, id: string, e: { faellig?: unknown; zustaendigId?: unknown }) {
	const a = await holeAnlage(k, id);
	if (!a.wartungRegel || !a.wartungIntervall) throw new ApiFehler(400, 'Bitte zuerst ein Wartungsintervall an der Anlage eintragen.');
	const [laeuft] = await mitBetrieb(k, (tx) => tx`
		select 1 from app.todos t join app.todo_serien s on s.id = t.serie_id and s.betrieb_id = t.betrieb_id
		where t.anlage_id = ${a.id} and t.betrieb_id = ${k.betriebId} and s.aktiv and t.erledigt_am is null limit 1`);
	if (laeuft) throw new ApiFehler(409, 'Für diese Anlage ist schon eine Wartung geplant.');
	return legeTodoAn(k, {
		titel: `Wartung: ${a.bezeichnung}`.slice(0, 200),
		beschreibung: [a.objektBezeichnung, a.objektAdresse, a.standort ? `Standort: ${a.standort}` : null].filter(Boolean).join(' · ').slice(0, 500) || null,
		faellig: e.faellig,
		zustaendigId: e.zustaendigId,
		wiederholung: a.wartungRegel,
		intervall: String(a.wartungIntervall),
		anlageId: a.id
	});
}

// ——— Verlauf ———

export type AnlagenVerlauf = {
	auftraege: { id: string; nummer: string; titel: string; status: string; angelegt: string }[];
	todos: { id: string; titel: string; faellig: string | null; erledigt: boolean; serieText: string | null; serieAktiv: boolean }[];
	stoerungen: AnlagenStoerung[];
};
export type AnlagenStoerung = {
	id: string;
	titel: string;
	beschreibung: string | null;
	quelle: 'intern' | 'qr';
	vonName: string | null;
	behobenAm: string | null;
	angelegt: string;
};

/** Verlauf einer Anlage: Aufträge (nur sichtbare), Aufgaben (alle bzw. eigene) und Störungen, jeweils neueste zuerst. */
export async function anlagenVerlauf(k: Kontext, id: string, sicht: Sicht, todoSicht: TodoSicht): Promise<AnlagenVerlauf> {
	const aid = idOder404(id);
	return mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.anlagen where id = ${aid} and betrieb_id = ${k.betriebId}`;
		if (!da) throw nichtGefunden();
		const auftraege = await tx`
			select a.id, a.nummer, a.titel, a.status, a.angelegt from app.auftraege a
			where a.anlage_id = ${aid} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}
			order by a.angelegt desc, a.id limit 100`;
		const todos = await tx`
			select t.id, t.titel, to_char(t.faellig, 'YYYY-MM-DD') as faellig, t.erledigt_am, s.regel, s.intervall,
				to_char(s.ende, 'YYYY-MM-DD') as ende, s.aktiv
			from app.todos t left join app.todo_serien s on s.id = t.serie_id and s.betrieb_id = t.betrieb_id
			where t.anlage_id = ${aid} and t.betrieb_id = ${k.betriebId}
				${todoSicht.alle ? tx`` : tx`and t.zustaendig_id = ${todoSicht.benutzerId}`}
			order by t.erledigt_am is not null, t.faellig nulls last, t.id limit 100`;
		const stoerungen = await tx`
			select st.id, st.titel, st.beschreibung, st.quelle, st.behoben_am, st.angelegt, b.name as von_name
			from app.anlagen_stoerungen st
			left join app.benutzer b on b.id = st.von_benutzer_id and b.betrieb_id = st.betrieb_id
			where st.anlage_id = ${aid} and st.betrieb_id = ${k.betriebId}
			order by st.behoben_am is not null, st.angelegt desc, st.id limit 100`;
		return {
			auftraege: auftraege.map((a) => ({ id: a.id, nummer: a.nummer, titel: a.titel, status: a.status, angelegt: new Date(a.angelegt).toISOString() })),
			todos: todos.map((t) => ({
				id: t.id,
				titel: t.titel,
				faellig: t.faellig,
				erledigt: t.erledigt_am !== null,
				serieText: t.regel ? regelText(t.regel, Number(t.intervall), t.ende ?? null) : null,
				serieAktiv: !!t.aktiv
			})),
			stoerungen: stoerungen.map(zuStoerung)
		};
	});
}

function zuStoerung(s: Record<string, any>): AnlagenStoerung {
	return {
		id: s.id,
		titel: s.titel,
		beschreibung: s.beschreibung ?? null,
		quelle: s.quelle,
		vonName: s.von_name ?? null,
		behobenAm: s.behoben_am ? new Date(s.behoben_am).toISOString() : null,
		angelegt: new Date(s.angelegt).toISOString()
	};
}

export async function legeStoerungAn(k: Kontext, anlageId: string, e: { titel?: unknown; beschreibung?: unknown }): Promise<AnlagenStoerung> {
	const aid = idOder404(anlageId);
	const titel = textFeld(e.titel, 'Störung', 200);
	if (titel === null) throw new ApiFehler(400, 'Bitte kurz beschreiben, was gestört ist.');
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 2000);
	return mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.anlagen where id = ${aid} and betrieb_id = ${k.betriebId} for key share`;
		if (!da) throw nichtGefunden();
		const [z] = await tx`
			insert into app.anlagen_stoerungen (betrieb_id, anlage_id, titel, beschreibung, quelle, von_benutzer_id)
			values (${k.betriebId}, ${aid}, ${titel}, ${beschreibung}, 'intern', ${k.benutzerId})
			returning id, titel, beschreibung, quelle, behoben_am, angelegt`;
		const [b] = await tx`select name from app.benutzer where id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`;
		return zuStoerung({ ...z, von_name: b?.name ?? null });
	});
}

export async function setzeStoerungBehoben(k: Kontext, anlageId: string, stoerungId: unknown, behoben: boolean): Promise<void> {
	const aid = idOder404(anlageId);
	const sid = idOder404(stoerungId, 'Störung');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			update app.anlagen_stoerungen set behoben_am = ${behoben ? tx`now()` : null}
			where id = ${sid} and anlage_id = ${aid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Störung');
	});
}

// ——— Fotos und Dokumente ———

export type AnlagenDatei = { id: string; name: string; typ: string; groesse: number; beschreibung: string | null; vonName: string | null; angelegt: string };

const DATEI_SPALTEN = `d.id, d.name, d.typ, d.groesse, d.beschreibung, d.angelegt, b.name as von_name`;
const DATEI_VON = `app.anlagen_dateien d left join app.benutzer b on b.id = d.von_benutzer_id and b.betrieb_id = d.betrieb_id`;

const zuDatei = (r: Record<string, any>): AnlagenDatei => ({
	id: r.id,
	name: r.name,
	typ: r.typ,
	groesse: Number(r.groesse),
	beschreibung: r.beschreibung ?? null,
	vonName: r.von_name ?? null,
	angelegt: new Date(r.angelegt).toISOString()
});

export async function listeAnlagenDateien(k: Kontext, anlageId: string): Promise<AnlagenDatei[]> {
	const aid = idOder404(anlageId);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(DATEI_SPALTEN)} from ${tx.unsafe(DATEI_VON)}
			where d.anlage_id = ${aid} and d.betrieb_id = ${k.betriebId} order by d.angelegt desc, d.id`;
		return z.map(zuDatei);
	});
}

export async function speichereAnlagenDatei(
	k: Kontext,
	anlageId: string,
	e: { name: string; typ: string; inhalt: Uint8Array; beschreibung?: unknown }
): Promise<AnlagenDatei> {
	const aid = idOder404(anlageId);
	if (e.inhalt.byteLength > KUNDEN_DATEI_MAX) throw new ApiFehler(413, 'Die Datei ist zu groß (höchstens 5 MB).');
	pruefeDateiInhalt(e.typ, e.inhalt);
	const name = bereinigeDateiname(e.name);
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 500);
	return mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.anlagen where id = ${aid} and betrieb_id = ${k.betriebId} for key share`;
		if (!da) throw nichtGefunden();
		const [z] = await tx`
			insert into app.anlagen_dateien (betrieb_id, anlage_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id)
			values (${k.betriebId}, ${aid}, ${name}, ${e.typ}, ${e.inhalt.byteLength}, ${Buffer.from(e.inhalt)}, ${beschreibung}, ${k.benutzerId})
			returning id`;
		const [r] = await tx`select ${tx.unsafe(DATEI_SPALTEN)} from ${tx.unsafe(DATEI_VON)} where d.id = ${z.id}`;
		return zuDatei(r);
	});
}

export async function holeAnlagenDatei(k: Kontext, anlageId: string, dateiId: unknown): Promise<AnlagenDatei & { inhalt: Uint8Array }> {
	const aid = idOder404(anlageId);
	const did = idOder404(dateiId, 'Datei');
	return mitBetrieb(k, async (tx) => {
		const [r] = await tx`
			select ${tx.unsafe(DATEI_SPALTEN)}, d.inhalt from ${tx.unsafe(DATEI_VON)}
			where d.id = ${did} and d.anlage_id = ${aid} and d.betrieb_id = ${k.betriebId}`;
		if (!r) throw nichtGefunden('Datei');
		return { ...zuDatei(r), inhalt: new Uint8Array(r.inhalt) };
	});
}

export async function loescheAnlagenDatei(k: Kontext, anlageId: string, dateiId: unknown): Promise<void> {
	const aid = idOder404(anlageId);
	const did = idOder404(dateiId, 'Datei');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.anlagen_dateien where id = ${did} and anlage_id = ${aid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Datei');
	});
}

// ——— QR-Code ———

export const QR_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

export type QrTreffer = {
	anlageId: string;
	betriebId: string;
	typ: AnlagenTyp;
	typName: string;
	kontakt: { firmenname: string | null; telefon: string | null; email: string | null; web: string | null };
};

/**
 * QR-Kürzel auflösen – ohne Anmeldung über die SECURITY-DEFINER-Funktion (nur Typ + Kontakt des Betriebs).
 * Unbekannt/ungültig → null. Die Anlage-ID dient nur der Weiterleitung angemeldeter Mitarbeiter desselben Betriebs
 * und darf nie an Unangemeldete ausgegeben werden.
 */
export async function anlagePerQr(token: string): Promise<QrTreffer | null> {
	if (!QR_TOKEN.test(token)) return null;
	const [z] = await systemAbfrage((tx) => tx`select * from app.anlage_per_qr(${token})`);
	if (!z || !istAnlagenTyp(z.typ)) return null;
	return {
		anlageId: z.anlage_id,
		betriebId: z.betrieb_id,
		typ: z.typ,
		typName: TYP_NAMEN[z.typ],
		kontakt: { firmenname: z.firmenname ?? null, telefon: z.telefon ?? null, email: z.email ?? null, web: z.web ?? null }
	};
}

export { ANLAGEN_TYPEN };
