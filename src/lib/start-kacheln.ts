import { KENNZAHL_IDS, KENNZAHLEN, type KennzahlId } from './kennzahlen';

/**
 * Frei zusammenstellbarer Start (Jamil msg 2942): Jede Person legt fest, welche Kacheln (Widgets) in welcher
 * Reihenfolge und Größe erscheinen. Raster mit 12 Spalten: S = 3, M = 4, L = 6, Breit = 12 Spalten; Höhe 1 oder 2
 * Zeilen. Am Handy eine Spalte in derselben Reihenfolge. Gespeichert wird nur die Liste (id, Größe, Höhe) – serverseitig
 * je Benutzer (Tabelle app.start_layouts); welche Kacheln jemand sehen darf, entscheidet der Server (Rechte, Module).
 */

export const GROESSEN = ['s', 'm', 'l', 'breit'] as const;
export type Groesse = (typeof GROESSEN)[number];
export const GROESSE_NAMEN: Record<Groesse, string> = { s: 'S', m: 'M', l: 'L', breit: 'Breit' };
/** Spalten im 12er-Raster (Desktop) */
export const SPALTEN: Record<Groesse, number> = { s: 3, m: 4, l: 6, breit: 12 };
export type Hoehe = 1 | 2;
export const MAX_KACHELN = 40;

export type StartKachel = { id: string; groesse: Groesse; hoehe: Hoehe };
export type StartLayout = StartKachel[];

export type KachelGruppe = 'Heute' | 'Kennzahlen' | 'Planung' | 'Navigation';
export type KachelArt = { id: string; titel: string; beschreibung: string; gruppe: KachelGruppe; groesse: Groesse; hoehe: Hoehe };

const FEST: KachelArt[] = [
	{ id: 'heute', titel: 'Heute', beschreibung: 'Termine, Aufgaben und Nachfassen des Tages', gruppe: 'Heute', groesse: 'l', hoehe: 2 },
	{ id: 'zeiterfassung', titel: 'Zeiterfassung', beschreibung: 'Zeit starten, Pause, Fahrt – für die Aufträge von heute', gruppe: 'Heute', groesse: 'l', hoehe: 1 },
	{ id: 'monat', titel: 'Diesen Monat', beschreibung: 'Gewinn verplant bzw. bis zum Break-even, Stunden frei', gruppe: 'Planung', groesse: 'l', hoehe: 1 },
	{ id: 'handlung', titel: 'Handlungsbedarf', beschreibung: 'Nachfassen, abgelaufene Angebote, Entwürfe, überfällige Aufgaben', gruppe: 'Kennzahlen', groesse: 'l', hoehe: 1 },
	{ id: 'nachfassen', titel: 'Nachfassen fällig', beschreibung: 'Aufträge, bei denen jetzt nachgefasst werden sollte', gruppe: 'Kennzahlen', groesse: 's', hoehe: 1 },
	{ id: 'kennzahlen', titel: 'Alle Kennzahlen', beschreibung: 'Die sieben Kennzahlen des Monats auf einen Blick', gruppe: 'Kennzahlen', groesse: 'breit', hoehe: 1 },
	{ id: 'auslastung', titel: 'Auslastung (2 Wochen)', beschreibung: 'Geplante Stunden je Mitarbeiter', gruppe: 'Planung', groesse: 'l', hoehe: 1 },
	{ id: 'quellen', titel: 'Umsatz nach Auftragsquelle', beschreibung: 'Umsatz dieses Jahr je Quelle', gruppe: 'Kennzahlen', groesse: 'l', hoehe: 1 },
	{ id: 'buchungen', titel: 'Neue Online-Buchungen', beschreibung: 'Buchungen der letzten 7 Tage', gruppe: 'Planung', groesse: 'm', hoehe: 1 },
	{ id: 'nachweise', titel: 'Partner-Nachweise laufen ab', beschreibung: 'Abgelaufene und bald ablaufende Nachweise', gruppe: 'Planung', groesse: 'm', hoehe: 1 },
	{ id: 'bereiche', titel: 'Bereiche', beschreibung: 'Schnellzugriff auf alle Bereiche', gruppe: 'Navigation', groesse: 'breit', hoehe: 1 }
];

export const kennzahlKachelId = (id: KennzahlId) => `kz-${id}`;

/** Alle Kachel-Arten (ohne Rechteprüfung) – einzelne Kennzahlen als „kz-<id>“. */
export const KACHEL_ARTEN: KachelArt[] = [
	...FEST,
	...KENNZAHL_IDS.map((id) => ({
		id: kennzahlKachelId(id),
		titel: KENNZAHLEN[id].titel,
		beschreibung: KENNZAHLEN[id].formel,
		gruppe: 'Kennzahlen' as const,
		groesse: 's' as const,
		hoehe: 1 as const
	}))
];
const ARTEN = new Map(KACHEL_ARTEN.map((a) => [a.id, a]));
export const kachelArt = (id: string): KachelArt | undefined => ARTEN.get(id);

export class LayoutFehler extends Error {}

const istGroesse = (w: unknown): w is Groesse => typeof w === 'string' && (GROESSEN as readonly string[]).includes(w);

/**
 * Prüft ein Layout aus dem Browser streng (Speichern): Liste, höchstens MAX_KACHELN, nur bekannte UND erlaubte
 * Kacheln, keine doppelten, gültige Größe/Höhe. Fehler → LayoutFehler (wird zu 400).
 */
export function pruefeLayout(roh: unknown, erlaubt: ReadonlySet<string>): StartLayout {
	if (!Array.isArray(roh)) throw new LayoutFehler('Ungültiges Layout.');
	if (roh.length > MAX_KACHELN) throw new LayoutFehler(`Höchstens ${MAX_KACHELN} Kacheln.`);
	const gesehen = new Set<string>();
	return roh.map((e) => {
		if (!e || typeof e !== 'object') throw new LayoutFehler('Ungültige Kachel.');
		const { id, groesse, hoehe } = e as Record<string, unknown>;
		if (typeof id !== 'string' || !ARTEN.has(id)) throw new LayoutFehler('Unbekannte Kachel.');
		if (!erlaubt.has(id)) throw new LayoutFehler('Diese Kachel steht Ihnen nicht zur Verfügung.');
		if (gesehen.has(id)) throw new LayoutFehler('Kachel doppelt.');
		gesehen.add(id);
		if (!istGroesse(groesse)) throw new LayoutFehler('Ungültige Größe.');
		if (hoehe !== 1 && hoehe !== 2) throw new LayoutFehler('Ungültige Höhe.');
		return { id, groesse, hoehe };
	});
}

/**
 * Gespeichertes Layout beim Laden nachsichtig bereinigen: Kacheln, die es nicht mehr gibt oder für die das Recht
 * fehlt (Rolle geändert), fallen still weg; Doppelte ebenso; kaputte Größen werden zur Vorgabe der Kachel.
 */
export function bereinigeLayout(roh: unknown, erlaubt: ReadonlySet<string>): StartLayout {
	if (!Array.isArray(roh)) return [];
	const gesehen = new Set<string>();
	const aus: StartLayout = [];
	for (const e of roh.slice(0, MAX_KACHELN)) {
		const id = e && typeof e === 'object' ? (e as Record<string, unknown>).id : null;
		if (typeof id !== 'string' || !erlaubt.has(id) || gesehen.has(id)) continue;
		const art = ARTEN.get(id);
		if (!art) continue;
		gesehen.add(id);
		const { groesse, hoehe } = e as Record<string, unknown>;
		aus.push({ id, groesse: istGroesse(groesse) ? groesse : art.groesse, hoehe: hoehe === 2 ? 2 : hoehe === 1 ? 1 : art.hoehe });
	}
	return aus;
}

export type StartRolle = 'chef' | 'buero' | 'monteur';

const k = (id: string, groesse: Groesse, hoehe: Hoehe = 1): StartKachel => ({ id, groesse, hoehe });
/** Vorgaben je Rolle (msg 2942) – gefiltert auf das, was die Person sehen darf. */
const STANDARD: Record<StartRolle, StartLayout> = {
	chef: [
		k('handlung', 'l'),
		k('monat', 'l'),
		k('kz-abschlussquote', 's'),
		k('kz-termintreue', 's'),
		k('kz-produktivitaet', 's'),
		k('kz-umsatz_mitarbeiter', 's'),
		k('heute', 'l', 2),
		k('auslastung', 'l'),
		k('quellen', 'l'),
		k('nachfassen', 's'),
		k('buchungen', 'm'),
		k('nachweise', 'm'),
		k('zeiterfassung', 'l'),
		k('bereiche', 'breit')
	],
	buero: [
		k('heute', 'l', 2),
		k('handlung', 'l'),
		k('monat', 'l'),
		k('nachfassen', 's'),
		k('buchungen', 'm'),
		k('auslastung', 'l'),
		k('nachweise', 'm'),
		k('zeiterfassung', 'l'),
		k('bereiche', 'breit')
	],
	monteur: [k('zeiterfassung', 'l'), k('heute', 'l', 2), k('monat', 'l'), k('bereiche', 'breit')]
};

export function standardLayout(rolle: StartRolle, erlaubt: ReadonlySet<string>): StartLayout {
	return STANDARD[rolle].filter((e) => erlaubt.has(e.id)).map((e) => ({ ...e }));
}

/** Kachel an Position i um eine Stelle nach oben (-1) bzw. unten (+1) schieben. */
export function verschiebe(layout: StartLayout, i: number, richtung: -1 | 1): StartLayout {
	const j = i + richtung;
	if (i < 0 || i >= layout.length || j < 0 || j >= layout.length) return layout;
	const neu = [...layout];
	[neu[i], neu[j]] = [neu[j], neu[i]];
	return neu;
}

/** Kachel `id` an die Stelle von `ziel` setzen (Ziehen). */
export function zieheAuf(layout: StartLayout, id: string, ziel: string): StartLayout {
	const von = layout.findIndex((e) => e.id === id);
	const nach = layout.findIndex((e) => e.id === ziel);
	if (von < 0 || nach < 0 || von === nach) return layout;
	const neu = [...layout];
	const [e] = neu.splice(von, 1);
	neu.splice(nach, 0, e);
	return neu;
}
