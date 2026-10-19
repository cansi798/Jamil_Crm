/**
 * Anlagen an Objekten (Wunsch Jamil, msgs 2503/2505): Typen und ihre Zusatzfelder.
 *
 * Gemeinsame Felder (Hersteller, Modell, Seriennummer …) sind eigene Spalten; was nur für einen Typ sinnvoll ist
 * (z. B. kWp bei Solar, Kältemittel bei Klima), steht in `anlagen.extra` (jsonb). Diese Definition ist die einzige
 * Quelle: Formular, Prüfung auf dem Server und Anzeige lesen alle von hier.
 */

export const ANLAGEN_TYPEN = ['solar', 'waermepumpe', 'gasspeicher', 'heizung', 'klima', 'lueftung', 'wallbox', 'sonstige'] as const;
export type AnlagenTyp = (typeof ANLAGEN_TYPEN)[number];

export const TYP_NAMEN: Record<AnlagenTyp, string> = {
	solar: 'Solar / PV',
	waermepumpe: 'Wärmepumpe',
	gasspeicher: 'Gasspeicher',
	heizung: 'Heizung',
	klima: 'Klima',
	lueftung: 'Lüftung',
	wallbox: 'Wallbox',
	sonstige: 'Sonstige'
};

export const istAnlagenTyp = (w: unknown): w is AnlagenTyp => typeof w === 'string' && (ANLAGEN_TYPEN as readonly string[]).includes(w);

export type ExtraFeld =
	| { key: string; name: string; art: 'text'; max?: number }
	| { key: string; name: string; art: 'zahl'; einheit?: string; max?: number; ganz?: boolean }
	| { key: string; name: string; art: 'datum' }
	| { key: string; name: string; art: 'auswahl'; optionen: [string, string][] };

const KAELTEMITTEL: ExtraFeld = { key: 'kaeltemittel', name: 'Kältemittel', art: 'text', max: 50 };

export const EXTRA_FELDER: Record<AnlagenTyp, ExtraFeld[]> = {
	solar: [
		{ key: 'leistung_kwp', name: 'Leistung', art: 'zahl', einheit: 'kWp', max: 10000 },
		{ key: 'module', name: 'Anzahl Module', art: 'zahl', ganz: true, max: 100000 },
		{ key: 'wechselrichter', name: 'Wechselrichter', art: 'text' },
		{ key: 'speicher_kwh', name: 'Batteriespeicher', art: 'zahl', einheit: 'kWh', max: 10000 }
	],
	waermepumpe: [
		{
			key: 'bauart',
			name: 'Bauart',
			art: 'auswahl',
			optionen: [
				['luft_wasser', 'Luft/Wasser'],
				['sole_wasser', 'Sole/Wasser'],
				['wasser_wasser', 'Wasser/Wasser'],
				['luft_luft', 'Luft/Luft']
			]
		},
		{ key: 'leistung_kw', name: 'Heizleistung', art: 'zahl', einheit: 'kW', max: 10000 },
		KAELTEMITTEL
	],
	gasspeicher: [
		{ key: 'volumen_l', name: 'Volumen', art: 'zahl', einheit: 'l', ganz: true, max: 1000000 },
		{
			key: 'gasart',
			name: 'Gasart',
			art: 'auswahl',
			optionen: [
				['fluessiggas', 'Flüssiggas'],
				['erdgas', 'Erdgas'],
				['sonstiges', 'Sonstiges']
			]
		},
		{ key: 'pruefung_bis', name: 'Nächste Prüfung', art: 'datum' }
	],
	heizung: [
		{
			key: 'energie',
			name: 'Energieträger',
			art: 'auswahl',
			optionen: [
				['gas', 'Gas'],
				['oel', 'Öl'],
				['pellet', 'Pellet/Holz'],
				['fernwaerme', 'Fernwärme'],
				['strom', 'Strom'],
				['sonstiges', 'Sonstiges']
			]
		},
		{ key: 'leistung_kw', name: 'Leistung', art: 'zahl', einheit: 'kW', max: 10000 },
		{ key: 'brenner', name: 'Brenner/Kessel', art: 'text' }
	],
	klima: [
		{ key: 'leistung_kw', name: 'Kälteleistung', art: 'zahl', einheit: 'kW', max: 10000 },
		KAELTEMITTEL,
		{ key: 'fuellmenge_kg', name: 'Füllmenge', art: 'zahl', einheit: 'kg', max: 10000 }
	],
	lueftung: [
		{
			key: 'bauart',
			name: 'Bauart',
			art: 'auswahl',
			optionen: [
				['zentral', 'zentral'],
				['dezentral', 'dezentral']
			]
		},
		{ key: 'luftmenge', name: 'Luftmenge', art: 'zahl', einheit: 'm³/h', max: 1000000 },
		{ key: 'filter', name: 'Filterklasse', art: 'text', max: 50 }
	],
	wallbox: [
		{ key: 'leistung_kw', name: 'Ladeleistung', art: 'zahl', einheit: 'kW', max: 1000 },
		{ key: 'anschluss', name: 'Anschluss', art: 'text', max: 50 },
		{ key: 'zaehler', name: 'Zähler/Messung', art: 'text', max: 100 }
	],
	sonstige: []
};

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const zahlFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export type Extra = Record<string, string | number>;

/** Prüft die Zusatzfelder eines Typs; fremde Schlüssel fallen weg, leere auch. Fehler als `Error` (deutsch). */
export function pruefeExtra(typ: AnlagenTyp, roh: Record<string, unknown>): Extra {
	const aus: Extra = {};
	for (const f of EXTRA_FELDER[typ]) {
		const w = roh[f.key];
		if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) continue;
		if (f.art === 'zahl') {
			const n = typeof w === 'number' ? w : typeof w === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(w) ? Number(w.trim().replace(',', '.')) : NaN;
			if (!Number.isFinite(n) || n < 0 || n > (f.max ?? 1e6) || (f.ganz && !Number.isInteger(n))) {
				throw new Error(`${f.name}: Bitte eine ${f.ganz ? 'ganze ' : ''}Zahl von 0 bis ${zahlFormat.format(f.max ?? 1e6)} eingeben.`);
			}
			aus[f.key] = n;
			continue;
		}
		if (typeof w !== 'string') throw new Error(`${f.name}: Bitte einen Text eingeben.`);
		const t = w.trim();
		if (f.art === 'datum') {
			if (!TAG.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw new Error(`${f.name}: Bitte ein gültiges Datum wählen.`);
		} else if (f.art === 'auswahl') {
			if (!f.optionen.some(([k]) => k === t)) throw new Error(`${f.name}: Bitte einen Eintrag aus der Liste wählen.`);
		} else {
			if (t.includes('\u0000')) throw new Error(`${f.name} enthält ungültige Zeichen.`);
			if ([...t].length > (f.max ?? 200)) throw new Error(`${f.name} ist zu lang (höchstens ${f.max ?? 200} Zeichen).`);
		}
		aus[f.key] = t;
	}
	return aus;
}

/** Alle Formularfelder `extra_<key>` als Rohwerte (Prüfung danach mit `pruefeExtra`). */
export function extraAusFormular(f: FormData): Record<string, string> {
	const aus: Record<string, string> = {};
	for (const [k, v] of f.entries()) if (k.startsWith('extra_') && typeof v === 'string') aus[k.slice(6)] = v;
	return aus;
}

const deutsch = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;

/** Zusatzfelder für die Anzeige: Name + formatierter Wert (in der Reihenfolge der Definition). */
export function extraAnzeige(typ: AnlagenTyp, extra: Extra): { name: string; wert: string }[] {
	const aus: { name: string; wert: string }[] = [];
	for (const f of EXTRA_FELDER[typ]) {
		const w = extra[f.key];
		if (w === undefined || w === null || w === '') continue;
		let wert = String(w);
		if (f.art === 'zahl' && typeof w === 'number') wert = `${zahlFormat.format(w)}${f.einheit ? ` ${f.einheit}` : ''}`;
		if (f.art === 'auswahl') wert = f.optionen.find(([k]) => k === w)?.[1] ?? wert;
		if (f.art === 'datum') wert = deutsch(String(w));
		aus.push({ name: f.name, wert });
	}
	return aus;
}
