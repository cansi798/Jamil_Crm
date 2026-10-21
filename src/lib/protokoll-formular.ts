/**
 * Frei gestaltbare Protokolle (Wunsch Jamil, Talk msg 2649) – Wissen ohne Serverbezug, genutzt von Server, Baukasten
 * (Einstellungen → Protokoll-Vorlagen) und Ausfüll-Assistent:
 *
 * - Aufbau einer Vorlage (`Schema`): Seiten (Schritte des Assistenten) → Abschnitte → Felder.
 * - `pruefeSchema`: prüft und bereinigt eine Vorlage (Typen, Längen, eindeutige Feld-IDs, Bedingungen nur auf frühere
 *   Felder – so gibt es keine Kreise).
 * - `auswerten`: Bedingungen („Feld B zeigen/Pflicht, wenn Feld A = Wert“) → je Feld sichtbar und Pflicht.
 * - `fehlendeFelder` / `schrittFrei`: Sperre für „Weiter“ – alle sichtbaren Pflichtfelder des Schritts müssen erfüllt
 *   sein (z. B. „Foto der Abdichtung“ mit mindestens einem Foto).
 * - `bereinigeAntworten`: Antworten aus dem Browser auf bekannte Felder und passende Typen beschränken.
 *
 * Gemeinsam genutzt von den Protokoll-Vorlagen und den Fragen der Online-Buchung (`src/lib/buchung.ts`: ein Schritt,
 * nur Feldtypen aus `FRAGE_TYPEN`, Prüfung mit `pruefeSchema(…, { typen, maxSeiten: 1, leerErlaubt: true })`).
 */

import { alsText, ersetzeNamen, FormelFehler, namen, parse, rechne, type Knoten } from './aufmass-formel';

export const FELD_TYPEN = [
	'hinweis',
	'text',
	'textlang',
	'zahl',
	'janein',
	'auswahl',
	'mehrfach',
	'datum',
	'uhrzeit',
	'foto',
	'checkliste',
	'unterschrift',
	'messwert',
	// Aufmaß (Jamil msg 2842)
	'mass',
	'flaeche',
	'umfang',
	'volumen',
	'abzug',
	'stueck',
	'formel'
] as const;
export type FeldTyp = (typeof FELD_TYPEN)[number];

export const FELD_TYP_NAMEN: Record<FeldTyp, string> = {
	hinweis: 'Überschrift / Hinweistext',
	text: 'Text (kurz)',
	textlang: 'Text (lang)',
	zahl: 'Zahl',
	janein: 'Ja / Nein',
	auswahl: 'Auswahl (eine)',
	mehrfach: 'Auswahl (mehrere)',
	datum: 'Datum',
	uhrzeit: 'Uhrzeit',
	foto: 'Foto',
	checkliste: 'Checkliste',
	unterschrift: 'Unterschrift',
	messwert: 'Messwert mit Einheit',
	mass: 'Maß (Länge/Breite/Höhe)',
	flaeche: 'Fläche (m²)',
	umfang: 'Umfang (m)',
	volumen: 'Volumen (m³)',
	abzug: 'Abzug (z. B. Tür, Fenster)',
	stueck: 'Stückzahl',
	formel: 'Formel (berechnet)'
};

/** Aufmaß-Feldtypen (Zahlen mit Einheit; Fläche/Umfang/Volumen wahlweise berechnet, Formel immer). */
export const AUFMASS_TYPEN = ['mass', 'flaeche', 'umfang', 'volumen', 'abzug', 'stueck', 'formel'] as const satisfies readonly FeldTyp[];
/** Alle Feldtypen mit Zahlenwert (Bedingungen „größer/kleiner“, Formeln). */
export const ZAHL_TYPEN: readonly FeldTyp[] = ['zahl', 'messwert', ...AUFMASS_TYPEN];
export const istZahlTyp = (t: FeldTyp) => ZAHL_TYPEN.includes(t);
/** Feste Einheit je Aufmaß-Typ (Maß: m, cm oder mm; Formel: frei). */
export const AUFMASS_EINHEIT: Partial<Record<FeldTyp, string>> = { flaeche: 'm²', umfang: 'm', volumen: 'm³', abzug: 'm²', stueck: 'Stk' };
export const MASS_EINHEITEN = ['m', 'cm', 'mm'] as const;
/** Wird das Feld berechnet (Wert kommt aus der Formel, nicht vom Nutzer)? */
export const istBerechnet = (f: Pick<Feld, 'typ' | 'formel'>) => f.typ === 'formel' || (!!f.formel && (f.typ === 'flaeche' || f.typ === 'umfang' || f.typ === 'volumen'));
/** Höchstens so viele Wiederholungen (z. B. Räume) je wiederholbarem Abschnitt. */
export const MAX_WIEDERHOLUNGEN = 30;
export const anzahlSchluessel = (abschnittId: string) => `_anzahl_${abschnittId}`;

export const BEDINGUNG_OPS = ['gleich', 'ungleich', 'ausgefuellt', 'leer', 'groesser', 'kleiner'] as const;
export type BedingungOp = (typeof BEDINGUNG_OPS)[number];
export const BEDINGUNG_OP_NAMEN: Record<BedingungOp, string> = {
	gleich: 'ist',
	ungleich: 'ist nicht',
	ausgefuellt: 'ist ausgefüllt',
	leer: 'ist leer',
	groesser: 'ist größer als',
	kleiner: 'ist kleiner als'
};

export type Bedingung = {
	/** ID eines früheren Felds */
	feld: string;
	op: BedingungOp;
	/** Vergleichswert (Text; bei Ja/Nein „ja“/„nein“, bei Zahlen eine Zahl als Text) */
	wert?: string;
	/** zeigen: Feld nur zeigen, wenn die Bedingung gilt; pflicht: Feld immer zeigen, aber nur dann Pflicht */
	wirkung: 'zeigen' | 'pflicht';
};

export type Feld = {
	id: string;
	typ: FeldTyp;
	label: string;
	hilfe?: string;
	pflicht?: boolean;
	/** auswahl, mehrfach, checkliste */
	optionen?: string[];
	/** foto: so viele Fotos mindestens (Pflicht), Standard 1 */
	minFotos?: number;
	/** messwert */
	einheit?: string;
	/** zahl, messwert */
	min?: number;
	max?: number;
	/** unterschrift: wer unterschreibt */
	wer?: 'kunde' | 'monteur';
	bedingung?: Bedingung;
	/** Aufmaß: Kurzname für Formeln (z. B. „L“, „B“, „H“) */
	kuerzel?: string;
	/** Aufmaß: Formel (Pflicht bei „formel“, wahlweise bei Fläche/Umfang/Volumen) */
	formel?: string;
	/** Aufmaß: Nachkommastellen des Ergebnisses (Standard 2) */
	nachkomma?: number;
	/** Aufmaß: Katalog-Verknüpfung – Menge (Formel, Standard: der Wert des Felds) für eine Katalogposition */
	katalog?: { positionId: string; menge?: string };
	/** nach dem Aufklappen wiederholbarer Abschnitte: z. B. „Raum 2“ (für Meldungen) */
	gruppe?: string;
};

export type Abschnitt = {
	id: string;
	titel?: string;
	felder: Feld[];
	/** Aufmaß: Abschnitt wiederholbar (z. B. je Raum) */
	wiederholbar?: boolean;
	/** Name einer Wiederholung, z. B. „Raum“ */
	wiederholName?: string;
	/** nach dem Aufklappen: Herkunft und Nummer der Wiederholung (für „+ Raum“ / „Raum entfernen“) */
	wdh?: { basis: string; nr: number; anzahl: number; name: string };
};
export type Seite = { id: string; titel: string; abschnitte: Abschnitt[] };
/** `expandiert`: wiederholbare Abschnitte sind schon aufgeklappt, Formeln aufgelöst (siehe `expandiere`). */
export type Schema = { seiten: Seite[]; expandiert?: boolean };

export type FotoWert = string[]; // IDs in app.protokoll_dateien
export type UnterschriftWert = { dateiId: string; name?: string; zeit?: string };
export type Antworten = Record<string, unknown>;

/** Felder, deren Werte nur der Server setzt (Hochladen/Löschen von Dateien). */
export const DATEI_TYPEN: readonly FeldTyp[] = ['foto', 'unterschrift'];

export const GRENZEN = {
	seiten: 30,
	abschnitte: 30,
	felderJeAbschnitt: 100,
	felder: 500,
	label: 300,
	hilfe: 2000,
	optionen: 50,
	option: 200,
	einheit: 20,
	fotos: 20,
	text: 5000,
	textlang: 20000,
	titel: 200
} as const;

const ID = /^[a-z][a-z0-9_]{0,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SchemaFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'SchemaFehler';
	}
}

/** Neue, zufällige Feld-/Seiten-ID (für den Baukasten). */
export function neueId(praefix = 'f'): string {
	const zeichen = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let s = praefix;
	for (let i = 0; i < 7; i++) s += zeichen[Math.floor(Math.random() * zeichen.length)];
	return s;
}

/** Alle Felder in Reihenfolge (Seite, Abschnitt, Feld) mit Seitennummer. */
export function alleFelder(schema: Schema): { feld: Feld; seite: number }[] {
	const aus: { feld: Feld; seite: number }[] = [];
	schema.seiten.forEach((s, i) => s.abschnitte.forEach((a) => a.felder.forEach((f) => aus.push({ feld: f, seite: i }))));
	return aus;
}

const istObjekt = (w: unknown): w is Record<string, unknown> => w !== null && typeof w === 'object' && !Array.isArray(w);

function text(w: unknown, was: string, max: number, pflicht: boolean): string | undefined {
	if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) {
		if (pflicht) throw new SchemaFehler(`${was} fehlt.`);
		return undefined;
	}
	if (typeof w !== 'string') throw new SchemaFehler(`${was}: Text erwartet.`);
	const t = w.replaceAll('\u0000', '').trim();
	if ([...t].length > max) throw new SchemaFehler(`${was} ist zu lang (höchstens ${max} Zeichen).`);
	return t;
}

function zahlOder(w: unknown, was: string): number | undefined {
	if (w === undefined || w === null || w === '') return undefined;
	const n = typeof w === 'string' ? Number(w.replace(',', '.')) : w;
	if (typeof n !== 'number' || !Number.isFinite(n)) throw new SchemaFehler(`${was}: Zahl erwartet.`);
	return n;
}

/** Welche Vergleiche passen zu welchem Feldtyp (für Prüfung und Baukasten). */
export function opsFuer(typ: FeldTyp): BedingungOp[] {
	switch (typ) {
		case 'zahl':
		case 'messwert':
		case 'mass':
		case 'flaeche':
		case 'umfang':
		case 'volumen':
		case 'abzug':
		case 'stueck':
		case 'formel':
			return ['gleich', 'ungleich', 'groesser', 'kleiner', 'ausgefuellt', 'leer'];
		case 'janein':
		case 'auswahl':
		case 'mehrfach':
		case 'checkliste':
		case 'text':
		case 'textlang':
			return ['gleich', 'ungleich', 'ausgefuellt', 'leer'];
		case 'hinweis':
			return [];
		default:
			return ['ausgefuellt', 'leer'];
	}
}

/**
 * Prüft eine Vorlage (aus Baukasten oder Datenbank) und liefert eine bereinigte Kopie. Wirft `SchemaFehler` mit einer
 * deutschen Meldung, die der Baukasten anzeigt.
 */
export type SchemaOptionen = {
	/** erlaubte Feldtypen (Standard: alle) */
	typen?: readonly FeldTyp[];
	/** höchstens so viele Seiten (Standard: GRENZEN.seiten) */
	maxSeiten?: number;
	/** ohne Seiten bzw. Felder gültig (z. B. Dienst ohne eigene Fragen) */
	leerErlaubt?: boolean;
};

export function pruefeSchema(roh: unknown, opts: SchemaOptionen = {}): Schema {
	const schema = pruefeSchemaRoh(roh, opts);
	pruefeAufmass(schema);
	return schema;
}

function pruefeSchemaRoh(roh: unknown, opts: SchemaOptionen): Schema {
	const maxSeiten = Math.min(opts.maxSeiten ?? GRENZEN.seiten, GRENZEN.seiten);
	if (!istObjekt(roh) || !Array.isArray(roh.seiten)) throw new SchemaFehler('Die Vorlage hat keine Seiten.');
	if (roh.seiten.length === 0 && !opts.leerErlaubt) throw new SchemaFehler('Die Vorlage braucht mindestens eine Seite.');
	if (roh.seiten.length > maxSeiten) throw new SchemaFehler(maxSeiten === 1 ? 'Nur ein Schritt möglich.' : `Höchstens ${maxSeiten} Seiten.`);
	const ids = new Set<string>();
	const frueher = new Map<string, Feld>();
	const eindeutig = (id: unknown, was: string): string => {
		if (typeof id !== 'string' || !ID.test(id)) throw new SchemaFehler(`${was}: ungültige ID.`);
		if (ids.has(id)) throw new SchemaFehler(`${was}: ID „${id}“ ist doppelt.`);
		ids.add(id);
		return id;
	};
	let anzahl = 0;
	const seiten: Seite[] = roh.seiten.map((s, si) => {
		const wo = `Seite ${si + 1}`;
		if (!istObjekt(s) || !Array.isArray(s.abschnitte)) throw new SchemaFehler(`${wo}: ungültig.`);
		if (s.abschnitte.length === 0 && !opts.leerErlaubt) throw new SchemaFehler(`${wo}: braucht mindestens einen Abschnitt.`);
		if (s.abschnitte.length > GRENZEN.abschnitte) throw new SchemaFehler(`${wo}: höchstens ${GRENZEN.abschnitte} Abschnitte.`);
		const seite: Seite = {
			id: eindeutig(s.id, wo),
			titel: text(s.titel, `${wo}: Titel`, GRENZEN.titel, false) ?? `Schritt ${si + 1}`,
			abschnitte: []
		};
		seite.abschnitte = s.abschnitte.map((a, ai) => {
			const woA = `${wo}, Abschnitt ${ai + 1}`;
			if (!istObjekt(a) || !Array.isArray(a.felder)) throw new SchemaFehler(`${woA}: ungültig.`);
			if (a.felder.length > GRENZEN.felderJeAbschnitt) throw new SchemaFehler(`${woA}: zu viele Felder.`);
			const abschnitt: Abschnitt = { id: eindeutig(a.id, woA), felder: [] };
			const titel = text(a.titel, `${woA}: Titel`, GRENZEN.titel, false);
			if (titel) abschnitt.titel = titel;
			if (a.wiederholbar === true) {
				abschnitt.wiederholbar = true;
				abschnitt.wiederholName = text(a.wiederholName, `${woA}: Name einer Wiederholung`, 40, false) ?? 'Bereich';
				// IDs bekommen beim Aufklappen „__2“ … angehängt
				if (abschnitt.id.length > 50) throw new SchemaFehler(`${woA}: ID zu lang für einen wiederholbaren Abschnitt.`);
			}
			abschnitt.felder = a.felder.map((f, fi) => {
				anzahl++;
				if (anzahl > GRENZEN.felder) throw new SchemaFehler(`Höchstens ${GRENZEN.felder} Felder je Vorlage.`);
				const feld = pruefeFeld(f, `${woA}, Feld ${fi + 1}`, eindeutig, frueher, opts.typen);
				if (abschnitt.wiederholbar && feld.id.length > 50) throw new SchemaFehler(`„${feld.label}“: ID zu lang für einen wiederholbaren Abschnitt.`);
				if (abschnitt.wiederholbar && feld.typ === 'unterschrift') throw new SchemaFehler(`„${feld.label}“: Unterschriften gehören nicht in einen wiederholbaren Abschnitt.`);
				// Bedingungen dürfen sich auf frühere Felder derselben Seite beziehen: gleich verfügbar machen
				frueher.set(feld.id, feld);
				return feld;
			});
			return abschnitt;
		});
		return seite;
	});
	return { seiten };
}

function pruefeFeld(
	f: unknown,
	wo: string,
	eindeutig: (id: unknown, was: string) => string,
	frueher: Map<string, Feld>,
	typen: readonly FeldTyp[] = FELD_TYPEN
): Feld {
	if (!istObjekt(f)) throw new SchemaFehler(`${wo}: ungültig.`);
	if (typeof f.typ !== 'string' || !(typen as readonly string[]).includes(f.typ)) throw new SchemaFehler(`${wo}: unbekannter Feldtyp.`);
	const typ = f.typ as FeldTyp;
	const label = text(f.label, `${wo}: Beschriftung`, GRENZEN.label, true)!;
	const feld: Feld = { id: eindeutig(f.id, wo), typ, label };
	const woL = `„${label}“`;
	const hilfe = text(f.hilfe, `${woL}: Hinweis`, GRENZEN.hilfe, false);
	if (hilfe) feld.hilfe = hilfe;
	if (typ !== 'hinweis' && f.pflicht === true) feld.pflicht = true;
	if (typ === 'auswahl' || typ === 'mehrfach' || typ === 'checkliste') {
		if (!Array.isArray(f.optionen)) throw new SchemaFehler(`${woL}: Optionen fehlen.`);
		const optionen = f.optionen.map((o, i) => text(o, `${woL}: Option ${i + 1}`, GRENZEN.option, false)).filter((o): o is string => !!o);
		if (optionen.length === 0) throw new SchemaFehler(`${woL}: braucht mindestens eine Option.`);
		if (optionen.length > GRENZEN.optionen) throw new SchemaFehler(`${woL}: höchstens ${GRENZEN.optionen} Optionen.`);
		if (new Set(optionen).size !== optionen.length) throw new SchemaFehler(`${woL}: Optionen doppelt.`);
		feld.optionen = optionen;
	}
	if (typ === 'foto') {
		const min = zahlOder(f.minFotos, `${woL}: Mindestanzahl Fotos`);
		if (min !== undefined) {
			if (!Number.isInteger(min) || min < 0 || min > GRENZEN.fotos) throw new SchemaFehler(`${woL}: Mindestanzahl Fotos 0–${GRENZEN.fotos}.`);
			if (min > 0) feld.minFotos = min;
		}
	}
	if (typ === 'zahl' || typ === 'messwert') {
		const min = zahlOder(f.min, `${woL}: Minimum`);
		const max = zahlOder(f.max, `${woL}: Maximum`);
		if (min !== undefined && max !== undefined && min > max) throw new SchemaFehler(`${woL}: Minimum ist größer als Maximum.`);
		if (min !== undefined) feld.min = min;
		if (max !== undefined) feld.max = max;
	}
	if (typ === 'messwert') {
		const einheit = text(f.einheit, `${woL}: Einheit`, GRENZEN.einheit, false);
		if (einheit) feld.einheit = einheit;
	}
	if (typ === 'unterschrift') feld.wer = f.wer === 'monteur' ? 'monteur' : 'kunde';
	if ((AUFMASS_TYPEN as readonly string[]).includes(typ)) pruefeAufmassFeld(f, feld, woL);
	else if (typ === 'zahl' || typ === 'messwert') {
		// Kürzel auch für Zahl/Messwert (z. B. „verschnitt“ in Formeln)
		const kuerzel = text(f.kuerzel, `${woL}: Kürzel`, 20, false);
		if (kuerzel) {
			if (!KUERZEL.test(kuerzel)) throw new SchemaFehler(`${woL}: Kürzel nur aus Buchstaben, Ziffern und _ (mit Buchstabe vorn).`);
			feld.kuerzel = kuerzel;
		}
	}
	if (f.bedingung !== undefined && f.bedingung !== null) {
		const b = f.bedingung;
		if (!istObjekt(b)) throw new SchemaFehler(`${woL}: ungültige Bedingung.`);
		const quelle = typeof b.feld === 'string' ? frueher.get(b.feld) : undefined;
		if (!quelle) throw new SchemaFehler(`${woL}: Die Bedingung muss sich auf ein Feld davor beziehen.`);
		if (typeof b.op !== 'string' || !opsFuer(quelle.typ).includes(b.op as BedingungOp)) {
			throw new SchemaFehler(`${woL}: Dieser Vergleich passt nicht zu „${quelle.label}“.`);
		}
		const op = b.op as BedingungOp;
		const bedingung: Bedingung = { feld: quelle.id, op, wirkung: b.wirkung === 'pflicht' ? 'pflicht' : 'zeigen' };
		if (op === 'gleich' || op === 'ungleich' || op === 'groesser' || op === 'kleiner') {
			const wert = text(b.wert, `${woL}: Vergleichswert`, GRENZEN.option, true)!;
			if ((op === 'groesser' || op === 'kleiner') && zahlOder(wert, `${woL}: Vergleichswert`) === undefined) {
				throw new SchemaFehler(`${woL}: Vergleichswert muss eine Zahl sein.`);
			}
			if (quelle.typ === 'janein' && wert !== 'ja' && wert !== 'nein') throw new SchemaFehler(`${woL}: Vergleichswert ja oder nein.`);
			if (quelle.optionen && !quelle.optionen.includes(wert)) throw new SchemaFehler(`${woL}: „${wert}“ ist keine Option von „${quelle.label}“.`);
			bedingung.wert = wert;
		}
		if (typ === 'hinweis' && bedingung.wirkung === 'pflicht') bedingung.wirkung = 'zeigen';
		feld.bedingung = bedingung;
	}
	return feld;
}

// ---------------------------------------------------------------------------------------------------------------
// Auswertung

const leer = (w: unknown) =>
	w === undefined || w === null || (typeof w === 'string' && w.trim() === '') || (Array.isArray(w) && w.length === 0);

/** Hat das Feld überhaupt einen Wert (für die Bedingung „ausgefüllt“)? */
export function hatWert(feld: Feld, wert: unknown): boolean {
	if (feld.typ === 'unterschrift') return istObjekt(wert) && typeof wert.dateiId === 'string';
	if (istZahlTyp(feld.typ)) return typeof wert === 'number' && Number.isFinite(wert);
	if (feld.typ === 'janein') return typeof wert === 'boolean';
	return !leer(wert);
}

const alsZahl = (w: unknown): number | null => {
	if (typeof w === 'number' && Number.isFinite(w)) return w;
	if (typeof w === 'string' && w.trim() !== '') {
		const n = Number(w.replace(',', '.'));
		return Number.isFinite(n) ? n : null;
	}
	return null;
};

/** Gilt die Bedingung für den Wert des Quellfelds? (Wert `undefined`, wenn das Quellfeld selbst verborgen ist.) */
export function bedingungGilt(b: Bedingung, quelle: Feld, wert: unknown): boolean {
	switch (b.op) {
		case 'ausgefuellt':
			return hatWert(quelle, wert);
		case 'leer':
			return !hatWert(quelle, wert);
		case 'groesser':
		case 'kleiner': {
			const a = alsZahl(wert);
			const v = alsZahl(b.wert);
			if (a === null || v === null) return false;
			return b.op === 'groesser' ? a > v : a < v;
		}
		case 'gleich':
		case 'ungleich': {
			let gleich: boolean;
			if (!hatWert(quelle, wert)) gleich = false;
			else if (quelle.typ === 'janein') gleich = (wert === true ? 'ja' : 'nein') === b.wert;
			else if (Array.isArray(wert)) gleich = wert.includes(b.wert);
			else if (istZahlTyp(quelle.typ)) gleich = alsZahl(wert) === alsZahl(b.wert);
			else gleich = String(wert).trim().toLowerCase() === String(b.wert ?? '').trim().toLowerCase();
			// „ist nicht“ gilt nur bei einem vorhandenen, anderen Wert (leer ist weder gleich noch ungleich)
			return b.op === 'gleich' ? gleich : hatWert(quelle, wert) && !gleich;
		}
	}
}

export type FeldZustand = { sichtbar: boolean; pflicht: boolean };

/** Sichtbarkeit und Pflicht aller Felder für die aktuellen Antworten (in Reihenfolge, Bedingungen kaskadieren). */
export function auswerten(schemaRoh: Schema, antworten: Antworten): Map<string, FeldZustand> {
	const schema = expandiere(schemaRoh, antworten);
	const zustand = new Map<string, FeldZustand>();
	const felder = new Map<string, Feld>();
	for (const { feld } of alleFelder(schema)) {
		felder.set(feld.id, feld);
		let gilt = true;
		const b = feld.bedingung;
		if (b) {
			const quelle = felder.get(b.feld);
			const quelleSichtbar = zustand.get(b.feld)?.sichtbar ?? false;
			gilt = quelle ? bedingungGilt(b, quelle, quelleSichtbar ? antworten[b.feld] : undefined) : false;
		}
		const sichtbar = b?.wirkung === 'zeigen' ? gilt : true;
		// berechnete Felder füllt die Formel – nie „Pflicht“ für den Nutzer
		const pflicht = feld.typ !== 'hinweis' && !istBerechnet(feld) && sichtbar && (!!feld.pflicht || (b?.wirkung === 'pflicht' && gilt));
		zustand.set(feld.id, { sichtbar, pflicht });
	}
	return zustand;
}

/** Mindestanzahl Fotos eines Pflicht-Fotofelds. */
export const minFotos = (f: Feld) => Math.max(1, f.minFotos ?? 1);

/**
 * Warum ein (sichtbares) Feld nicht in Ordnung ist – oder `null`. Pflichtfelder brauchen einen Wert (Checkliste: alle
 * Punkte abgehakt, Foto: Mindestanzahl); Zahlen müssen in ihren Grenzen liegen, auch wenn sie freiwillig sind.
 */
export function feldProblem(feld: Feld, wert: unknown, pflicht: boolean): string | null {
	if (feld.typ === 'hinweis') return null;
	if (istZahlTyp(feld.typ) && !istBerechnet(feld) && hatWert(feld, wert)) {
		const n = wert as number;
		const e = einheitVon(feld);
		if (feld.min !== undefined && n < feld.min) return `mindestens ${feld.min}${e ? ' ' + e : ''}`;
		if (feld.max !== undefined && n > feld.max) return `höchstens ${feld.max}${e ? ' ' + e : ''}`;
	}
	if (!pflicht) return null;
	if (feld.typ === 'foto') {
		const n = Array.isArray(wert) ? wert.length : 0;
		const min = minFotos(feld);
		return n >= min ? null : min === 1 ? 'Foto fehlt' : `noch ${min - n} Foto${min - n === 1 ? '' : 's'}`;
	}
	if (feld.typ === 'checkliste') {
		const erledigt = Array.isArray(wert) ? wert : [];
		const offen = (feld.optionen ?? []).filter((o) => !erledigt.includes(o)).length;
		return offen === 0 ? null : `${offen} Punkt${offen === 1 ? '' : 'e'} offen`;
	}
	if (feld.typ === 'unterschrift') return hatWert(feld, wert) ? null : 'Unterschrift fehlt';
	return hatWert(feld, wert) ? null : 'Pflichtfeld';
}

export type Fehlend = { feldId: string; label: string; grund: string; seite: number };

/** Was einem Schritt (Seite `seite`) oder – ohne `seite` – dem ganzen Protokoll noch fehlt. */
export function fehlendeFelder(schemaRoh: Schema, antworten: Antworten, seite?: number): Fehlend[] {
	const schema = expandiere(schemaRoh, antworten);
	const zustand = auswerten(schema, antworten);
	const aus: Fehlend[] = [];
	for (const { feld, seite: s } of alleFelder(schema)) {
		if (seite !== undefined && s !== seite) continue;
		const z = zustand.get(feld.id)!;
		if (!z.sichtbar) continue;
		const grund = feldProblem(feld, antworten[feld.id], z.pflicht);
		if (grund) aus.push({ feldId: feld.id, label: feld.gruppe ? `${feld.gruppe}: ${feld.label}` : feld.label, grund, seite: s });
	}
	return aus;
}

/** Darf der Assistent von diesem Schritt weiter? */
export const schrittFrei = (schema: Schema, antworten: Antworten, seite: number) => fehlendeFelder(schema, antworten, seite).length === 0;

/** Erste Seite, auf der noch etwas fehlt (oder die letzte, wenn alles erfüllt ist). */
export function ersteOffeneSeite(schema: Schema, antworten: Antworten): number {
	const f = fehlendeFelder(schema, antworten);
	return f.length > 0 ? f[0].seite : schema.seiten.length - 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Antworten bereinigen

function wertFuer(feld: Feld, w: unknown): unknown {
	switch (feld.typ) {
		case 'hinweis':
		case 'foto':
		case 'unterschrift':
			return undefined; // Dateien setzt nur der Server
		case 'text':
		case 'textlang': {
			if (typeof w !== 'string') return undefined;
			const t = w.replaceAll('\u0000', '');
			return [...t].slice(0, feld.typ === 'text' ? GRENZEN.text : GRENZEN.textlang).join('');
		}
		case 'zahl':
		case 'messwert':
		case 'mass':
		case 'flaeche':
		case 'umfang':
		case 'volumen':
		case 'abzug':
		case 'stueck':
		case 'formel': {
			if (istBerechnet(feld)) return undefined; // rechnet der Server (berechne)
			const n = alsZahl(w);
			if (n === null || Math.abs(n) > 1e9) return undefined;
			return feld.typ === 'stueck' ? Math.round(n) : n;
		}
		case 'janein':
			return typeof w === 'boolean' ? w : undefined;
		case 'auswahl':
			return typeof w === 'string' && feld.optionen?.includes(w) ? w : undefined;
		case 'mehrfach':
		case 'checkliste':
			return Array.isArray(w) ? feld.optionen!.filter((o) => w.includes(o)) : undefined;
		case 'datum':
			return typeof w === 'string' && TAG.test(w) && !Number.isNaN(Date.parse(w + 'T00:00:00Z')) ? w : undefined;
		case 'uhrzeit':
			return typeof w === 'string' && UHRZEIT.test(w) ? w : undefined;
	}
}

/**
 * Antworten aus dem Browser: nur bekannte Felder mit passendem Typ (Unbekanntes und Unpassendes fällt weg). Werte von
 * Foto- und Unterschriftsfeldern kommen aus `bisher` (die setzt nur der Server beim Hochladen).
 */
export function bereinigeAntworten(schemaRoh: Schema, roh: unknown, bisher: Antworten = {}): Antworten {
	const eingabe = istObjekt(roh) ? roh : {};
	const aus: Antworten = {};
	// Anzahl der Wiederholungen (Räume) – ganze Zahl 1 … MAX_WIEDERHOLUNGEN
	for (const s of schemaRoh.seiten) {
		for (const a of s.abschnitte) {
			if (!a.wiederholbar) continue;
			const n = alsZahl(eingabe[anzahlSchluessel(a.id)]);
			if (n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_WIEDERHOLUNGEN) aus[anzahlSchluessel(a.id)] = n;
		}
	}
	const schema = expandiere(schemaRoh, aus);
	for (const { feld } of alleFelder(schema)) {
		if (DATEI_TYPEN.includes(feld.typ)) {
			if (bisher[feld.id] !== undefined) aus[feld.id] = bisher[feld.id];
			continue;
		}
		if (!Object.hasOwn(eingabe, feld.id)) continue;
		const w = wertFuer(feld, eingabe[feld.id]);
		if (w !== undefined && !(Array.isArray(w) && w.length === 0) && w !== '') aus[feld.id] = w;
	}
	return berechne(schema, aus);
}

/** Gültige Datei-IDs eines Fotofelds / einer Unterschrift (für Server und PDF). */
export function dateiIds(feld: Feld, wert: unknown): string[] {
	if (feld.typ === 'foto') return Array.isArray(wert) ? wert.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
	if (feld.typ === 'unterschrift') return istObjekt(wert) && typeof wert.dateiId === 'string' && UUID.test(wert.dateiId) ? [wert.dateiId] : [];
	return [];
}

/** Antwort als Text (Liste, PDF). */
export function wertText(feld: Feld, wert: unknown): string {
	if (!hatWert(feld, wert)) return '–';
	switch (feld.typ) {
		case 'janein':
			return wert ? 'Ja' : 'Nein';
		case 'mehrfach':
			return (wert as string[]).join(', ');
		case 'checkliste':
			return (feld.optionen ?? []).map((o) => `${(wert as string[]).includes(o) ? '☑' : '☐'} ${o}`).join('\n');
		case 'datum': {
			const [j, m, t] = String(wert).split('-');
			return `${t}.${m}.${j}`;
		}
		case 'uhrzeit':
			return `${wert} Uhr`;
		case 'zahl':
			return String(wert).replace('.', ',');
		case 'messwert':
			return `${String(wert).replace('.', ',')}${feld.einheit ? ' ' + feld.einheit : ''}`;
		case 'mass':
		case 'flaeche':
		case 'umfang':
		case 'volumen':
		case 'abzug':
		case 'stueck':
		case 'formel': {
			const e = einheitVon(feld);
			return `${(wert as number).toLocaleString('de-DE', { maximumFractionDigits: 3 })}${e ? ' ' + e : ''}`;
		}
		case 'foto': {
			const n = (wert as unknown[]).length;
			return `${n} Foto${n === 1 ? '' : 's'}`;
		}
		case 'unterschrift': {
			const u = wert as UnterschriftWert;
			return u.name ? `unterschrieben von ${u.name}` : 'unterschrieben';
		}
		default:
			return String(wert);
	}
}

/** Kurzbeschreibung einer Bedingung für Baukasten und Vorschau („Nur wenn „Mangel“ ist ja“). */
export function bedingungText(b: Bedingung, quelle: Feld | undefined): string {
	const name = quelle ? `„${quelle.label}“` : 'ein Feld';
	const wert = b.wert !== undefined ? ` ${b.wert}` : '';
	const satz = `${name} ${BEDINGUNG_OP_NAMEN[b.op]}${wert}`;
	return b.wirkung === 'zeigen' ? `Nur wenn ${satz}` : `Pflicht, wenn ${satz}`;
}

/** Leere Vorlage für „+ Neue Vorlage“. */
export function leeresSchema(): Schema {
	return {
		seiten: [
			{
				id: neueId('s'),
				titel: 'Schritt 1',
				abschnitte: [{ id: neueId('a'), felder: [{ id: neueId('f'), typ: 'text', label: 'Bemerkung' }] }]
			}
		]
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Aufmaß (Wunsch Jamil, Talk msg 2842): Maße, berechnete Felder, wiederholbare Abschnitte (Räume), Katalog-Mengen

/** Einheit eines Felds (Messwert/Maß/Formel: eingestellt; sonst fest je Typ). */
export function einheitVon(feld: Pick<Feld, 'typ' | 'einheit'>): string | undefined {
	return AUFMASS_EINHEIT[feld.typ] ?? feld.einheit;
}

const KUERZEL = /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_]{0,19}$/;
const UUID_KATALOG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formelPruefen(text: string, wo: string): string {
	try {
		parse(text);
	} catch (e) {
		if (e instanceof FormelFehler) throw new SchemaFehler(`${wo}: ${e.message}`);
		throw e;
	}
	return text;
}

/** Felder eines Aufmaß-Typs: Kürzel, Einheit, Formel, Nachkommastellen, Grenzen, Katalog-Verknüpfung. */
function pruefeAufmassFeld(f: Record<string, unknown>, feld: Feld, woL: string): void {
	const kuerzel = text(f.kuerzel, `${woL}: Kürzel`, 20, false);
	if (kuerzel) {
		if (!KUERZEL.test(kuerzel)) throw new SchemaFehler(`${woL}: Kürzel nur aus Buchstaben, Ziffern und _ (mit Buchstabe vorn), z. B. „L“ oder „wand“.`);
		feld.kuerzel = kuerzel;
	}
	if (feld.typ === 'mass') {
		const e = f.einheit === undefined || f.einheit === '' ? 'm' : f.einheit;
		if (!(MASS_EINHEITEN as readonly unknown[]).includes(e)) throw new SchemaFehler(`${woL}: Einheit m, cm oder mm.`);
		feld.einheit = e as string;
	}
	if (feld.typ === 'formel') {
		const e = text(f.einheit, `${woL}: Einheit`, GRENZEN.einheit, false);
		if (e) feld.einheit = e;
	}
	const formel = text(f.formel, `${woL}: Formel`, 500, feld.typ === 'formel');
	if (formel && (feld.typ === 'formel' || feld.typ === 'flaeche' || feld.typ === 'umfang' || feld.typ === 'volumen')) feld.formel = formelPruefen(formel, woL);
	const nk = zahlOder(f.nachkomma, `${woL}: Nachkommastellen`);
	if (nk !== undefined) {
		if (!Number.isInteger(nk) || nk < 0 || nk > 4) throw new SchemaFehler(`${woL}: Nachkommastellen 0–4.`);
		feld.nachkomma = nk;
	}
	if (!istBerechnet(feld)) {
		const min = zahlOder(f.min, `${woL}: Minimum`);
		const max = zahlOder(f.max, `${woL}: Maximum`);
		if (min !== undefined && max !== undefined && min > max) throw new SchemaFehler(`${woL}: Minimum ist größer als Maximum.`);
		if (min !== undefined) feld.min = min;
		if (max !== undefined) feld.max = max;
	}
	if (f.katalog !== undefined && f.katalog !== null) {
		const k = f.katalog;
		if (!istObjekt(k) || typeof k.positionId !== 'string' || !UUID_KATALOG.test(k.positionId)) throw new SchemaFehler(`${woL}: ungültige Katalogposition.`);
		feld.katalog = { positionId: k.positionId.toLowerCase() };
		const menge = text(k.menge, `${woL}: Mengenformel`, 500, false);
		if (menge) feld.katalog.menge = formelPruefen(menge, `${woL} (Mengenformel)`);
	}
}

type Ort = { feld: Feld; abschnitt: Abschnitt };

/** Name (Kürzel ohne Groß/klein oder Feld-ID) → Feld mit Abschnitt. */
function namensRegister(schema: Schema): Map<string, Ort> {
	const m = new Map<string, Ort>();
	for (const s of schema.seiten) for (const a of s.abschnitte) for (const f of a.felder) {
		m.set(f.id, { feld: f, abschnitt: a });
		if (f.kuerzel) m.set(f.kuerzel.toLowerCase(), { feld: f, abschnitt: a });
	}
	return m;
}

/**
 * Prüft alle Formeln einer Vorlage: Kürzel eindeutig, Namen bekannt und Zahlenfelder, Reichweite (im Raum: Felder
 * desselben Raums oder außerhalb; außerhalb: nur Felder außerhalb – Räume nur über summe(…)), keine Kreise.
 */
function pruefeAufmass(schema: Schema): void {
	const register = new Map<string, Ort>();
	for (const s of schema.seiten) for (const a of s.abschnitte) for (const f of a.felder) {
		register.set(f.id, { feld: f, abschnitt: a });
	}
	for (const { feld, abschnitt } of [...register.values()]) {
		if (!feld.kuerzel) continue;
		const k = feld.kuerzel.toLowerCase();
		const da = register.get(k);
		if (da && da.feld !== feld) throw new SchemaFehler(`Kürzel „${feld.kuerzel}“ ist doppelt (auch bei „${da.feld.label}“).`);
		register.set(k, { feld, abschnitt });
	}
	const kanten = new Map<string, string[]>();
	for (const s of schema.seiten) for (const a of s.abschnitte) for (const f of a.felder) {
		// Formel und Mengenformel prüfen; nur die Formel zählt für Kreise (die Menge darf den eigenen Wert nutzen)
		const formeln: [string, boolean][] = [];
		if (f.formel) formeln.push([f.formel, true]);
		if (f.katalog?.menge) formeln.push([f.katalog.menge, false]);
		const ziele: string[] = [];
		for (const [text, zaehlt] of formeln) {
			const baum = parse(text);
			for (const n of namen(baum)) {
				const o = register.get(n) ?? register.get(n.toLowerCase());
				if (!o) throw new SchemaFehler(`„${f.label}“: „${n}“ ist kein Feld bzw. Kürzel.`);
				if (!istZahlTyp(o.feld.typ)) throw new SchemaFehler(`„${f.label}“: „${o.feld.label}“ ist kein Zahlenfeld.`);
				if (o.abschnitt.wiederholbar && o.abschnitt !== a) {
					throw new SchemaFehler(`„${f.label}“: „${o.feld.label}“ liegt in „${o.abschnitt.wiederholName ?? 'Bereich'}“ – dafür summe(${n}) verwenden.`);
				}
				if (zaehlt) ziele.push(o.feld.id);
			}
			for (const n of namen(baum, true)) {
				const o = register.get(n) ?? register.get(n.toLowerCase());
				if (!o) throw new SchemaFehler(`„${f.label}“: „${n}“ ist kein Feld bzw. Kürzel.`);
				if (!istZahlTyp(o.feld.typ)) throw new SchemaFehler(`„${f.label}“: „${o.feld.label}“ ist kein Zahlenfeld.`);
				if (!o.abschnitt.wiederholbar) throw new SchemaFehler(`„${f.label}“: summe(${n}) nur für Felder in wiederholbaren Abschnitten.`);
				if (zaehlt) ziele.push(o.feld.id);
			}
		}
		if (f.formel) kanten.set(f.id, ziele);
	}
	// Kreise (a = b + 1, b = a * 2) verbieten
	const zustand = new Map<string, 1 | 2>();
	const besuche = (id: string, pfad: string[]) => {
		if (zustand.get(id) === 2) return;
		if (zustand.get(id) === 1) {
			const namen = [...pfad.slice(pfad.indexOf(id)), id].map((x) => register.get(x)?.feld.label ?? x);
			throw new SchemaFehler(`Formeln im Kreis: ${namen.join(' → ')}.`);
		}
		zustand.set(id, 1);
		for (const z of kanten.get(id) ?? []) besuche(z, [...pfad, id]);
		zustand.set(id, 2);
	};
	for (const id of kanten.keys()) besuche(id, []);
}

const nrId = (id: string, nr: number) => (nr === 1 ? id : `${id}__${nr}`);

/** Anzahl Wiederholungen eines Abschnitts aus den Antworten (1 … MAX). */
export function anzahlVon(antworten: Antworten, abschnittId: string): number {
	const n = alsZahl(antworten[anzahlSchluessel(abschnittId)]);
	return n !== null && Number.isInteger(n) && n >= 1 && n <= MAX_WIEDERHOLUNGEN ? n : 1;
}

/**
 * Klappt wiederholbare Abschnitte auf (Raum 1, Raum 2, …): Feld-IDs ab der 2. Wiederholung mit „__n“, Bedingungen und
 * Formeln auf die Felder derselben Wiederholung umgeschrieben, summe(x) auf alle Wiederholungen. Formeln stehen danach
 * mit Feld-IDs statt Kürzeln. Ohne wiederholbare Abschnitte und ohne Formeln: dasselbe Schema. Mehrfach aufrufbar.
 */
export function expandiere(schema: Schema, antworten: Antworten): Schema {
	if (schema.expandiert) return schema;
	const hatAufmass = schema.seiten.some((s) => s.abschnitte.some((a) => a.wiederholbar || a.felder.some((f) => f.formel || f.katalog)));
	if (!hatAufmass) return schema;
	const register = namensRegister(schema);
	const ortVon = (n: string) => register.get(n) ?? register.get(n.toLowerCase());
	const alleIds = (n: string): string[] => {
		const o = ortVon(n);
		if (!o) return [];
		return o.abschnitt.wiederholbar ? Array.from({ length: anzahlVon(antworten, o.abschnitt.id) }, (_, i) => nrId(o.feld.id, i + 1)) : [o.feld.id];
	};
	const umschreiben = (text: string, a: Abschnitt, nr: number): string =>
		alsText(
			ersetzeNamen(
				parse(text),
				(n) => {
					const o = ortVon(n);
					if (!o) return n;
					return o.abschnitt === a && a.wiederholbar ? nrId(o.feld.id, nr) : o.feld.id;
				},
				alleIds
			)
		);
	const seiten: Seite[] = schema.seiten.map((s) => ({
		...s,
		abschnitte: s.abschnitte.flatMap((a): Abschnitt[] => {
			const anzahl = a.wiederholbar ? anzahlVon(antworten, a.id) : 1;
			return Array.from({ length: anzahl }, (_, i) => {
				const nr = i + 1;
				const name = `${a.wiederholName ?? 'Bereich'} ${nr}`;
				const kopie: Abschnitt = {
					id: a.wiederholbar ? nrId(a.id, nr) : a.id,
					felder: a.felder.map((f) => {
						const g: Feld = { ...f, id: a.wiederholbar ? nrId(f.id, nr) : f.id };
						if (a.wiederholbar) g.gruppe = name;
						if (f.formel) g.formel = umschreiben(f.formel, a, nr);
						if (f.katalog) g.katalog = { positionId: f.katalog.positionId, menge: umschreiben(f.katalog.menge ?? f.id, a, nr) };
						if (f.bedingung && a.wiederholbar && a.felder.some((x) => x.id === f.bedingung!.feld)) g.bedingung = { ...f.bedingung, feld: nrId(f.bedingung.feld, nr) };
						return g;
					})
				};
				if (a.titel || a.wiederholbar) kopie.titel = a.wiederholbar ? (a.titel ? `${a.titel} – ${name}` : name) : a.titel;
				if (a.wiederholbar) kopie.wdh = { basis: a.id, nr, anzahl, name: a.wiederholName ?? 'Bereich' };
				return kopie;
			});
		})
	}));
	return { seiten, expandiert: true };
}

/** Berechnete Felder ausrechnen (in Abhängigkeitsreihenfolge, gerundet); fehlt eine Angabe, bleibt das Feld leer. */
export function berechne(schemaRoh: Schema, antworten: Antworten): Antworten {
	const schema = expandiere(schemaRoh, antworten);
	const felder = alleFelder(schema).map((x) => x.feld);
	const rechnend = felder.filter((f) => istBerechnet(f) && f.formel);
	if (rechnend.length === 0) return antworten;
	const aus: Antworten = { ...antworten };
	const baeume = new Map<string, Knoten>(rechnend.map((f) => [f.id, parse(f.formel!)]));
	const zahl = (id: string) => {
		const w = aus[id];
		return typeof w === 'number' && Number.isFinite(w) ? w : null;
	};
	for (const f of rechnend) delete aus[f.id];
	// höchstens so viele Durchläufe wie Formeln (Kreise verbietet pruefeSchema)
	for (let lauf = 0; lauf <= rechnend.length; lauf++) {
		let geaendert = false;
		for (const f of rechnend) {
			const w = rechne(baeume.get(f.id)!, zahl);
			const n = f.nachkomma ?? 2;
			const r = w === null || !Number.isFinite(w) ? null : Math.round(w * 10 ** n) / 10 ** n;
			if (r !== zahl(f.id)) {
				if (r === null) delete aus[f.id];
				else aus[f.id] = r;
				geaendert = true;
			}
		}
		if (!geaendert) break;
	}
	return aus;
}

/** Mengen je Katalogposition (sichtbare, verknüpfte Felder über alle Räume summiert; nur positive Mengen). */
export function aufmassMengen(schemaRoh: Schema, antworten: Antworten): { positionId: string; menge: number; felder: string[] }[] {
	const schema = expandiere(schemaRoh, antworten);
	const werte = berechne(schema, antworten);
	const zustand = auswerten(schema, werte);
	const zahl = (id: string) => {
		const w = werte[id];
		return typeof w === 'number' && Number.isFinite(w) ? w : null;
	};
	const je = new Map<string, { menge: number; felder: string[] }>();
	for (const { feld } of alleFelder(schema)) {
		if (!feld.katalog || !zustand.get(feld.id)?.sichtbar) continue;
		const m = rechne(parse(feld.katalog.menge ?? feld.id), zahl);
		if (m === null || m <= 0) continue;
		const x = je.get(feld.katalog.positionId) ?? { menge: 0, felder: [] };
		x.menge += m;
		x.felder.push(feld.gruppe ? `${feld.gruppe}: ${feld.label}` : feld.label);
		je.set(feld.katalog.positionId, x);
	}
	return [...je].map(([positionId, x]) => ({ positionId, menge: Math.round(x.menge * 1000) / 1000, felder: x.felder }));
}

/** „+ Raum“: eine Wiederholung mehr (höchstens MAX). */
export function mitWiederholung(antworten: Antworten, abschnittId: string): Antworten {
	return { ...antworten, [anzahlSchluessel(abschnittId)]: Math.min(MAX_WIEDERHOLUNGEN, anzahlVon(antworten, abschnittId) + 1) };
}

/** „Letzten Raum entfernen“: die letzte Wiederholung samt ihren Antworten (mindestens eine bleibt). */
export function ohneLetzteWiederholung(schema: Schema, antworten: Antworten, abschnittId: string): Antworten {
	const n = anzahlVon(antworten, abschnittId);
	if (n <= 1) return antworten;
	const a = schema.seiten.flatMap((s) => s.abschnitte).find((x) => x.id === abschnittId);
	const aus: Antworten = { ...antworten, [anzahlSchluessel(abschnittId)]: n - 1 };
	for (const f of a?.felder ?? []) delete aus[nrId(f.id, n)];
	return aus;
}
