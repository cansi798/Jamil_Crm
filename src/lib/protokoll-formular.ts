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
	'messwert'
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
	messwert: 'Messwert mit Einheit'
};

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
};

export type Abschnitt = { id: string; titel?: string; felder: Feld[] };
export type Seite = { id: string; titel: string; abschnitte: Abschnitt[] };
export type Schema = { seiten: Seite[] };

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
			abschnitt.felder = a.felder.map((f, fi) => {
				anzahl++;
				if (anzahl > GRENZEN.felder) throw new SchemaFehler(`Höchstens ${GRENZEN.felder} Felder je Vorlage.`);
				const feld = pruefeFeld(f, `${woA}, Feld ${fi + 1}`, eindeutig, frueher, opts.typen);
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
	if (feld.typ === 'zahl' || feld.typ === 'messwert') return typeof wert === 'number' && Number.isFinite(wert);
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
			else if (quelle.typ === 'zahl' || quelle.typ === 'messwert') gleich = alsZahl(wert) === alsZahl(b.wert);
			else gleich = String(wert).trim().toLowerCase() === String(b.wert ?? '').trim().toLowerCase();
			// „ist nicht“ gilt nur bei einem vorhandenen, anderen Wert (leer ist weder gleich noch ungleich)
			return b.op === 'gleich' ? gleich : hatWert(quelle, wert) && !gleich;
		}
	}
}

export type FeldZustand = { sichtbar: boolean; pflicht: boolean };

/** Sichtbarkeit und Pflicht aller Felder für die aktuellen Antworten (in Reihenfolge, Bedingungen kaskadieren). */
export function auswerten(schema: Schema, antworten: Antworten): Map<string, FeldZustand> {
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
		const pflicht = feld.typ !== 'hinweis' && sichtbar && (!!feld.pflicht || (b?.wirkung === 'pflicht' && gilt));
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
	if ((feld.typ === 'zahl' || feld.typ === 'messwert') && hatWert(feld, wert)) {
		const n = wert as number;
		if (feld.min !== undefined && n < feld.min) return `mindestens ${feld.min}${feld.einheit ? ' ' + feld.einheit : ''}`;
		if (feld.max !== undefined && n > feld.max) return `höchstens ${feld.max}${feld.einheit ? ' ' + feld.einheit : ''}`;
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
export function fehlendeFelder(schema: Schema, antworten: Antworten, seite?: number): Fehlend[] {
	const zustand = auswerten(schema, antworten);
	const aus: Fehlend[] = [];
	for (const { feld, seite: s } of alleFelder(schema)) {
		if (seite !== undefined && s !== seite) continue;
		const z = zustand.get(feld.id)!;
		if (!z.sichtbar) continue;
		const grund = feldProblem(feld, antworten[feld.id], z.pflicht);
		if (grund) aus.push({ feldId: feld.id, label: feld.label, grund, seite: s });
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
		case 'messwert': {
			const n = alsZahl(w);
			return n === null ? undefined : n;
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
export function bereinigeAntworten(schema: Schema, roh: unknown, bisher: Antworten = {}): Antworten {
	const eingabe = istObjekt(roh) ? roh : {};
	const aus: Antworten = {};
	for (const { feld } of alleFelder(schema)) {
		if (DATEI_TYPEN.includes(feld.typ)) {
			if (bisher[feld.id] !== undefined) aus[feld.id] = bisher[feld.id];
			continue;
		}
		if (!Object.hasOwn(eingabe, feld.id)) continue;
		const w = wertFuer(feld, eingabe[feld.id]);
		if (w !== undefined && !(Array.isArray(w) && w.length === 0) && w !== '') aus[feld.id] = w;
	}
	return aus;
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
