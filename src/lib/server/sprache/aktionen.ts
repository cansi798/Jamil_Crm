import { istTag } from '../../zeit';

/** Monat relativ zu heute (Auslastung, Gewinn). */
export const MONATE_RELATIV = ['dieser', 'letzter', 'naechster'] as const;
export type MonatRelativ = (typeof MONATE_RELATIV)[number];

/**
 * Feste Aktionsliste der Sprachsteuerung (Stufe 1d) als JSON-Schemas – dieselben Schemas gehen als Werkzeuge
 * (Function Calling) an die KI und prüfen deren Antwort. Die KI liefert nur, was gesprochen wurde: Namen als Text,
 * Zeiten als relative Angabe (`heute`, `morgen`, `uebermorgen`, `wochentag`, `datum`) plus Uhrzeit. IDs, Datumsrechnung
 * und Rechte macht der Server (`aufloesen.ts`, `ausfuehren.ts`). `unbekannt` ist der Ausweg der KI für alles andere
 * („Das kann ich noch nicht“).
 */

export const AKTIONEN = [
	'kunde_anlegen',
	'auftrag_anlegen',
	'todo_anlegen',
	'einsatz_anlegen',
	'einsatz_verschieben',
	'angebot_entwurf',
	'protokoll_ausfuellen',
	'mitarbeiter_zuweisen',
	'status_aendern',
	'todo_abhaken',
	'anlage_anlegen',
	'nachfassen_pausieren',
	'abfrage_tagesplan',
	'quelle_setzen',
	'route_heute',
	'abfrage_auslastung',
	'abfrage_monatsgewinn',
	'abfrage_nachfassen'
] as const;

/** Nur lesend (Frage) – keine Bestätigung, kein Vorschlag (Wunsch Jamil msg 2647). */
export const NUR_LESEN = ['abfrage_tagesplan', 'route_heute', 'abfrage_auslastung', 'abfrage_monatsgewinn', 'abfrage_nachfassen'] as const;

export type AktionsName = (typeof AKTIONEN)[number];
export type WerkzeugName = AktionsName | 'unbekannt';

export const WOCHENTAGE = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'] as const;
export type Wochentag = (typeof WOCHENTAGE)[number];

export type Zeitangabe = {
	tag: 'heute' | 'morgen' | 'uebermorgen' | 'wochentag' | 'datum';
	wochentag?: Wochentag;
	datum?: string;
	uhrzeit?: string;
};

export type KundeDaten = {
	art: 'privat' | 'firma';
	firma?: string;
	anrede?: string;
	vorname?: string;
	nachname?: string;
	telefon?: string;
	email?: string;
	strasse?: string;
	plz?: string;
	ort?: string;
};
export type AuftragDaten = {
	titel: string;
	kunde: { name: string; ort?: string };
	objekt?: string;
	beschreibung?: string;
	start?: Zeitangabe;
	ende_uhrzeit?: string;
	mitarbeiter?: string[];
	quelle?: string;
};
export type QuelleDaten = { auftrag: string; quelle: string };
export type Regel = 'taeglich' | 'woechentlich' | 'monatlich' | 'jaehrlich';
export type TodoDaten = { titel: string; zustaendig?: string; faellig?: Zeitangabe; auftrag?: string; wiederholung?: Regel; intervall?: number };
export type ZuweisenDaten = { auftrag: string; mitarbeiter: string[] };
export type StatusDaten = { auftrag: string; status: 'weiter' | 'anfrage' | 'angebot' | 'beauftragt' | 'in_arbeit' | 'abgenommen' | 'abgerechnet' };
export type AbhakenDaten = { titel: string; auftrag?: string };
export type AnlageDaten = {
	kunde: { name: string; ort?: string };
	objekt?: string;
	typ: 'solar' | 'waermepumpe' | 'gasspeicher' | 'heizung' | 'klima' | 'lueftung' | 'wallbox' | 'sonstige';
	bezeichnung?: string;
	hersteller?: string;
	modell?: string;
	seriennummer?: string;
	wartung?: Regel;
	wartung_intervall?: number;
};
export type NachfassenDaten = { angebot: string; fortsetzen?: boolean };
export type TagesplanDaten = { wer?: string; zeitraum: 'heute' | 'morgen' | 'woche' | 'datum'; datum?: string; nur_ueberfaellig?: boolean };
export type EinsatzDaten = { auftrag: string; mitarbeiter: string[]; start: Zeitangabe; ende_uhrzeit?: string; notiz?: string; bis?: Zeitangabe };
export type VerschiebenDaten = { mitarbeiter?: string; auftrag?: string; von?: Zeitangabe; nach: Zeitangabe };
export type AngebotDaten = { auftrag: string; stichworte: string };
export type ProtokollDaten = {
	auftrag?: { nummer?: string; name?: string };
	/** Baustellen-Protokoll (feste Typen, Stufe 2a) … */
	typ?: 'abnahme' | 'regiebericht' | 'aufmass' | 'maengelliste';
	/** … oder eine frei gestaltete Protokoll-Vorlage starten (Name wie gesprochen, z. B. „Abdichtung“) */
	vorlage?: string;
	inhalt?: { bemerkung?: string; maengel?: string; positionen?: string[] };
};

export type KiAktion =
	| { aktion: 'kunde_anlegen'; daten: KundeDaten }
	| { aktion: 'auftrag_anlegen'; daten: AuftragDaten }
	| { aktion: 'todo_anlegen'; daten: TodoDaten }
	| { aktion: 'einsatz_anlegen'; daten: EinsatzDaten }
	| { aktion: 'einsatz_verschieben'; daten: VerschiebenDaten }
	| { aktion: 'angebot_entwurf'; daten: AngebotDaten }
	| { aktion: 'protokoll_ausfuellen'; daten: ProtokollDaten }
	| { aktion: 'mitarbeiter_zuweisen'; daten: ZuweisenDaten }
	| { aktion: 'status_aendern'; daten: StatusDaten }
	| { aktion: 'todo_abhaken'; daten: AbhakenDaten }
	| { aktion: 'anlage_anlegen'; daten: AnlageDaten }
	| { aktion: 'nachfassen_pausieren'; daten: NachfassenDaten }
	| { aktion: 'abfrage_tagesplan'; daten: TagesplanDaten }
	| { aktion: 'quelle_setzen'; daten: QuelleDaten }
	| { aktion: 'route_heute'; daten: { wer?: string } }
	| { aktion: 'abfrage_auslastung'; daten: { wer?: string; monat?: MonatRelativ } }
	| { aktion: 'abfrage_monatsgewinn'; daten: { monat?: MonatRelativ } }
	| { aktion: 'abfrage_nachfassen'; daten: Record<string, never> }
	| { aktion: 'unbekannt'; daten: Record<string, never> };

/** Angebotsentwurf der KI: nur Katalogschlüssel, Mengen, Unsicherheit – nie Preise. */
export type KiEntwurf = { positionen: { schluessel: string; menge: number; unsicher: boolean }[] };

// ---------------------------------------------------------------------------------------------------------------
// Schemas (Teilmenge von JSON Schema, die `pruefe` unten versteht und die Mistral als Werkzeug-Parameter annimmt)

export type Schema = {
	type: 'object' | 'string' | 'array' | 'number' | 'integer' | 'boolean';
	description?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: false;
	items?: Schema;
	minItems?: number;
	maxItems?: number;
	enum?: readonly string[];
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	minimum?: number;
	maximum?: number;
};

const text = (maxLength: number, description: string): Schema => ({ type: 'string', minLength: 1, maxLength, description });
const UHRZEIT: Schema = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Uhrzeit HH:MM (24 h), z. B. 08:00' };

const ZEIT: Schema = {
	type: 'object',
	description:
		'Gesprochene Zeitangabe, nicht umgerechnet. tag=heute|morgen|uebermorgen; tag=wochentag mit wochentag (der nächste solche Tag, nie heute); tag=datum mit datum JJJJ-MM-TT (nur wenn ein Datum genannt wurde).',
	properties: {
		tag: { type: 'string', enum: ['heute', 'morgen', 'uebermorgen', 'wochentag', 'datum'] },
		wochentag: { type: 'string', enum: WOCHENTAGE },
		datum: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
		uhrzeit: UHRZEIT
	},
	required: ['tag'],
	additionalProperties: false
};

/** Wie ZEIT, aber `tag` ist optional (nur für `einsatz_verschieben.nach`: „Verschiebe auf 10 Uhr“ ohne Tag). */
const ZEIT_NACH: Schema = { ...ZEIT, required: undefined };

export const AKTIONS_SCHEMAS: Record<WerkzeugName, Schema> = {
	kunde_anlegen: {
		type: 'object',
		properties: {
			art: { type: 'string', enum: ['privat', 'firma'], description: 'firma bei Firmennamen (GmbH, KG, …), sonst privat' },
			firma: text(200, 'Firmenname (nur bei art=firma)'),
			anrede: text(50, 'Herr, Frau, …'),
			vorname: text(200, 'Vorname'),
			nachname: text(200, 'Nachname (bei Privatkunden Pflicht)'),
			telefon: text(50, 'Telefonnummer wie gesprochen'),
			email: text(200, 'E-Mail-Adresse'),
			strasse: text(200, 'Straße und Hausnummer'),
			plz: text(20, 'Postleitzahl'),
			ort: text(200, 'Ort')
		},
		required: ['art'],
		additionalProperties: false
	},
	auftrag_anlegen: {
		type: 'object',
		properties: {
			titel: text(200, 'Kurzer Titel der Arbeit, z. B. Badsanierung'),
			kunde: {
				type: 'object',
				properties: { name: text(200, 'Name des Kunden wie gesprochen'), ort: text(200, 'Ort, falls genannt') },
				required: ['name'],
				additionalProperties: false
			},
			objekt: text(200, 'Baustelle/Objekt, falls genannt'),
			beschreibung: text(2000, 'Weitere Angaben zur Arbeit'),
			start: ZEIT,
			ende_uhrzeit: UHRZEIT,
			mitarbeiter: { type: 'array', items: text(100, 'Vorname des Mitarbeiters'), minItems: 1, maxItems: 10 },
			quelle: text(100, 'Woher der Auftrag kam, z. B. Website, Hornbach, Empfehlung – nur wenn genannt')
		},
		required: ['titel', 'kunde'],
		additionalProperties: false
	},
	todo_anlegen: {
		type: 'object',
		properties: {
			titel: text(200, 'Was zu tun ist'),
			zustaendig: text(100, 'Mitarbeiter, der es erledigen soll'),
			faellig: ZEIT,
			auftrag: text(200, 'Auftrag bzw. Kunde, zu dem das To-do gehört'),
			wiederholung: { type: 'string', enum: ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich'], description: 'Nur bei wiederkehrenden To-dos („jede Woche“, „jährlich“)' },
			intervall: { type: 'integer', minimum: 1, maximum: 365, description: '„alle 2 Wochen“ = 2 (nur mit wiederholung)' }
		},
		required: ['titel'],
		additionalProperties: false
	},
	einsatz_anlegen: {
		type: 'object',
		properties: {
			auftrag: text(200, 'Kunde oder Auftrag, bei dem der Termin ist'),
			mitarbeiter: { type: 'array', items: text(100, 'Vorname des Mitarbeiters oder Kolonne (z. B. „Kolonne A“)'), minItems: 1, maxItems: 10 },
			start: ZEIT,
			ende_uhrzeit: UHRZEIT,
			notiz: text(500, 'Notiz zum Termin'),
			bis: { ...ZEIT, description: 'Letzter Tag bei mehrtägigen Terminen („von Montag bis Mittwoch“, „bis Freitag“) – sonst weglassen' }
		},
		required: ['auftrag', 'mitarbeiter', 'start'],
		additionalProperties: false
	},
	einsatz_verschieben: {
		type: 'object',
		properties: {
			mitarbeiter: text(100, 'Mitarbeiter des Termins'),
			auftrag: text(200, 'Kunde oder Auftrag des Termins'),
			von: ZEIT,
			nach: ZEIT_NACH
		},
		required: ['nach'],
		additionalProperties: false
	},
	angebot_entwurf: {
		type: 'object',
		properties: {
			auftrag: text(200, 'Kunde oder Auftrag, für den das Angebot ist'),
			stichworte: text(2000, 'Gesprochene Leistungen und Mengen, wörtlich')
		},
		required: ['auftrag', 'stichworte'],
		additionalProperties: false
	},
	protokoll_ausfuellen: {
		type: 'object',
		properties: {
			auftrag: {
				type: 'object',
				properties: {
					nummer: text(40, 'Auftragsnummer, z. B. A-2026-0001'),
					name: text(200, 'Kundenname oder Auftragstitel')
				},
				additionalProperties: false
			},
			typ: { type: 'string', enum: ['abnahme', 'regiebericht', 'aufmass', 'maengelliste'], description: 'Art des Baustellen-Protokolls (nur ohne vorlage)' },
			vorlage: text(200, 'Name der Protokoll-Vorlage wie gesprochen, z. B. Abdichtung oder Abnahme – bei „Protokoll … starten“'),
			inhalt: {
				type: 'object',
				properties: {
					bemerkung: text(2000, 'Bemerkung oder Beschreibung'),
					maengel: text(2000, 'Festgestellte Mängel'),
					positionen: { type: 'array', items: text(500, 'Position oder Aufmaß'), minItems: 1, maxItems: 50 }
				},
				additionalProperties: false
			}
		},
		additionalProperties: false
	},
	mitarbeiter_zuweisen: {
		type: 'object',
		properties: {
			auftrag: text(200, 'Kunde oder Auftrag'),
			mitarbeiter: { type: 'array', items: text(100, 'Vorname des Mitarbeiters'), minItems: 1, maxItems: 10 }
		},
		required: ['auftrag', 'mitarbeiter'],
		additionalProperties: false
	},
	status_aendern: {
		type: 'object',
		properties: {
			auftrag: text(200, 'Kunde oder Auftrag'),
			status: {
				type: 'string',
				enum: ['weiter', 'anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'],
				description: 'Neuer Status; „weiter“ = nächster Schritt'
			}
		},
		required: ['auftrag', 'status'],
		additionalProperties: false
	},
	todo_abhaken: {
		type: 'object',
		properties: { titel: text(200, 'Titel des To-dos wie gesprochen'), auftrag: text(200, 'Kunde oder Auftrag, falls genannt') },
		required: ['titel'],
		additionalProperties: false
	},
	anlage_anlegen: {
		type: 'object',
		properties: {
			kunde: {
				type: 'object',
				properties: { name: text(200, 'Name des Kunden wie gesprochen'), ort: text(200, 'Ort, falls genannt') },
				required: ['name'],
				additionalProperties: false
			},
			objekt: text(200, 'Objekt/Gebäude, falls genannt'),
			typ: { type: 'string', enum: ['solar', 'waermepumpe', 'gasspeicher', 'heizung', 'klima', 'lueftung', 'wallbox', 'sonstige'] },
			bezeichnung: text(200, 'Bezeichnung, z. B. Wärmepumpe Keller'),
			hersteller: text(200, 'Hersteller'),
			modell: text(200, 'Modell'),
			seriennummer: text(100, 'Seriennummer'),
			wartung: { type: 'string', enum: ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich'], description: 'Wartungsintervall' },
			wartung_intervall: { type: 'integer', minimum: 1, maximum: 365, description: '„alle 2 Jahre“ = 2' }
		},
		required: ['kunde', 'typ'],
		additionalProperties: false
	},
	nachfassen_pausieren: {
		type: 'object',
		properties: {
			angebot: text(200, 'Angebotsnummer oder Kunde'),
			fortsetzen: { type: 'boolean', description: 'true bei „fortsetzen/wieder aufnehmen“' }
		},
		required: ['angebot'],
		additionalProperties: false
	},
	abfrage_tagesplan: {
		type: 'object',
		properties: {
			wer: text(100, 'Person (Vorname) – „ich/mich“ für sich selbst; leer = ich'),
			zeitraum: { type: 'string', enum: ['heute', 'morgen', 'woche', 'datum'] },
			datum: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
			nur_ueberfaellig: { type: 'boolean', description: 'true bei „Welche To-dos sind überfällig?“' }
		},
		required: ['zeitraum'],
		additionalProperties: false
	},
	quelle_setzen: {
		type: 'object',
		properties: { auftrag: text(200, 'Kunde oder Auftrag'), quelle: text(100, 'Auftragsquelle (auch nur „Quelle“ gesagt), z. B. Hornbach, Website, Empfehlung') },
		required: ['auftrag', 'quelle'],
		additionalProperties: false
	},
	route_heute: {
		type: 'object',
		properties: { wer: text(100, 'Person (Vorname) oder Kolonne – leer = ich') },
		additionalProperties: false
	},
	abfrage_auslastung: {
		type: 'object',
		properties: {
			wer: text(100, 'Person (Vorname) oder Kolonne – leer = alle'),
			monat: { type: 'string', enum: [...MONATE_RELATIV] }
		},
		additionalProperties: false
	},
	abfrage_monatsgewinn: {
		type: 'object',
		properties: { monat: { type: 'string', enum: [...MONATE_RELATIV] } },
		additionalProperties: false
	},
	abfrage_nachfassen: { type: 'object', properties: {}, additionalProperties: false },
	unbekannt: { type: 'object', properties: {}, additionalProperties: false }
};

const BESCHREIBUNGEN: Record<WerkzeugName, string> = {
	kunde_anlegen: 'Neuen Kunden anlegen.',
	auftrag_anlegen: 'Neuen Auftrag anlegen, optional mit Startdatum und eingeplanten Mitarbeitern.',
	todo_anlegen: 'Neues To-do (Aufgabe) anlegen, optional mit Zuständigem, Fälligkeit und Auftrag.',
	einsatz_anlegen: 'Termin/Einsatz von Mitarbeitern bei einem Kunden bzw. Auftrag einplanen.',
	einsatz_verschieben: 'Bestehenden Termin/Einsatz auf einen anderen Tag oder eine andere Uhrzeit verschieben.',
	angebot_entwurf: 'Angebotsentwurf für einen Auftrag aus gesprochenen Leistungen erstellen.',
	mitarbeiter_zuweisen: 'Mitarbeiter einem Auftrag als Zuständige zuweisen.',
	status_aendern: 'Status eines Auftrags ändern (Anfrage, Angebot, Beauftragt, In Arbeit, Abgenommen, Abgerechnet) oder „weiter“.',
	todo_abhaken: 'Ein offenes To-do als erledigt abhaken.',
	anlage_anlegen: 'Eine Anlage (Wärmepumpe, Solar, Heizung, Klima, Lüftung, Wallbox, Gasspeicher …) beim Objekt eines Kunden anlegen.',
	nachfassen_pausieren: 'Automatisches Nachfassen für ein Angebot pausieren oder fortsetzen.',
	abfrage_auslastung:
		'Frage nach der Auslastung beantworten: verplante und freie Stunden je Mitarbeiter (oder alle) in diesem, letzten oder nächsten Monat („Wie ist die Auslastung?“, „Wie ausgelastet ist Murat im November?“ → monat dieser/naechster nach Bezug).',
	abfrage_monatsgewinn:
		'Frage nach Gewinn/Break-even des Monats beantworten („Wie viel Gewinn haben wir diesen Monat verplant?“, „Haben wir den Break-even erreicht?“).',
	abfrage_nachfassen: 'Frage beantworten, bei welchen Aufträgen/Angeboten das Nachfassen heute fällig oder überfällig ist („Wo muss ich nachfassen?“).',
	route_heute: 'Route mit den heutigen Terminen anzeigen („Route für heute“, „Zeig mir die Route von Ali“, „Route für Kolonne A“).',
	quelle_setzen: 'Auftragsquelle (auch „Quelle“) eines Auftrags setzen (woher der Auftrag kam: Website, Hornbach, Obi, Empfehlung, Zeitung, MyHammer, Telefon …).',
	abfrage_tagesplan:
		'Frage nach dem Tagesplan beantworten: Termine und To-dos für eine Person (ich oder Name) heute, morgen, diese Woche oder ein Datum; auch „überfällige To-dos“.',
	protokoll_ausfuellen:
		'Protokoll zu einem Auftrag: eine Protokoll-Vorlage starten („Protokoll Abdichtung für Auftrag Müller starten“ → vorlage) oder ein Baustellen-Protokoll (Abnahme, Regiebericht, Aufmaß, Mängelliste) ausfüllen (typ).',
	unbekannt: 'Für alles, was keine der anderen Aktionen ist (z. B. andere Fragen, Rechnungen, Löschen).'
};

export type Werkzeug = { type: 'function'; function: { name: string; description: string; parameters: Schema } };

/** Werkzeuge für das Function Calling (eines je Aktion + `unbekannt`). */
export function werkzeuge(): Werkzeug[] {
	return (Object.keys(AKTIONS_SCHEMAS) as WerkzeugName[]).map((name) => ({
		type: 'function',
		function: { name, description: BESCHREIBUNGEN[name], parameters: AKTIONS_SCHEMAS[name] }
	}));
}

// ---------------------------------------------------------------------------------------------------------------
// Prüfung

export class SchemaFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'SchemaFehler';
	}
}

const istObjekt = (w: unknown): w is Record<string, unknown> => w !== null && typeof w === 'object' && !Array.isArray(w);

/** Prüft `wert` gegen `schema`; wirft `SchemaFehler` mit Pfad. Liefert eine Kopie (nur bekannte Felder). */
export function pruefe(schema: Schema, wert: unknown, pfad = 'daten'): unknown {
	const fehler = (m: string) => new SchemaFehler(`${pfad}: ${m}`);
	switch (schema.type) {
		case 'object': {
			if (!istObjekt(wert)) throw fehler('Objekt erwartet');
			const props = schema.properties ?? {};
			const aus: Record<string, unknown> = {};
			for (const name of Object.keys(wert)) {
				if (!Object.hasOwn(props, name)) {
					if (schema.additionalProperties === false) throw new SchemaFehler(`${pfad}.${name}: unbekanntes Feld`);
					continue;
				}
				if (wert[name] === undefined) continue;
				aus[name] = pruefe(props[name], wert[name], `${pfad}.${name}`);
			}
			for (const name of schema.required ?? []) {
				if (!Object.hasOwn(aus, name)) throw new SchemaFehler(`${pfad}.${name}: fehlt`);
			}
			return aus;
		}
		case 'array': {
			if (!Array.isArray(wert)) throw fehler('Liste erwartet');
			if (schema.minItems !== undefined && wert.length < schema.minItems) throw fehler(`mindestens ${schema.minItems} Einträge`);
			if (schema.maxItems !== undefined && wert.length > schema.maxItems) throw fehler(`höchstens ${schema.maxItems} Einträge`);
			return wert.map((x, i) => pruefe(schema.items!, x, `${pfad}[${i}]`));
		}
		case 'string': {
			if (typeof wert !== 'string') throw fehler('Text erwartet');
			const t = wert.replaceAll('\u0000', '').trim();
			if (schema.enum && !schema.enum.includes(t)) throw fehler('unbekannter Wert');
			const laenge = [...t].length;
			if (schema.minLength !== undefined && laenge < schema.minLength) throw fehler('leer');
			if (schema.maxLength !== undefined && laenge > schema.maxLength) throw fehler(`zu lang (höchstens ${schema.maxLength})`);
			if (schema.pattern && !new RegExp(schema.pattern).test(t)) throw fehler('ungültiges Format');
			return t;
		}
		case 'number':
		case 'integer': {
			if (typeof wert !== 'number' || !Number.isFinite(wert)) throw fehler('Zahl erwartet');
			if (schema.type === 'integer' && !Number.isInteger(wert)) throw fehler('ganze Zahl erwartet');
			if (schema.minimum !== undefined && wert < schema.minimum) throw fehler('zu klein');
			if (schema.maximum !== undefined && wert > schema.maximum) throw fehler('zu groß');
			return wert;
		}
		case 'boolean':
			if (typeof wert !== 'boolean') throw fehler('true/false erwartet');
			return wert;
	}
}

/** Querbedingungen einer Zeitangabe: `wochentag` nur und immer bei tag=wochentag, `datum` (gültiger Tag) bei tag=datum. */
function pruefeZeit(z: Zeitangabe | undefined, pfad: string): void {
	if (!z) return;
	if ((z.tag === 'wochentag') !== (z.wochentag !== undefined)) throw new SchemaFehler(`${pfad}.wochentag: passt nicht zu tag`);
	if ((z.tag === 'datum') !== (z.datum !== undefined)) throw new SchemaFehler(`${pfad}.datum: passt nicht zu tag`);
	if (z.datum !== undefined && !istTag(z.datum)) throw new SchemaFehler(`${pfad}.datum: ungültiges Datum`);
}

export const istWerkzeugName = (w: unknown): w is WerkzeugName => typeof w === 'string' && Object.hasOwn(AKTIONS_SCHEMAS, w);

/** Prüft eine KI-Aktion `{ aktion, daten }` streng (keine Zusatzfelder, richtige Typen, Querbedingungen). */
export function pruefeAktion(x: unknown): KiAktion {
	if (!istObjekt(x)) throw new SchemaFehler('Aktion: Objekt erwartet');
	const extra = Object.keys(x).filter((k) => k !== 'aktion' && k !== 'daten');
	if (extra.length > 0) throw new SchemaFehler(`Aktion: unbekanntes Feld ${extra[0]}`);
	if (!istWerkzeugName(x.aktion)) throw new SchemaFehler('Aktion: unbekannte Aktion');
	if (!Object.hasOwn(x, 'daten')) throw new SchemaFehler('Aktion: daten fehlt');
	const daten = pruefe(AKTIONS_SCHEMAS[x.aktion], x.daten) as Record<string, any>;
	pruefeZeit(daten.start, 'daten.start');
	pruefeZeit(daten.faellig, 'daten.faellig');
	pruefeZeit(daten.von, 'daten.von');
	pruefeZeit(daten.nach, 'daten.nach');
	pruefeZeit(daten.bis, 'daten.bis');
	return { aktion: x.aktion, daten } as KiAktion;
}

/** Höchste Menge einer Angebotsposition (wie Plan 1c). */
const MAX_MENGE = 1_000_000;
const MAX_POSITIONEN = 200;
const PREIS_FELD = /preis|cent|euro|betrag|summe|kosten/i;

/**
 * Angebotsentwurf der KI, nachsichtig geprüft: Positionen ohne Schlüssel (Text) oder mit ungültiger Menge (keine Zahl,
 * ≤ 0, > 1 000 000) fallen weg; Mengen auf 3 Nachkommastellen gerundet; höchstens 200. Liefert die KI einen Preis
 * (Feld mit preis/cent/euro/…), wird er verworfen und die Position als unsicher („bitte prüfen“) markiert.
 */
export function pruefeEntwurf(x: unknown): KiEntwurf {
	if (!istObjekt(x) || !Array.isArray(x.positionen)) throw new SchemaFehler('Entwurf: positionen fehlt');
	const positionen: KiEntwurf['positionen'] = [];
	for (const p of x.positionen) {
		if (!istObjekt(p)) continue;
		const schluessel = typeof p.schluessel === 'string' ? p.schluessel.trim() : '';
		if (schluessel === '' || schluessel.length > 50) continue;
		if (typeof p.menge !== 'number' || !Number.isFinite(p.menge)) continue;
		const menge = Math.round(p.menge * 1000) / 1000;
		if (menge <= 0 || menge > MAX_MENGE) continue;
		const mitPreis = Object.keys(p).some((k) => PREIS_FELD.test(k));
		positionen.push({ schluessel, menge, unsicher: p.unsicher === true || mitPreis });
		if (positionen.length >= MAX_POSITIONEN) break;
	}
	return { positionen };
}

/** Werkzeug für den Angebotsentwurf (Function Calling). */
export const ENTWURF_WERKZEUG: Werkzeug = {
	type: 'function',
	function: {
		name: 'angebot_positionen',
		description: 'Positionen des Angebotsentwurfs: nur Schlüssel aus dem Leistungskatalog mit Menge.',
		parameters: {
			type: 'object',
			properties: {
				positionen: {
					type: 'array',
					maxItems: MAX_POSITIONEN,
					items: {
						type: 'object',
						properties: {
							schluessel: { type: 'string', description: 'Schlüssel der Katalogposition, z. B. K3' },
							menge: { type: 'number', description: 'Menge in der Einheit der Katalogposition' },
							unsicher: { type: 'boolean', description: 'true, wenn Position oder Menge geschätzt ist' }
						},
						required: ['schluessel', 'menge', 'unsicher'],
						additionalProperties: false
					}
				}
			},
			required: ['positionen'],
			additionalProperties: false
		}
	}
};
