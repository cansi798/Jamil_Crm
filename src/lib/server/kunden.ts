import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';

/**
 * Fachlogik für Kunden und Objekte, gemeinsam genutzt von der API (`/api/kunden`) und den Seiten unter `/kunden`.
 * Alles läuft in `mitBetrieb` (RLS: nur der eigene Betrieb) und filtert zusätzlich ausdrücklich nach `betrieb_id`.
 * Fremde oder unbekannte Datensätze (auch kaputte IDs) sind immer ein 404, nie ein 403. Fehler sind `ApiFehler`
 * mit deutscher Meldung. Rechte- und Tarifprüfung (`darf`) machen die Aufrufer.
 */

export type KundenArt = 'privat' | 'firma';

export type Kunde = {
	id: string;
	art: KundenArt;
	firma: string | null;
	anrede: string | null;
	vorname: string | null;
	nachname: string | null;
	email: string | null;
	telefon: string | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
	notiz: string | null;
	angelegt: string;
	geaendert: string;
	/** Anzeigename: Firmenname bzw. „Vorname Nachname“. */
	name: string;
};

export type Objekt = {
	id: string;
	kundeId: string;
	bezeichnung: string;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
	notiz: string | null;
	angelegt: string;
	geaendert: string;
};

/** Feldname → [Beschriftung in Fehlermeldungen, höchste Länge]. Entspricht den Check-Constraints in Migration 007. */
const KUNDE_TEXTE = {
	firma: ['Firmenname', 200],
	anrede: ['Anrede', 50],
	vorname: ['Vorname', 200],
	nachname: ['Nachname', 200],
	email: ['E-Mail', 200],
	telefon: ['Telefon', 50],
	strasse: ['Straße', 200],
	plz: ['PLZ', 20],
	ort: ['Ort', 200],
	notiz: ['Notiz', 2000]
} as const;

const OBJEKT_TEXTE = {
	bezeichnung: ['Bezeichnung', 200],
	strasse: ['Straße', 200],
	plz: ['PLZ', 20],
	ort: ['Ort', 200],
	notiz: ['Notiz', 2000]
} as const;

type KundeFeld = keyof typeof KUNDE_TEXTE;
type ObjektFeld = keyof typeof OBJEKT_TEXTE;

export type KundeWerte = { art: KundenArt } & Record<KundeFeld, string | null>;
export type ObjektWerte = Record<ObjektFeld, string | null>;

export const KUNDE_FELDER = ['art', ...Object.keys(KUNDE_TEXTE)] as (keyof KundeWerte)[];
export const OBJEKT_FELDER = Object.keys(OBJEKT_TEXTE) as ObjektFeld[];

export const SUCHE_MAX_ZEICHEN = 100;
export const SUCHE_MAX_WOERTER = 5;
export const MAX_TREFFER = 50;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Leichte Prüfung, keine RFC-Vollständigkeit: etwas@domain.endung, ohne Leerraum und ohne zweites @.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const kundeNichtGefunden = () => new ApiFehler(404, 'Kunde nicht gefunden.');
const objektNichtGefunden = () => new ApiFehler(404, 'Objekt nicht gefunden.');

const pruefeKundenId = (id: string): string => {
	if (!UUID.test(id)) throw kundeNichtGefunden();
	return id;
};
const pruefeObjektId = (id: string): string => {
	if (!UUID.test(id)) throw objektNichtGefunden();
	return id;
};

/** Ein optionales Textfeld: trimmen, leer → null, nur Text, keine NUL-Zeichen, höchstens `max` Zeichen. */
export function textFeld(wert: unknown, beschriftung: string, max: number): string | null {
	if (wert === undefined || wert === null) return null;
	if (typeof wert !== 'string') throw new ApiFehler(400, `${beschriftung}: Bitte einen Text eingeben.`);
	if (wert.includes('\u0000')) throw new ApiFehler(400, `${beschriftung} enthält ungültige Zeichen.`);
	const text = wert.trim();
	if (text === '') return null;
	if ([...text].length > max) {
		throw new ApiFehler(400, `${beschriftung} ist zu lang (höchstens ${max} Zeichen).`);
	}
	return text;
}

/** Anzeigename eines Kunden. */
export function anzeigeName(k: Pick<Kunde, 'art' | 'firma' | 'vorname' | 'nachname'>): string {
	if (k.art === 'firma') return k.firma ?? '';
	return [k.vorname, k.nachname].filter(Boolean).join(' ');
}

/**
 * Prüft die Eingaben für einen Kunden (vollständiger Satz) und liefert bereinigte Werte. Privatkunde: Nachname
 * Pflicht, das Firmenfeld wird verworfen. Firmenkunde: Firmenname Pflicht; Anrede/Vor-/Nachname sind dort der
 * Ansprechpartner.
 */
export function pruefeKundeEingabe(eingabe: Record<string, unknown>): KundeWerte {
	const art = eingabe.art;
	if (art !== 'privat' && art !== 'firma') {
		throw new ApiFehler(400, 'Die Art des Kunden muss „privat“ oder „firma“ sein.');
	}
	const werte = { art } as KundeWerte;
	for (const [feld, [beschriftung, max]] of Object.entries(KUNDE_TEXTE) as [KundeFeld, readonly [string, number]][]) {
		werte[feld] = textFeld(eingabe[feld], beschriftung, max);
	}
	if (werte.email !== null && !EMAIL.test(werte.email)) {
		throw new ApiFehler(400, 'Die E-Mail-Adresse ist ungültig.');
	}
	if (art === 'privat') {
		werte.firma = null;
		if (werte.nachname === null) throw new ApiFehler(400, 'Bei Privatkunden ist der Nachname erforderlich.');
	} else if (werte.firma === null) {
		throw new ApiFehler(400, 'Bei Firmenkunden ist der Firmenname erforderlich.');
	}
	return werte;
}

/** Prüft die Eingaben für ein Objekt (Bezeichnung Pflicht). */
export function pruefeObjektEingabe(eingabe: Record<string, unknown>): ObjektWerte {
	const werte = {} as ObjektWerte;
	for (const [feld, [beschriftung, max]] of Object.entries(OBJEKT_TEXTE) as [ObjektFeld, readonly [string, number]][]) {
		werte[feld] = textFeld(eingabe[feld], beschriftung, max);
	}
	if (werte.bezeichnung === null) throw new ApiFehler(400, 'Die Bezeichnung des Objekts ist erforderlich.');
	return werte;
}

/** Maskiert `\`, `%` und `_` und umschließt mit `%…%`: Benutzereingaben wirken in LIKE nie als Platzhalter. */
export function likeMuster(wort: string): string {
	return `%${wort.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Zerlegt den Suchtext in Wörter (alle müssen vorkommen). Zu lange Eingaben sind ein 400, Überhängendes wird gekappt. */
export function sucheWoerter(suche: string | null | undefined): string[] {
	const text = (suche ?? '').replaceAll('\u0000', '').trim();
	if ([...text].length > SUCHE_MAX_ZEICHEN) {
		throw new ApiFehler(400, `Der Suchbegriff ist zu lang (höchstens ${SUCHE_MAX_ZEICHEN} Zeichen).`);
	}
	return text.split(/\s+/).filter((w) => w !== '').slice(0, SUCHE_MAX_WOERTER);
}

const SPALTEN_KUNDE = `id, art, firma, anrede, vorname, nachname, email::text as email, telefon, strasse, plz, ort, notiz,
	angelegt, geaendert`;

const iso = (d: unknown) => new Date(d as string | Date).toISOString();

function zuKunde(z: Record<string, any>): Kunde {
	const k = {
		id: z.id,
		art: z.art,
		firma: z.firma,
		anrede: z.anrede,
		vorname: z.vorname,
		nachname: z.nachname,
		email: z.email,
		telefon: z.telefon,
		strasse: z.strasse,
		plz: z.plz,
		ort: z.ort,
		notiz: z.notiz,
		angelegt: iso(z.angelegt),
		geaendert: iso(z.geaendert)
	};
	return { ...k, name: anzeigeName(k) };
}

function zuObjekt(z: Record<string, any>): Objekt {
	return {
		id: z.id,
		kundeId: z.kunde_id,
		bezeichnung: z.bezeichnung,
		strasse: z.strasse,
		plz: z.plz,
		ort: z.ort,
		notiz: z.notiz,
		angelegt: iso(z.angelegt),
		geaendert: iso(z.geaendert)
	};
}

/**
 * Kunden suchen (ohne Suchtext: alle). Jedes Wort muss in Firma, Vorname, Nachname, Ort, Telefon oder E-Mail
 * vorkommen (Teilstring, Groß-/Kleinschreibung egal, Umlaute bleiben erhalten – `lower()` der Datenbank). Bei
 * Telefonnummern zählen auch nur die Ziffern (ab 3 Ziffern), damit „123456“ „0171 123-456“ findet.
 * Höchstens 50 Treffer, nach Name sortiert (Firma nach Firmenname, sonst Nachname, dann Vorname).
 */
/** Sortierung der Liste (Jamil msg 3522): nach Name (Standard) oder nach nächstem Termin, letztem Angebot, letzter Portal-Öffnung. */
const SORTIERUNG_SQL: Record<string, string> = {
	termin: `(select min(e.beginn) from app.einsaetze e join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
		where a.kunde_id = kunden.id and a.betrieb_id = kunden.betrieb_id and e.ende >= now()) asc nulls last,`,
	angebot: `(select max(coalesce(an.versendet_am, an.geaendert)) from app.angebote an
		left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		where an.betrieb_id = kunden.betrieb_id and coalesce(an.kunde_id, a.kunde_id) = kunden.id
			and an.status in ('versendet', 'angenommen', 'abgelehnt')) desc nulls last,`,
	portal: `(select max(l.letzter_zugriff) from app.portal_links l where l.kunde_id = kunden.id and l.betrieb_id = kunden.betrieb_id) desc nulls last,`
};

export type KundenListeOptionen = {
	/** feste Schlüssel aus SORTIERUNG_SQL (Rechte prüft der Aufrufer); sonst Name */
	sortierung?: string;
	/** nur diese Kunden (Filter der Kennzahl-Kacheln) – vor der Begrenzung auf 50, damit keine Treffer verloren gehen */
	nurIds?: string[] | null;
};

export function listeKunden(k: Kontext, suche?: string | null, o: KundenListeOptionen = {}): Promise<Kunde[]> {
	const sortierung = (o.sortierung && SORTIERUNG_SQL[o.sortierung]) || '';
	const woerter = sucheWoerter(suche);
	const muster = woerter.map(likeMuster);
	const ziffern = woerter.map((w) => {
		const nurZiffern = /^[0-9+\-/() .]+$/.test(w) ? w.replace(/\D/g, '') : '';
		return nurZiffern.length >= 3 ? `%${nurZiffern}%` : '';
	});
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(SPALTEN_KUNDE)}
			from app.kunden
			where betrieb_id = ${k.betriebId}
				and not exists (
					select 1 from unnest(${muster}::text[], ${ziffern}::text[]) as s(m, z)
					where not (
						lower(coalesce(firma, '')) like lower(s.m)
						or lower(coalesce(vorname, '')) like lower(s.m)
						or lower(coalesce(nachname, '')) like lower(s.m)
						or lower(coalesce(ort, '')) like lower(s.m)
						or lower(coalesce(telefon, '')) like lower(s.m)
						or lower(coalesce(email::text, '')) like lower(s.m)
						or (s.z <> '' and regexp_replace(coalesce(telefon, ''), '[^0-9]', '', 'g') like s.z)
					)
				)
				${o.nurIds ? tx`and id = any(${o.nurIds}::uuid[])` : tx``}
			order by ${tx.unsafe(sortierung)} public.unaccent(lower(case when art = 'firma' then firma else nachname end)),
				public.unaccent(lower(coalesce(vorname, ''))), id
			limit ${MAX_TREFFER}`;
		return z.map(zuKunde);
	});
}

export function holeKunde(k: Kontext, id: string): Promise<Kunde> {
	pruefeKundenId(id);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(SPALTEN_KUNDE)} from app.kunden where id = ${id} and betrieb_id = ${k.betriebId}`;
		if (!z) throw kundeNichtGefunden();
		return zuKunde(z);
	});
}

export function legeKundeAn(k: Kontext, eingabe: Record<string, unknown>): Promise<Kunde> {
	const w = pruefeKundeEingabe(eingabe);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			insert into app.kunden (betrieb_id, art, firma, anrede, vorname, nachname, email, telefon, strasse, plz, ort, notiz)
			values (${k.betriebId}, ${w.art}, ${w.firma}, ${w.anrede}, ${w.vorname}, ${w.nachname}, ${w.email},
				${w.telefon}, ${w.strasse}, ${w.plz}, ${w.ort}, ${w.notiz})
			returning ${tx.unsafe(SPALTEN_KUNDE)}`;
		return zuKunde(z);
	});
}

/** Ändert einen Kunden teilweise: angegebene Felder ersetzen die bisherigen, das Ergebnis wird als Ganzes geprüft. */
export function aendereKunde(k: Kontext, id: string, eingabe: Record<string, unknown>): Promise<Kunde> {
	pruefeKundenId(id);
	const felder = KUNDE_FELDER.filter((f) => Object.hasOwn(eingabe, f));
	if (felder.length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select ${tx.unsafe(SPALTEN_KUNDE)} from app.kunden where id = ${id} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw kundeNichtGefunden();
		const w = pruefeKundeEingabe({ ...alt, ...Object.fromEntries(felder.map((f) => [f, eingabe[f]])) });
		const [z] = await tx`
			update app.kunden set art = ${w.art}, firma = ${w.firma}, anrede = ${w.anrede}, vorname = ${w.vorname},
				nachname = ${w.nachname}, email = ${w.email}, telefon = ${w.telefon}, strasse = ${w.strasse},
				plz = ${w.plz}, ort = ${w.ort}, notiz = ${w.notiz}
			where id = ${id} and betrieb_id = ${k.betriebId}
			returning ${tx.unsafe(SPALTEN_KUNDE)}`;
		return zuKunde(z);
	});
}

/**
 * Löscht den Kunden samt seiner Objekte (Fremdschlüssel mit Kaskade); beides steht im Änderungsprotokoll.
 * Hat der Kunde Aufträge, bleibt alles stehen (409) – Aufträge verschwinden nie nebenbei (Migration 011).
 */
export async function loescheKunde(k: Kontext, id: string): Promise<void> {
	pruefeKundenId(id);
	try {
		await mitBetrieb(k, async (tx) => {
			const z = await tx`delete from app.kunden where id = ${id} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw kundeNichtGefunden();
		});
	} catch (e) {
		if ((e as { code?: string }).code === '23503') {
			throw new ApiFehler(409, 'Der Kunde hat noch Aufträge und kann nicht gelöscht werden.');
		}
		throw e;
	}
}

const SPALTEN_OBJEKT = 'id, kunde_id, bezeichnung, strasse, plz, ort, notiz, angelegt, geaendert';

/** Alle Objekte eines Kunden (404, wenn der Kunde im eigenen Betrieb nicht existiert). */
export function listeObjekte(k: Kontext, kundeId: string): Promise<Objekt[]> {
	pruefeKundenId(kundeId);
	return mitBetrieb(k, async (tx) => {
		const [kunde] = await tx`select id from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		if (!kunde) throw kundeNichtGefunden();
		const z = await tx`
			select ${tx.unsafe(SPALTEN_OBJEKT)} from app.objekte
			where kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(bezeichnung)), id`;
		return z.map(zuObjekt);
	});
}

/** Ein Objekt – nur, wenn es zum Kunden aus der URL gehört (sonst 404). */
export function holeObjekt(k: Kontext, kundeId: string, id: string): Promise<Objekt> {
	pruefeKundenId(kundeId);
	pruefeObjektId(id);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(SPALTEN_OBJEKT)} from app.objekte
			where id = ${id} and kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		if (!z) throw objektNichtGefunden();
		return zuObjekt(z);
	});
}

export function legeObjektAn(k: Kontext, kundeId: string, eingabe: Record<string, unknown>): Promise<Objekt> {
	pruefeKundenId(kundeId);
	const w = pruefeObjektEingabe(eingabe);
	return mitBetrieb(k, async (tx) => {
		// Kunde im eigenen Betrieb vorhanden? (und bis zum Ende der Transaktion nicht löschbar)
		const [kunde] = await tx`
			select id from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId} for key share`;
		if (!kunde) throw kundeNichtGefunden();
		const [z] = await tx`
			insert into app.objekte (betrieb_id, kunde_id, bezeichnung, strasse, plz, ort, notiz)
			values (${k.betriebId}, ${kundeId}, ${w.bezeichnung}, ${w.strasse}, ${w.plz}, ${w.ort}, ${w.notiz})
			returning ${tx.unsafe(SPALTEN_OBJEKT)}`;
		return zuObjekt(z);
	});
}

/** Teiländerung wie bei Kunden. Der zugehörige Kunde ändert sich nie. */
export function aendereObjekt(
	k: Kontext,
	kundeId: string,
	id: string,
	eingabe: Record<string, unknown>
): Promise<Objekt> {
	pruefeKundenId(kundeId);
	pruefeObjektId(id);
	const felder = OBJEKT_FELDER.filter((f) => Object.hasOwn(eingabe, f));
	if (felder.length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select ${tx.unsafe(SPALTEN_OBJEKT)} from app.objekte
			where id = ${id} and kunde_id = ${kundeId} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw objektNichtGefunden();
		const w = pruefeObjektEingabe({ ...alt, ...Object.fromEntries(felder.map((f) => [f, eingabe[f]])) });
		const [z] = await tx`
			update app.objekte set bezeichnung = ${w.bezeichnung}, strasse = ${w.strasse}, plz = ${w.plz},
				ort = ${w.ort}, notiz = ${w.notiz}
			where id = ${id} and kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}
			returning ${tx.unsafe(SPALTEN_OBJEKT)}`;
		return zuObjekt(z);
	});
}

export function loescheObjekt(k: Kontext, kundeId: string, id: string): Promise<void> {
	pruefeKundenId(kundeId);
	pruefeObjektId(id);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			delete from app.objekte where id = ${id} and kunde_id = ${kundeId} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw objektNichtGefunden();
	});
}
