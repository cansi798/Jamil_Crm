import {
	pruefeAktion,
	pruefeEntwurf,
	WOCHENTAGE,
	type KiAktion,
	type KiEntwurf,
	type Wochentag,
	type Zeitangabe
} from '../sprache/aktionen';
import type { EntwurfEingabe, KiAnbieter, KiKontext } from './anbieter';

/**
 * Regelbasierte Ersatz-KI für Tests und für den Betrieb ohne Mistral-Schlüssel. Sie versteht die typischen
 * Formulierungen des Testsatzes (`tests/sprache/befehle.json`): Absicht über Schlüsselwörter, Namen über die
 * Satzstellung („bei Müller“, „mit Ali und Mehmet“, „für Murat:“), Zeiten als relative Angabe. Kein Netz, keine
 * Datenbank – liefert dasselbe Format wie die echte KI und wird genauso streng geprüft.
 */
export class FakeKi implements KiAnbieter {
	readonly name = 'fake' as const;
	/** Anzahl der Aufrufe (für Tests: „keine KI-Anfrage“). */
	aufrufe = 0;
	entwurfAufrufe = 0;
	/** Letzte Eingabe des Angebotsentwurfs (für Tests: „Katalog ohne Preise“). */
	letzterEntwurf: EntwurfEingabe | null = null;

	async aktionAusText(text: string, kontext: KiKontext): Promise<KiAktion> {
		this.aufrufe++;
		return pruefeAktion(deute(text, kontext));
	}

	async angebotsEntwurf(eingabe: EntwurfEingabe): Promise<KiEntwurf> {
		this.aufrufe++;
		this.entwurfAufrufe++;
		this.letzterEntwurf = eingabe;
		return pruefeEntwurf(entwirf(eingabe));
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Zahlen und Zeiten

const ZAHLWOERTER: Record<string, number> = {
	null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
	sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15,
	sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, einundzwanzig: 21, zweiundzwanzig: 22,
	dreiundzwanzig: 23, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, achtzig: 80, hundert: 100
};
const ZAHLWORT = Object.keys(ZAHLWOERTER).sort((a, b) => b.length - a.length).join('|');

function zahl(w: string | undefined): number | null {
	if (w === undefined) return null;
	const t = w.toLowerCase().replace(',', '.');
	if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
	return Object.hasOwn(ZAHLWOERTER, t) ? ZAHLWOERTER[t] : null;
}

const zwei = (n: number) => String(n).padStart(2, '0');
const uhr = (h: number, m = 0): string | undefined =>
	Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59 ? `${zwei(h)}:${zwei(m)}` : undefined;

const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

/** Alle Uhrzeiten im Text (in Reihenfolge), z. B. „um 8 Uhr“, „14:30“, „halb neun“, „Viertel nach acht“. */
export function findeUhrzeiten(s: string): { uhrzeit: string; index: number }[] {
	const l = s.toLowerCase();
	const treffer: { uhrzeit: string; index: number; ende: number }[] = [];
	const nimm = (re: RegExp, f: (m: RegExpExecArray) => string | undefined) => {
		for (const m of l.matchAll(re)) {
			const u = f(m as RegExpExecArray);
			if (!u) continue;
			const index = m.index ?? 0;
			if (treffer.some((t) => index < t.ende && t.index < index + m[0].length)) continue;
			treffer.push({ uhrzeit: u, index, ende: index + m[0].length });
		}
	};
	nimm(new RegExp(`\\bhalb\\s+(\\d{1,2}|${ZAHLWORT})\\b`, 'g'), (m) => {
		const h = zahl(m[1]);
		return h === null ? undefined : uhr((h + 23) % 24, 30);
	});
	nimm(new RegExp(`\\bviertel\\s+(nach|vor)\\s+(\\d{1,2}|${ZAHLWORT})\\b`, 'g'), (m) => {
		const h = zahl(m[2]);
		if (h === null) return undefined;
		return m[1] === 'nach' ? uhr(h, 15) : uhr((h + 23) % 24, 45);
	});
	nimm(/\b(\d{1,2})[:.](\d{2})\s*(?:uhr\b)?/g, (m) => uhr(Number(m[1]), Number(m[2])));
	nimm(new RegExp(`\\b(\\d{1,2}|${ZAHLWORT})\\s+uhr(?:\\s+(\\d{1,2}|${ZAHLWORT})\\b)?`, 'g'), (m) => {
		const h = zahl(m[1]);
		const min = m[2] ? zahl(m[2]) : 0;
		return h === null || min === null ? undefined : uhr(h, min);
	});
	nimm(new RegExp(`\\b(?:um|ab|bis|von)\\s+(\\d{1,2}|${ZAHLWORT})\\b(?!\\s*(?:[.:]\\d|m\\b|meter|quadrat|stück|tage))`, 'g'), (m) => {
		const h = zahl(m[1]);
		return h === null ? undefined : uhr(h);
	});
	return treffer.sort((a, b) => a.index - b.index).map(({ uhrzeit, index }) => ({ uhrzeit, index }));
}

/** Tag im Text: übermorgen/morgen/heute, Wochentag, Datum („23.10.“, „23. Oktober“). */
export function findeTag(s: string, kontext: KiKontext): Omit<Zeitangabe, 'uhrzeit'> | undefined {
	const l = s.toLowerCase();
	if (/(?<!\p{L})übermorgen(?!\p{L})/u.test(l)) return { tag: 'uebermorgen' };
	if (/\bmorgen\b/.test(l)) return { tag: 'morgen' };
	if (/\bheute\b/.test(l)) return { tag: 'heute' };
	const w = new RegExp(`\\b(${WOCHENTAGE.join('|')})s?\\b`).exec(l);
	if (w) return { tag: 'wochentag', wochentag: w[1] as Wochentag };
	const jahrHeute = Number(kontext.heute.slice(0, 4));
	const datum = (t: number, m: number, j?: number) => {
		if (!(m >= 1 && m <= 12 && t >= 1 && t <= 31)) return undefined;
		let jahr = j === undefined ? jahrHeute : j < 100 ? 2000 + j : j;
		let d = `${jahr}-${zwei(m)}-${zwei(t)}`;
		if (j === undefined && d < kontext.heute) d = `${++jahr}-${zwei(m)}-${zwei(t)}`;
		return { tag: 'datum' as const, datum: d };
	};
	const zahlDatum = /\b(\d{1,2})\.\s?(\d{1,2})\.?(?:\s?(\d{2}|\d{4})\b)?/.exec(l);
	if (zahlDatum) return datum(Number(zahlDatum[1]), Number(zahlDatum[2]), zahlDatum[3] ? Number(zahlDatum[3]) : undefined);
	const wortDatum = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONATE.join('|')})\\b(?:\\s+(\\d{4}))?`).exec(l);
	if (wortDatum) return datum(Number(wortDatum[1]), MONATE.indexOf(wortDatum[2]) + 1, wortDatum[3] ? Number(wortDatum[3]) : undefined);
	return undefined;
}

function zeitangabe(s: string, kontext: KiKontext): Zeitangabe | undefined {
	const tag = findeTag(s, kontext);
	const uhrzeiten = findeUhrzeiten(s);
	if (!tag && uhrzeiten.length === 0) return undefined;
	return { ...(tag ?? { tag: 'heute' }), ...(uhrzeiten[0] ? { uhrzeit: uhrzeiten[0].uhrzeit } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Namen

const WOCHENTAG_WORT = new RegExp(`^(${WOCHENTAGE.join('|')})s?$`, 'i');
/** Wörter, die nie ein Name sind (Satzbausteine, Zeitwörter, typische Befehlsverben). */
const KEIN_NAME = new Set(
	[
		'neuer', 'neue', 'neuen', 'neues', 'auftrag', 'kunde', 'kunden', 'kundin', 'termin', 'einsatz', 'todo', 'aufgabe',
		'heute', 'morgen', 'übermorgen', 'uhr', 'und', 'mit', 'bei', 'für', 'am', 'um', 'ab', 'bis', 'von', 'auf', 'in', 'aus',
		'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'bitte', 'mich', 'mir', 'ich', 'familie', 'firma',
		'herr', 'herrn', 'frau', 'angebot', 'plane', 'planen', 'lege', 'leg', 'erstelle', 'erstell', 'verschiebe', 'verschieb',
		'nächsten', 'nächste', 'kommenden', 'diesen', 'halb', 'viertel', 'baustelle', 'objekt', 'soll', 'muss', 'sollen'
	]
);

const istNamensWort = (w: string) =>
	/^[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?$/.test(w) && !KEIN_NAME.has(w.toLowerCase()) && !WOCHENTAG_WORT.test(w);

/** „Ali und Mehmet“, „Ali, Mehmet und Murat“ → Namen (nur wenn ALLE Teile wie Namen aussehen). */
function namensListe(s: string): string[] | null {
	const teile = s
		.trim()
		.split(/\s*,\s*|\s+und\s+|\s+sowie\s+/)
		.map((t) => t.trim())
		.filter(Boolean);
	if (teile.length === 0) return null;
	const namen = teile;
	return namen.every((n) => n.split(/\s+/).length <= 2 && n.split(/\s+/).every(istNamensWort)) ? namen : null;
}

/** Text bis zu einem Satzzeichen oder einem Signalwort (Zeit-, Personen-, Ortsangabe). */
function bisGrenze(s: string): string {
	const grenze = new RegExp(
		`\\s*(?:[,:;.!?]|\\s(?:mit|um|ab|bis|am|von|auf|für|morgen|übermorgen|heute|nächsten|kommenden|${WOCHENTAGE.join('|')}|ein|einplanen|verschieben|verlegen|anlegen|eintragen|erneuern)\\b)`,
		'i'
	);
	const m = grenze.exec(s);
	return (m ? s.slice(0, m.index) : s).trim();
}

/** Kunde nach „bei“, „für Kunde/Familie/Firma/Herrn/Frau“, „Kunde“; mit Ort („in Norderstedt“). */
function findeKunde(t: string, auchFuer: boolean): { name: string; ort?: string; rest: string } | null {
	const muster: RegExp[] = [
		/\b(?:bei|für)\s+(?:dem\s+|der\s+)?(?:kunden?|kundin)\s+(.+)/i,
		/\b(?:bei|für)\s+(?:familie|firma)\s+(.+)/i,
		/\b(?:bei|für)\s+(herrn?|frau)\s+(.+)/i,
		/\bkunden?\s+(.+)/i,
		/\bbei\s+(.+)/i
	];
	if (auchFuer) muster.push(/\bfür\s+(.+)/i);
	for (const re of muster) {
		const m = re.exec(t);
		if (!m) continue;
		const rohRest = m[m.length - 1];
		const mitOrt = /^(.+?)\s+(?:in|aus)\s+([A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(bisGrenzeOhneOrt(rohRest));
		let name = bisGrenze(rohRest);
		let ort: string | undefined;
		if (mitOrt) {
			name = mitOrt[1].trim();
			ort = mitOrt[2].trim();
		}
		name = name.replace(/^(?:dem|der|den|die)\s+/i, '').trim();
		if (/^(herrn?|frau)$/i.test(m[1] ?? '') && m.length > 2) name = name.trim();
		if (name === '' || WOCHENTAG_WORT.test(name) || !/^[A-ZÄÖÜ]/.test(name)) continue;
		if (name.split(/\s+/).length > 4) continue;
		return { name, ort, rest: t.replace(m[0], ' ') };
	}
	return null;
}

/** Wie bisGrenze, aber „in/aus“ beenden den Namen nicht (für „Müller in Norderstedt“). */
function bisGrenzeOhneOrt(s: string): string {
	const m = /\s*(?:[,:;.!?]|\s(?:mit|um|ab|bis|am|von|auf|für|morgen|übermorgen|heute|nächsten|kommenden|ein|einplanen|verschieben|verlegen)\b)/i.exec(s);
	return (m ? s.slice(0, m.index) : s).trim();
}

/** Mitarbeiter: „mit Ali und Mehmet“ (oder eine Aufzählung aus reinen Namen zwischen Kommas). */
function findeMitarbeiter(t: string): { namen: string[]; rest: string } | null {
	const mit = /\bmit\s+((?:[A-ZÄÖÜ][\wäöüß-]+)(?:(?:\s*,\s*|\s+und\s+)[A-ZÄÖÜ][\wäöüß-]+)*)/.exec(t);
	if (mit) {
		const namen = namensListe(mit[1]);
		if (namen) return { namen, rest: t.replace(mit[0], ' ') };
	}
	for (const segment of t.split(/[,:]/)) {
		const namen = namensListe(segment);
		if (namen && /\bund\b/.test(segment)) return { namen, rest: t.replace(segment, ' ') };
	}
	return null;
}

const sauber = (s: string) =>
	s
		.replace(/\s+/g, ' ')
		.replace(/^[\s,:;.\-–]+|[\s,:;.!?\-–]+$/g, '')
		.trim();

const grossAnfang = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Entfernt Zeit- und Datumsangaben (für Titel). */
function ohneZeit(s: string): string {
	return s
		.replace(new RegExp(`\\b(?:ab|am|bis|für|zum|nächsten|kommenden|diesen)?\\s*(?:${WOCHENTAGE.join('|')})s?\\b`, 'gi'), ' ')
		.replace(/(?:\b(?:ab|bis|für)\s+)?(?<!\p{L})(?:übermorgen|morgen|heute)(?!\p{L})/giu, ' ')
		.replace(/\b(?:am|ab|bis)?\s*\d{1,2}\.\s?\d{1,2}\.(?:\d{2,4})?/g, ' ')
		.replace(new RegExp(`\\b(?:um|ab|bis|von)?\\s*(?:halb|viertel\\s+(?:nach|vor))?\\s*(?:\\d{1,2}(?:[:.]\\d{2})?|${ZAHLWORT})\\s+uhr\\b(?:\\s+\\d{1,2})?`, 'gi'), ' ')
		.replace(/\b(?:um|ab|bis)\s+\d{1,2}(?::\d{2})?\b/gi, ' ');
}

// ---------------------------------------------------------------------------------------------------------------
// Absichten

function bereinige(text: string): string {
	return text
		.replace(/\bto[\s-]?do['’]?s?\b/gi, 'Todo')
		.replace(/[„“”"]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[.!?]+$/, '');
}

export function deute(text: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const t = bereinige(text);
	const l = t.toLowerCase();
	if (/\broute\b/.test(l)) {
		const kolonne = /\bkolonne\s+([A-ZÄÖÜ0-9][\wäöüß-]*)/i.exec(t);
		const person = /\b(?:von|für|fuer)\s+(?!heute|mich|morgen)([A-ZÄÖÜ][\wäöüß-]+)/.exec(t);
		const wer = kolonne ? `Kolonne ${kolonne[1]}` : person && istNamensWort(person[1]) ? person[1] : undefined;
		return { aktion: 'route_heute', daten: wer ? { wer } : {} };
	}
	if (istFrage(text, l)) return abfrage(t, kontext);
	if (/\bnachfass/.test(l)) return nachfassen(t);
	if (/\b(?:hake|hak|abhaken|abgehakt)\b|\b(?:ist|sind|als)\s+(?:jetzt\s+)?(?:erledigt|abgehakt)\b|\berledigt\s*$/.test(l) && !/\b(?:soll|muss|bis)\b/.test(l)) {
		return abhaken(t);
	}
	if (/\bauftrag/.test(l) && (/\bquelle\b/.test(l) || /\b(?:kam|kommt)\s+(?:über|von|via)\b/.test(l)) && !/\b(?:neue[nrs]?|anlegen|lege|leg)\b/.test(l)) {
		return quelleSetzen(t);
	}
	if (/\bauftrag/.test(l) && /\b(?:weise|zuweisen|zuteilen|zuordnen|ordne)\b|\bteile?\b.*\bzu\s*$/.test(l)) return zuweisen(t);
	if (/\bauftrag/.test(l) && !/\b(?:neue[nrs]?|anlegen|lege|leg)\b/.test(l) && (/\bstatus\b|\bweiter\b/.test(l) || STATUS_WOERTER.some(([re]) => re.test(l)))) {
		return status(t);
	}
	if (ANLAGE_WORT.test(l) && /\b(?:neue[nrs]?|anlegen|lege|leg|erfasse|aufnehmen|eintragen)\b/.test(l) && !/\btodo\b/.test(l)) return anlage(t);
	if (/\b(verschieb|verleg|umleg|schieb)/.test(l)) return verschieben(t, kontext);
	if (/\btodo\b|\baufgabe\b|\berinner|\bsoll\b|\bmuss\b/.test(l)) return todo(t, kontext);
	if (/\bangebot/.test(l)) return angebot(t);
	if (/(protokoll|regiebericht|aufma[ßs]|mängelliste|maengelliste)(?!\p{L})/u.test(l) || (/\babnahme\b/.test(l) && /\b(protokoll|ausfüllen|erstellen|schreiben|füllen)\b/.test(l))) return protokoll(t);
	if (/\b(kunde|kundin|kunden)\b/.test(l) && /\b(neue[nrs]?|anlegen|lege|leg|erfasse|aufnehmen)\b/.test(l) && !/\bauftrag/.test(l)) {
		return kunde(t);
	}
	if (/\bauftrag/.test(l)) return auftrag(t, kontext);
	if (/\b(termin|einsatz|einplanen|einteilen)\b|\bplane?\b.*\bein\b|\bteile?\b.*\bein\b|\bkolonne\b.*\b(?:bei|für)\b/.test(l)) return einsatz(t, kontext);
	return { aktion: 'unbekannt', daten: {} };
}


// ——— Neue Aktionen (Wunsch Jamil msgs 2645/2647) ———

const ANLAGE_WORT = /\b(anlage|wärmepumpe|waermepumpe|solaranlage|pv-anlage|photovoltaik|solar|wallbox|klimaanlage|klimagerät|lüftung|lüftungsanlage|heizung|gasspeicher|gastank|flüssiggastank)\b/;
const ANLAGE_TYP: [RegExp, string][] = [
	[/wärmepumpe|waermepumpe/, 'waermepumpe'],
	[/solar|pv-anlage|photovoltaik/, 'solar'],
	[/wallbox/, 'wallbox'],
	[/klima/, 'klima'],
	[/lüftung/, 'lueftung'],
	[/gasspeicher|gastank|flüssiggastank/, 'gasspeicher'],
	[/heizung/, 'heizung']
];
const STATUS_WOERTER: [RegExp, string][] = [
	[/\bin\s+arbeit\b/, 'in_arbeit'],
	[/\bbeauftragt\b/, 'beauftragt'],
	[/\babgenommen\b/, 'abgenommen'],
	[/\babgerechnet\b/, 'abgerechnet'],
	[/\bauf\s+angebot\b/, 'angebot'],
	[/\bauf\s+anfrage\b/, 'anfrage']
];

/** „alle 2 Wochen“, „jährlich“, „jeden Monat“ … → Regel + Intervall (und der Text ohne diese Angabe). */
function wiederholungAus(s: string): { regel: string; intervall: number; rest: string } | null {
	const regeln: [RegExp, (m: RegExpExecArray) => [string, number]][] = [
		[new RegExp(`\\balle\\s+(\\d+|${ZAHLWORT})\\s+(tage|wochen|monate|jahre)\\b`, 'i'), (m) => [
			{ tage: 'taeglich', wochen: 'woechentlich', monate: 'monatlich', jahre: 'jaehrlich' }[m[2].toLowerCase() as 'tage'],
			zahl(m[1]) ?? 1
		]],
		[/\b(?:halbjährlich|halbjaehrlich|alle\s+halbe\s+jahr)\b/i, () => ['monatlich', 6]],
		[/\b(?:vierteljährlich|quartalsweise)\b/i, () => ['monatlich', 3]],
		[/\b(?:täglich|jeden\s+tag)\b/i, () => ['taeglich', 1]],
		[/\b(?:wöchentlich|jede\s+woche)\b/i, () => ['woechentlich', 1]],
		[/\b(?:monatlich|jeden\s+monat)\b/i, () => ['monatlich', 1]],
		[/\b(?:jährlich|jaehrlich|jedes\s+jahr|einmal\s+im\s+jahr)\b/i, () => ['jaehrlich', 1]]
	];
	for (const [re, f] of regeln) {
		const m = re.exec(s);
		if (m) {
			const [regel, intervall] = f(m);
			return { regel, intervall: Math.max(1, Math.min(365, intervall)), rest: s.replace(m[0], ' ') };
		}
	}
	return null;
}

function istFrage(original: string, l: string): boolean {
	return (
		(/\?\s*$/.test(original) || /^(?:was|welche[rs]?|wie\s?viele|habe\s+ich|hab\s+ich|hat\s+\w+)\b/.test(l)) &&
		/\b(an|steht|stehen|hat|habe|hab|termine?|todos?|überfällig|plan|vor|los)\b/.test(l)
	);
}

function abfrage(t: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const l = t.toLowerCase();
	const daten: Record<string, unknown> = {};
	if (/überfällig|ueberfaellig/.test(l)) daten.nur_ueberfaellig = true;
	const tag = findeTag(t, kontext);
	if (/\b(?:diese[rn]?\s+|die\s+|ganze[rn]?\s+)?woche\b/.test(l)) daten.zeitraum = 'woche';
	else if (tag?.tag === 'morgen') daten.zeitraum = 'morgen';
	else if (tag?.tag === 'datum') {
		daten.zeitraum = 'datum';
		daten.datum = tag.datum;
	} else daten.zeitraum = 'heute';
	const kolonne = /\bkolonne\s+(\w+)/i.exec(t);
	const wer =
		kolonne?.[0] ??
		/\bwas\s+(?:hat|macht|habe?n?)\s+([A-ZÄÖÜ][\wäöüß-]+)/.exec(t)?.[1] ??
		/\b(?:für|bei|von)\s+([A-ZÄÖÜ][\wäöüß-]+)\b/.exec(t)?.[1] ??
		/\b(?:hat|haben)\s+([A-ZÄÖÜ][\wäöüß-]+)\b/.exec(t)?.[1];
	if (wer && !/^(ich|mich|mir|mein)$/i.test(wer) && (kolonne || istNamensWort(wer))) daten.wer = wer;
	return { aktion: 'abfrage_tagesplan', daten };
}

function nachfassen(t: string): { aktion: string; daten: Record<string, unknown> } {
	const nr = /\b(?:AN-?)?(\d{4}-\d{3,})\b/i.exec(t);
	const kunde = /\b(?:bei|für|von)\s+(?:(?:dem\s+)?angebot\s+)?(?:kunden?\s+|familie\s+|firma\s+|herrn?\s+|frau\s+)?([A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(t);
	const angebot = nr ? `AN-${nr[1]}` : kunde ? kunde[1] : sauber(t.replace(/\bnachfass\w*\b|\b(?:pausier\w*|stopp\w*|anhalten|fortsetz\w*|aufnehm\w*|wieder|für|das|angebot)\b/gi, ' ')) || '?';
	const daten: Record<string, unknown> = { angebot };
	if (/fortsetz|wieder|aufnehm|aktivier|weiterlaufen/i.test(t)) daten.fortsetzen = true;
	return { aktion: 'nachfassen_pausieren', daten };
}

function abhaken(t: string): { aktion: string; daten: Record<string, unknown> } {
	let rest = t;
	const daten: Record<string, unknown> = {};
	const auftrag = /\b(?:beim|bei|im|zum|vom)\s+auftrag\s+(.+)$/i.exec(rest);
	if (auftrag) {
		daten.auftrag = sauber(auftrag[1]);
		rest = rest.replace(auftrag[0], ' ');
	}
	rest = rest
		.replace(/^\s*(?:bitte\s+)?(?:hake|hak)\s+(?:mal\s+)?(?:das|die|den)?\s*/i, '')
		.replace(/^\s*(?:das|die)?\s*(?:todo|aufgabe)\s*:?\s*/i, '')
		.replace(/\s+(?:ab|abhaken)\s*$/i, '')
		.replace(/\s+(?:ist|sind|als)\s+(?:jetzt\s+)?(?:erledigt|fertig|abgehakt)\b.*$/i, '')
		.replace(/\s+erledigt\s*$/i, '')
		.replace(/^\s*(?:das|die)?\s*(?:todo|aufgabe)\s*:?\s*/i, '');
	daten.titel = sauber(rest) || '?';
	return { aktion: 'todo_abhaken', daten };
}

function zuweisen(t: string): { aktion: string; daten: Record<string, unknown> } {
	const a = /\b(?:dem|den|zum|zu\s+dem|für\s+den|beim)?\s*auftrag\s+(.+?)(?:\s+zu(?:weisen|teilen|ordnen)?)?\s*$/i.exec(t);
	const auftrag = a ? sauber(a[1].replace(/\s+zu$/i, '')) : '?';
	const vor = a ? t.slice(0, a.index) : t;
	const namenText = vor.replace(/^\s*(?:bitte\s+)?(?:weise|teile|ordne)\s+/i, '').replace(/\b(?:dem|den|zum)\s*$/i, '').trim();
	const kolonne = /\bkolonne\s+([A-ZÄÖÜ0-9][\wäöüß-]*)/i.exec(namenText);
	const ohneKolonne = kolonne ? namenText.replace(kolonne[0], ' ').replace(/^\s*(?:und|,)\s*|\s*(?:und|,)\s*$/g, '').trim() : namenText;
	const personen = ohneKolonne ? (namensListe(ohneKolonne) ?? ohneKolonne.split(/\s*,\s*|\s+und\s+/).map(sauber).filter((n) => istNamensWort(n))) : [];
	const namen = [...(kolonne ? [`Kolonne ${kolonne[1]}`] : []), ...personen];
	return { aktion: 'mitarbeiter_zuweisen', daten: { auftrag, mitarbeiter: namen.length ? namen : ['?'] } };
}

/** „über Hornbach“, „Quelle Website“, „kam über eine Empfehlung“ → Quellen-Name; sonst null. */
function quelleAus(t: string): { quelle: string; rest: string } | null {
	const m =
		/\bquelle\s*(?:ist|war|:)?\s+(?:die\s+|der\s+|das\s+)?([A-ZÄÖÜa-zäöüß][\wäöüß-]+)/i.exec(t) ??
		/\b(?:kam|kommt|kamen)\s+(?:über|von|via)\s+(?:die\s+|den\s+|das\s+|eine\s+|einen\s+)?([A-ZÄÖÜa-zäöüß][\wäöüß-]+)/i.exec(t) ??
		/\b(?:über|via)\s+(?:die\s+|den\s+|eine\s+)?(Website|Webseite|Hornbach|Obi|Empfehlung|Zeitung|MyHammer|Telefon)\b/i.exec(t);
	if (!m) return null;
	const roh = m[1];
	const quelle = /^webseite$/i.test(roh) ? 'Website' : roh[0].toUpperCase() + roh.slice(1);
	return { quelle, rest: t.replace(m[0], ' ') };
}

function quelleSetzen(t: string): { aktion: string; daten: Record<string, unknown> } {
	const auf = /\bauf\s+(?:die\s+|den\s+)?([A-ZÄÖÜa-zäöüß][\wäöüß-]+)\s*$/i.exec(t);
	const q = auf ? { quelle: auf[1][0].toUpperCase() + auf[1].slice(1) } : quelleAus(t);
	const a = /\bauftrag(?:s)?\s+(.+?)(?=\s+(?:auf|kam|kommt|ist|hat|setzen|quelle)\b|$)/i.exec(t);
	return { aktion: 'quelle_setzen', daten: { auftrag: a ? sauber(a[1]) : '?', quelle: q?.quelle ?? '?' } };
}

function status(t: string): { aktion: string; daten: Record<string, unknown> } {
	const l = t.toLowerCase();
	let ziel = 'weiter';
	for (const [re, s] of STATUS_WOERTER) if (re.test(l)) ziel = s;
	const a = /\bauftrag(?:s)?\s+(.+?)(?=\s+(?:auf|ist|weiter|nach|setzen|schalten|als)\b|$)/i.exec(t);
	return { aktion: 'status_aendern', daten: { auftrag: a ? sauber(a[1]) : '?', status: ziel } };
}

function anlage(t: string): { aktion: string; daten: Record<string, unknown> } {
	const l = t.toLowerCase();
	const daten: Record<string, unknown> = { typ: 'sonstige' };
	for (const [re, typ] of ANLAGE_TYP) {
		if (re.test(l)) {
			daten.typ = typ;
			break;
		}
	}
	const w = wiederholungAus(t.replace(/\bwartung\s+/i, ''));
	if (w && /\bwartung|\bwarten\b/i.test(t)) {
		daten.wartung = w.regel;
		if (w.intervall > 1) daten.wartung_intervall = w.intervall;
	}
	const hersteller = /\b(?:hersteller|marke)\s+([A-ZÄÖÜ][\wäöüß-]+)/i.exec(t);
	if (hersteller) daten.hersteller = hersteller[1];
	const modell = /\bmodell\s+([^,]+?)(?=,|\s+(?:bei|für|wartung|seriennummer)\b|$)/i.exec(t);
	if (modell) daten.modell = sauber(modell[1]);
	const sn = /\bseriennummer\s+([\w-]+)/i.exec(t);
	if (sn) daten.seriennummer = sn[1];
	const k = findeKunde(t.replace(/\b(?:hersteller|marke|modell|seriennummer|wartung)\b.*$/i, ''), true);
	daten.kunde = k ? { name: k.name, ...(k.ort ? { ort: k.ort } : {}) } : { name: '?' };
	return { aktion: 'anlage_anlegen', daten };
}

function kunde(t: string): { aktion: string; daten: Record<string, unknown> } {
	let rest = t.replace(/^.*?\b(?:kunden|kundin|kunde)\b(?:\s+an\b)?\s*[:,]?\s*/i, '');
	const daten: Record<string, unknown> = {};
	const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(rest);
	if (email) {
		daten.email = email[0];
		rest = rest.replace(email[0], ' ');
	}
	const tel = /\b(?:telefon(?:nummer)?|tel\.?|handy(?:nummer)?|nummer)\s*:?\s*([+\d][\d /-]{4,}\d)/i.exec(rest);
	if (tel) {
		daten.telefon = tel[1].trim();
		rest = rest.replace(tel[0], ' ');
	}
	const strasse = /\b([A-ZÄÖÜ][\wäöüß-]*(?:straße|strasse|str\.|weg|allee|platz|ring|damm|gasse|chaussee))\s+(\d+\s?[a-z]?)\b/i.exec(rest);
	if (strasse) {
		daten.strasse = `${strasse[1]} ${strasse[2]}`;
		rest = rest.replace(strasse[0], ' ');
	}
	const plz = /\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß-]+)/.exec(rest);
	const ortRe = /\b(?:in|aus)\s+([A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(rest);
	if (plz) {
		daten.plz = plz[1];
		daten.ort = plz[2];
		rest = rest.replace(plz[0], ' ');
	} else if (ortRe) {
		daten.ort = ortRe[1];
		rest = rest.replace(ortRe[0], ' ');
	}
	rest = sauber(rest.replace(/\b(?:wohnt|wohnhaft|sitzt|mit|und|telefon|e-?mail|adresse)\b/gi, ' '));
	const teile = rest.split(/\s*,\s*/).map(sauber).filter(Boolean);
	const name = teile[0] ?? '';
	if (teile.length > 1 && !daten.ort && /^[A-ZÄÖÜ][\wäöüß-]+$/.test(teile.at(-1)!)) daten.ort = teile.at(-1);
	const firma = /\b(?:firma\s+)?(.+?\b(?:gmbh(?:\s*&\s*co\.?\s*kg)?|kg|ag|ohg|gbr|e\.\s?k\.|ug))\b/i.exec(name) ?? /\bfirma\s+(.+)/i.exec(name);
	if (firma) {
		daten.art = 'firma';
		daten.firma = sauber(firma[1].replace(/^firma\s+/i, ''));
		return { aktion: 'kunde_anlegen', daten };
	}
	daten.art = 'privat';
	const woerter = name.split(/\s+/).filter(Boolean);
	if (woerter.length && /^(herrn?|frau)$/i.test(woerter[0])) {
		const a = woerter.shift()!.toLowerCase();
		daten.anrede = a.startsWith('herr') ? 'Herr' : 'Frau';
	}
	if (woerter.length) daten.nachname = woerter.pop();
	if (woerter.length) daten.vorname = woerter.join(' ');
	return { aktion: 'kunde_anlegen', daten };
}

function auftrag(t: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const daten: Record<string, unknown> = {};
	let rest = t.replace(/^.*?\b(?:neue[nrs]?\s+)?auftrag\b\s*(?:anlegen|an)?\s*[:,]?/i, ' ');
	const q = quelleAus(rest);
	if (q) {
		daten.quelle = q.quelle;
		rest = q.rest;
	}
	const start = zeitangabe(rest, kontext);
	if (start) daten.start = start;
	const uhrzeiten = findeUhrzeiten(rest);
	if (uhrzeiten.length > 1) daten.ende_uhrzeit = uhrzeiten[1].uhrzeit;
	rest = ohneZeit(rest);
	const ma = findeMitarbeiter(rest);
	if (ma) {
		daten.mitarbeiter = ma.namen;
		rest = ma.rest;
	}
	// Titel nach Doppelpunkt („Auftrag für Müller: Dachrinne reinigen“)
	const doppel = /^(.*?):\s*(.+)$/.exec(rest);
	let titelTeil: string | null = null;
	if (doppel) {
		titelTeil = doppel[2];
		rest = doppel[1];
	}
	const k = findeKunde(rest, true);
	if (k) {
		daten.kunde = { name: k.name, ...(k.ort ? { ort: k.ort } : {}) };
		rest = k.rest;
	}
	const titel = sauber(
		(titelTeil ?? rest)
			.replace(/\b(?:für|bei|ab|am|in|mit|und)\b\s*(?=[,]|$)/gi, ' ')
			.replace(/^\s*(?:für|bei|ab|am|zum|zur|wegen)\s+/i, ' ')
			.replace(/\s*,\s*/g, ' ')
	);
	daten.titel = grossAnfang(titel.replace(/^(?:für|bei|ab|am)\s+/i, '')) || 'Auftrag';
	if (!daten.kunde) daten.kunde = { name: '?' };
	return { aktion: 'auftrag_anlegen', daten };
}

function todo(t: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const daten: Record<string, unknown> = {};
	let rest = t;
	const wdh = wiederholungAus(rest);
	if (wdh) {
		daten.wiederholung = wdh.regel;
		if (wdh.intervall > 1) daten.intervall = wdh.intervall;
		rest = wdh.rest;
	}
	// Fälligkeit: „bis Freitag“, „bis morgen“, „am 23.10.“, sonst eine Tagesangabe irgendwo
	const bis = new RegExp(`\\b(?:bis|bis zum|am|zum|für)\\s+((?:nächsten\\s+|kommenden\\s+)?(?:${WOCHENTAGE.join('|')}|übermorgen|morgen|heute|\\d{1,2}\\.\\s?\\d{1,2}\\.?(?:\\d{2,4})?|\\d{1,2}\\.\\s+\\w+)(?:\\s+(?:um\\s+)?\\d{1,2}(?::\\d{2})?\\s*uhr)?)`, 'i').exec(rest);
	const f = zeitangabe(bis ? bis[1] : rest, kontext);
	if (f) daten.faellig = { tag: f.tag, ...(f.wochentag ? { wochentag: f.wochentag } : {}), ...(f.datum ? { datum: f.datum } : {}) };
	if (bis) rest = rest.replace(bis[0], ' ');
	rest = ohneZeit(rest);
	const erinnereName = /\berinner\w*\s+([A-ZÄÖÜ][\wäöüß-]+)\s+an\b/i.exec(rest);
	if (erinnereName && istNamensWort(erinnereName[1])) {
		daten.zustaendig = erinnereName[1];
		rest = rest.slice((erinnereName.index ?? 0) + erinnereName[0].length);
		rest = rest.replace(/^(?:\s+(?:den|die|das))?\s*/i, '');
		daten.titel = grossAnfang(sauber(rest)) || 'Erinnerung';
		return { aktion: 'todo_anlegen', daten };
	}
	if (/\berinner\w*\s+mich\b/i.test(rest)) {
		daten.zustaendig = 'mich';
		rest = rest.replace(/^.*?\berinner\w*\s+mich\b\s*(?:daran,?\s*)?(?:an\s+(?:den|die|das)?\s*)?/i, '');
		daten.titel = grossAnfang(sauber(rest)) || 'Erinnerung';
		return { aktion: 'todo_anlegen', daten };
	}
	const fuer = /\b(?:todo|aufgabe)\b\s*(?:für|an)\s+([A-ZÄÖÜ][\wäöüß-]+)\s*[:,]?/i.exec(rest);
	const soll = /^\s*(?:todo|aufgabe)?\s*[:,]?\s*([A-ZÄÖÜ][\wäöüß-]+)\s+(?:soll|muss)\s+/.exec(rest);
	if (fuer && istNamensWort(fuer[1])) {
		daten.zustaendig = fuer[1];
		rest = rest.slice((fuer.index ?? 0) + fuer[0].length);
	} else if (soll && istNamensWort(soll[1])) {
		daten.zustaendig = soll[1];
		rest = rest.slice((soll.index ?? 0) + soll[0].length);
	} else {
		rest = rest.replace(/^.*?\b(?:todo|aufgabe)\b\s*(?:anlegen)?\s*[:,]?/i, '');
	}
	const auftragsBezug = /\b(?:zum|für den|beim)\s+auftrag\s+(.+)$/i.exec(rest);
	if (auftragsBezug) {
		daten.auftrag = sauber(auftragsBezug[1]);
		rest = rest.replace(auftragsBezug[0], ' ');
	}
	daten.titel = grossAnfang(sauber(rest.replace(/^\s*(?:neues|neue|ein|eine)\s+/i, ''))) || 'To-do';
	return { aktion: 'todo_anlegen', daten };
}

function einsatz(t: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const daten: Record<string, unknown> = {};
	// Mehrtägig: „von Montag bis Mittwoch“, „bis Freitag“, „bis zum 30.10.“ (nicht: „bis 16 Uhr“)
	const bisTag = new RegExp(
		`\\bbis\\s+(?:zum\\s+|einschließlich\\s+)?((?:nächsten\\s+|kommenden\\s+)?(?:${WOCHENTAGE.join('|')}|übermorgen|morgen|\\d{1,2}\\.\\s?\\d{1,2}\\.?(?:\\d{2,4})?))`,
		'i'
	).exec(t);
	if (bisTag) {
		const b = findeTag(bisTag[1], kontext);
		if (b) daten.bis = b;
		t = t.replace(bisTag[0], ' ');
	}
	const kolonne = /\bkolonne\s+([A-ZÄÖÜ0-9][\wäöüß-]*)/i.exec(t);
	if (kolonne) t = t.replace(kolonne[0], ' ');
	const tag = findeTag(t, kontext);
	const uhrzeiten = findeUhrzeiten(t);
	daten.start = { ...(tag ?? { tag: 'heute' }), ...(uhrzeiten[0] ? { uhrzeit: uhrzeiten[0].uhrzeit } : {}) };
	if (uhrzeiten.length > 1) daten.ende_uhrzeit = uhrzeiten[1].uhrzeit;
	let rest = ohneZeit(t);
	// „Plane Mehmet … ein“, „Einsatz für Ali und Murat …“, „… mit Ali“
	let namen: string[] | null = null;
	const plane = /\b(?:plane?|teile?)\s+((?:[A-ZÄÖÜ][\wäöüß-]+)(?:(?:\s*,\s*|\s+und\s+)[A-ZÄÖÜ][\wäöüß-]+)*)/i.exec(rest);
	if (plane) namen = namensListe(plane[1]);
	if (namen) rest = rest.replace(plane![0], ' ');
	if (!namen) {
		const fuer = /\b(?:termin|einsatz)\s+für\s+((?:[A-ZÄÖÜ][\wäöüß-]+)(?:(?:\s*,\s*|\s+und\s+)[A-ZÄÖÜ][\wäöüß-]+)*)/i.exec(rest);
		if (fuer) namen = namensListe(fuer[1]);
		if (namen) rest = rest.replace(fuer![0], ' ');
	}
	if (!namen) {
		const ma = findeMitarbeiter(rest);
		if (ma) {
			namen = ma.namen;
			rest = ma.rest;
		}
	}
	daten.mitarbeiter = [...(kolonne ? [`Kolonne ${kolonne[1]}`] : []), ...(namen ?? [])];
	const k = findeKunde(rest.replace(/\bvon\s*$/i, ' '), true);
	daten.auftrag = k ? k.name : '?';
	return { aktion: 'einsatz_anlegen', daten };
}

function verschieben(t: string, kontext: KiKontext): { aktion: string; daten: Record<string, unknown> } {
	const daten: Record<string, unknown> = {};
	// neue Zeit: nach dem letzten „auf“
	const aufIndex = t.toLowerCase().lastIndexOf(' auf ');
	const nachTeil = aufIndex >= 0 ? t.slice(aufIndex + 5) : '';
	const vorTeil = aufIndex >= 0 ? t.slice(0, aufIndex) : t;
	const von = zeitangabe(vorTeil, kontext);
	const nachTag = findeTag(nachTeil, kontext);
	const nachUhr = findeUhrzeiten(nachTeil)[0]?.uhrzeit;
	const basis = nachTag ?? (von ? { tag: von.tag, ...(von.wochentag ? { wochentag: von.wochentag } : {}), ...(von.datum ? { datum: von.datum } : {}) } : { tag: 'heute' as const });
	daten.nach = { ...basis, ...(nachUhr ? { uhrzeit: nachUhr } : {}) };
	if (von) daten.von = von;
	const vor = ohneZeit(vorTeil);
	const genitiv = /\b([A-ZÄÖÜ][a-zäöüß]+)s\s+(?:termin|einsatz)/i.exec(vor);
	const mit = /\b(?:mit|von)\s+([A-ZÄÖÜ][\wäöüß-]+)\b/.exec(vor);
	if (genitiv && istNamensWort(genitiv[1])) daten.mitarbeiter = genitiv[1];
	else if (mit && istNamensWort(mit[1])) daten.mitarbeiter = mit[1];
	const k = findeKunde(vor, false);
	if (k) daten.auftrag = k.name;
	return { aktion: 'einsatz_verschieben', daten };
}

function angebot(t: string): { aktion: string; daten: Record<string, unknown> } {
	let rest = t.replace(/^.*?\bangebot\w*\b\s*/i, '');
	let stichworte = '';
	const ueber = /(?<!\p{L})über\s+/iu.exec(rest);
	const trenner = /\s*(?::|,|\bmit\b)\s*/i.exec(rest);
	if (ueber && (!trenner || (ueber.index ?? 0) <= (trenner.index ?? 0))) {
		stichworte = rest.slice((ueber.index ?? 0) + ueber[0].length);
		rest = rest.slice(0, ueber.index);
	} else if (trenner) {
		stichworte = rest.slice((trenner.index ?? 0) + trenner[0].length);
		rest = rest.slice(0, trenner.index);
	}
	const auftragName = sauber(
		rest
			.replace(/^(?:für|zu|zum)\s+/i, '')
			.replace(/^(?:den\s+|die\s+|das\s+)?(?:auftrag|kunden?|kundin|familie|firma|herrn?|frau)\s+/i, '')
			.replace(/^(?:den\s+|die\s+|das\s+)?(?:auftrag|kunden?|kundin|familie|firma|herrn?|frau)\s+/i, '')
	);
	return {
		aktion: 'angebot_entwurf',
		daten: { auftrag: auftragName || '?', stichworte: sauber(stichworte) || sauber(t) }
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Protokoll

function protokoll(t: string): { aktion: string; daten: Record<string, unknown> } {
	const l = t.toLowerCase();
	const daten: Record<string, unknown> = {};
	// „Protokoll Abdichtung für Auftrag Müller starten“ / „Starte das Abdichtungsprotokoll bei Müller“: Vorlage starten
	if (/\b(start|starte|starten|beginn|beginne|beginnen|öffne|öffnen|anfangen|fang)\b/.test(l)) {
		const vorlage =
			/protokoll\s+(?:für\s+(?:die\s+|das\s+|den\s+)?)?([\p{L}-]+(?:\s+[\p{L}-]+)?)\s+(?:für|bei|zu|zum|beim)\b/iu.exec(t)?.[1] ??
			/(?:^|\s)([\p{L}-]+?)-?protokoll/iu.exec(t)?.[1];
		if (vorlage && !/^(das|ein|eine|den|neues?)$/i.test(vorlage)) daten.vorlage = vorlage;
		const nummer = /\bA-\d{4}-\d{3,4}\b/i.exec(t);
		if (nummer) daten.auftrag = { nummer: nummer[0].toUpperCase() };
		else {
			const name = /\b(?:[Aa]uftrag|bei|für)\s+(?:(?:dem|den|der|die|das)\s+)?(?:[Aa]uftrag\s+)?(?:(?:herrn?|frau|familie|firma)\s+)?([\p{Lu}][\p{L}-]+(?:\s+[\p{Lu}][\p{L}-]+)?)/u.exec(t);
			if (name) daten.auftrag = { name: name[1] };
		}
		return { aktion: 'protokoll_ausfuellen', daten };
	}
	// Typ erkennen (längere Wörter zuerst, um „Abnahmeprotokoll" korrekt zu erkennen)
	if (/aufma[ßs](?!\p{L})/u.test(l)) daten.typ = 'aufmass';
	else if (/\bregiebericht\b/.test(l)) daten.typ = 'regiebericht';
	else if (/mängelliste|maengelliste/.test(l)) daten.typ = 'maengelliste';
	else if (/abnahme/.test(l)) daten.typ = 'abnahme';
	else daten.typ = 'abnahme'; // Standard
	// Auftrag-Nummer
	const nummer = /\bA-\d{4}-\d{3,4}\b/i.exec(t);
	if (nummer) daten.auftrag = { nummer: nummer[0].toUpperCase() };
	// Inhalt nach Doppelpunkt
	const doppel = /^(.*?):\s*(.+)$/.exec(t);
	if (doppel) {
		const inhalt: Record<string, unknown> = {};
		const text = doppel[2].trim();
		if (text) inhalt.bemerkung = text;
		daten.inhalt = inhalt;
	}
	return { aktion: 'protokoll_ausfuellen', daten };
}

// ---------------------------------------------------------------------------------------------------------------
// Angebotsentwurf: Katalogposition passt, wenn ein Hauptwort ihrer Bezeichnung im Text vorkommt; Menge = Zahl davor.

const STOPP = new Set(['und', 'mit', 'für', 'der', 'die', 'das', 'inkl', 'inkl.', 'bis', 'zum', 'zur', 'von', 'auf', 'aus', 'in', 'ohne']);
const EINHEIT_WORT = '(?:m²|m2|qm|quadratmeter|m|meter|lfm|laufende\\s+meter|stück|stk|h|stunden?|psch|pauschal|kg|l|liter|m³|kubikmeter)';

function stamm(w: string): string {
	return w.toLowerCase().replace(/(en|er|n|e|s)$/, '');
}

export function entwirf(e: EntwurfEingabe): { positionen: { schluessel: string; menge: number; unsicher: boolean }[] } {
	const text = e.text.toLowerCase();
	const positionen: { schluessel: string; menge: number; unsicher: boolean; index: number }[] = [];
	for (const p of e.katalog) {
		const woerter = p.bezeichnung
			.toLowerCase()
			.split(/[^a-zäöüß0-9]+/)
			.filter((w) => w.length >= 5 && !STOPP.has(w));
		let treffer: { index: number; wort: string } | null = null;
		for (const w of woerter) {
			const s = stamm(w);
			const i = text.search(new RegExp(`(?<![a-zäöüß])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
			if (i >= 0) {
				treffer = { index: i, wort: w };
				break;
			}
		}
		if (!treffer) continue;
		const davor = text.slice(Math.max(0, treffer.index - 40), treffer.index).split(/\bund\b|,|;|\bsowie\b/).pop() ?? '';
		const m = new RegExp(`(\\d+(?:[.,]\\d+)?|${ZAHLWORT})\\s*${EINHEIT_WORT}?\\s*(?:[a-zäöüß-]+\\s+){0,2}$`).exec(davor);
		const menge = m ? zahl(m[1]) : null;
		positionen.push({ schluessel: p.schluessel, menge: menge && menge > 0 ? menge : 1, unsicher: !menge, index: treffer.index });
	}
	// Reihenfolge wie im gesprochenen Text
	return { positionen: positionen.sort((a, b) => a.index - b.index).map(({ index: _i, ...rest }) => rest) };
}
