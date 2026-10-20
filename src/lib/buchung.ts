/**
 * Online-Terminbuchung (Wunsch Jamil, Sprachnachrichten 2684/2686) – Wissen ohne Serverbezug, genutzt vom Server
 * (freie Zeiten, Prüfung der Buchung) und von den Seiten (Einstellungen, öffentliche Buchungsseite):
 *
 * - `freieZeiten`: freie Termine eines Dienstes aus Arbeitszeiten, Ausnahmen, Abwesenheiten, belegten Zeiten
 *   (Einsätze der Plantafel und andere Buchungen), Puffern, Mindestvorlauf, Buchungshorizont und Tagesgrenze.
 * - `waehleMitarbeiter`: „beliebiger freier Mitarbeiter“ – abwechselnd (wer am wenigsten Buchungen hat, bei Gleichstand
 *   wer am längsten keine bekam).
 * - `pruefeKontakt`: Standardfelder Vorname, Name, E-Mail, Telefon, Adresse.
 */

import { berlinTag, berlinZeitpunkt, tagPlus, wochentag, istTag } from './zeit';
import type { FeldTyp } from './protokoll-formular';

export const ORT_ARTEN = ['kunde', 'buero', 'video', 'telefon'] as const;
export type OrtArt = (typeof ORT_ARTEN)[number];
export const ORT_NAMEN: Record<OrtArt, string> = {
	kunde: 'Beim Kunden vor Ort',
	buero: 'In unserem Büro',
	video: 'Video-Termin',
	telefon: 'Telefon-Termin'
};

export const MODI = ['fest', 'beliebig'] as const;
export type Modus = (typeof MODI)[number];
export const MODUS_NAMEN: Record<Modus, string> = {
	fest: 'Fester Mitarbeiter',
	beliebig: 'Beliebiger freier Mitarbeiter (abwechselnd)'
};

export const ADRESSE_ARTEN = ['pflicht', 'optional', 'aus'] as const;
export type AdresseArt = (typeof ADRESSE_ARTEN)[number];

/** Feldtypen, die ein Dienst als eigene Frage an den Kunden stellen kann (keine Unterschrift/Checkliste/Messwert). */
export const FRAGE_TYPEN: readonly FeldTyp[] = ['hinweis', 'text', 'textlang', 'zahl', 'janein', 'auswahl', 'mehrfach', 'datum', 'foto'];

/** Grenzen der öffentlichen Buchung. */
export const BUCHUNG_GRENZEN = {
	/** so viele Tage liefert eine Abfrage freier Zeiten höchstens */
	tageJeAbfrage: 14,
	/** Fotos je Buchung insgesamt (zusammen unter BODY_SIZE_LIMIT = 6 MB) */
	fotos: 4,
	/** Bytes je Foto (nach dem Verkleinern im Browser auf 1600 px meist 0,2–0,6 MB) */
	fotoBytes: 1400 * 1024
} as const;

const MS_MIN = 60_000;

export type Intervall = { beginn: number; ende: number };
/** Belegte Zeit; Buchungen tragen ihre eigenen Puffer (ms) mit – die gelten zusätzlich zu denen des neuen Termins. */
export type Belegt = Intervall & { vor?: number; nach?: number };
export type ArbeitsZeit = { wochentag: number; von: string; bis: string };
export type Ausnahme = { tag: string; art: 'frei' | 'zusaetzlich'; von: string | null; bis: string | null };

export type Verfuegbarkeit = {
	id: string;
	/** Arbeitszeiten für diesen Dienst (dienstbezogene, sonst die allgemeinen) */
	zeiten: ArbeitsZeit[];
	ausnahmen: Ausnahme[];
	/** belegte Zeiten: Einsätze der Plantafel und aktive Buchungen (mit deren Puffern) */
	belegt: Belegt[];
	/** Abwesenheiten (Urlaub, Krankheit, …) als Tage einschließlich */
	abwesend: { von: string; bis: string }[];
	/** aktive Buchungen dieses Dienstes je Tag (für die Tagesgrenze) */
	buchungenJeTag: Record<string, number>;
};

export type DienstRegeln = {
	dauerMin: number;
	pufferVorMin: number;
	pufferNachMin: number;
	vorlaufMin: number;
	horizontTage: number;
	maxProTag: number | null;
};

export type FreieZeit = { beginn: string; ende: string; mitarbeiter: string[] };
export type FreierTag = { tag: string; zeiten: FreieZeit[] };

/** Schrittweite der angebotenen Anfangszeiten: 15 Minuten bei kurzen Terminen, sonst 30. */
export const rasterFuer = (dauerMin: number) => (dauerMin <= 30 ? 15 : 30);

const UHR = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const istUhrzeit = (w: unknown): w is string => typeof w === 'string' && UHR.test(w);

function zeitpunkt(tag: string, uhrzeit: string): number {
	const m = UHR.exec(uhrzeit.slice(0, 5));
	if (!m) {
		// 24:00 als Tagesende
		if (uhrzeit.startsWith('24:00')) return berlinZeitpunkt(tagPlus(tag, 1)).getTime();
		throw new RangeError(`Ungültige Uhrzeit: ${uhrzeit}`);
	}
	return berlinZeitpunkt(tag, Number(m[1]), Number(m[2])).getTime();
}

/** Intervalle `a` ohne die Intervalle `weg`. */
export function ohne(a: Intervall[], weg: Intervall[]): Intervall[] {
	let rest = a;
	for (const w of weg) {
		const neu: Intervall[] = [];
		for (const x of rest) {
			if (w.ende <= x.beginn || w.beginn >= x.ende) {
				neu.push(x);
				continue;
			}
			if (w.beginn > x.beginn) neu.push({ beginn: x.beginn, ende: w.beginn });
			if (w.ende < x.ende) neu.push({ beginn: w.ende, ende: x.ende });
		}
		rest = neu;
	}
	return rest;
}

/** Zusammenfassen überlappender/angrenzender Intervalle (sortiert). */
export function vereinige(a: Intervall[]): Intervall[] {
	const s = [...a].sort((x, y) => x.beginn - y.beginn);
	const aus: Intervall[] = [];
	for (const x of s) {
		const letzte = aus.at(-1);
		if (letzte && x.beginn <= letzte.ende) letzte.ende = Math.max(letzte.ende, x.ende);
		else aus.push({ ...x });
	}
	return aus;
}

/** Buchbare Fenster eines Mitarbeiters an einem Tag (Arbeitszeiten ± Ausnahmen, Abwesenheit = keine). */
export function fensterAmTag(v: Pick<Verfuegbarkeit, 'zeiten' | 'ausnahmen' | 'abwesend'>, tag: string): Intervall[] {
	if (v.abwesend.some((a) => a.von <= tag && a.bis >= tag)) return [];
	const wt = wochentag(tag);
	let fenster: Intervall[] = v.zeiten
		.filter((z) => z.wochentag === wt)
		.map((z) => ({ beginn: zeitpunkt(tag, z.von), ende: zeitpunkt(tag, z.bis) }))
		.filter((i) => i.ende > i.beginn);
	const heute = v.ausnahmen.filter((a) => a.tag === tag);
	for (const a of heute.filter((x) => x.art === 'zusaetzlich' && x.von && x.bis)) {
		fenster.push({ beginn: zeitpunkt(tag, a.von!), ende: zeitpunkt(tag, a.bis!) });
	}
	fenster = vereinige(fenster);
	for (const a of heute.filter((x) => x.art === 'frei')) {
		if (!a.von || !a.bis) return [];
		fenster = ohne(fenster, [{ beginn: zeitpunkt(tag, a.von), ende: zeitpunkt(tag, a.bis) }]);
	}
	return fenster;
}

/**
 * Kollidiert der neue Termin [b, e) mit Puffern pv/pn mit einer belegten Zeit? Ja, wenn der Termin mit seinen Puffern
 * die belegte Zeit schneidet oder der Termin selbst in die Puffer einer anderen Buchung fällt (halboffen: angrenzend
 * ist frei).
 */
function kollidiert(b: number, e: number, pv: number, pn: number, belegt: Belegt[]): boolean {
	return belegt.some(
		(x) => (x.beginn < e + pn && b - pv < x.ende) || (x.beginn - (x.vor ?? 0) < e && b < x.ende + (x.nach ?? 0))
	);
}

/**
 * Ist der Termin [beginn, beginn + Dauer) für den Mitarbeiter frei? Prüft Fenster, Vorlauf, Horizont, Tagesgrenze und
 * – mit Puffer davor/danach – die belegten Zeiten. `null` = frei, sonst der Grund (für Tests und Meldungen).
 */
export function grundBelegt(
	d: DienstRegeln,
	v: Verfuegbarkeit,
	beginn: number,
	jetzt: number
): null | 'vorlauf' | 'horizont' | 'arbeitszeit' | 'belegt' | 'tagesgrenze' {
	const ende = beginn + d.dauerMin * MS_MIN;
	const tag = berlinTag(new Date(beginn));
	if (beginn < jetzt + d.vorlaufMin * MS_MIN) return 'vorlauf';
	if (tag > tagPlus(berlinTag(new Date(jetzt)), d.horizontTage)) return 'horizont';
	const fenster = fensterAmTag(v, tag);
	if (!fenster.some((f) => f.beginn <= beginn && ende <= f.ende)) return 'arbeitszeit';
	if (kollidiert(beginn, ende, d.pufferVorMin * MS_MIN, d.pufferNachMin * MS_MIN, v.belegt)) return 'belegt';
	if (d.maxProTag !== null && (v.buchungenJeTag[tag] ?? 0) >= d.maxProTag) return 'tagesgrenze';
	return null;
}

/**
 * Freie Termine von `vonTag` bis `bisTag` (Berliner Tage, einschließlich; höchstens 62 Tage), je Tag sortiert, mit den
 * Mitarbeitern, die zu der Zeit frei sind. Anfangszeiten liegen im Raster ab Beginn des jeweiligen Fensters.
 */
export function freieZeiten(
	d: DienstRegeln,
	mitarbeiter: Verfuegbarkeit[],
	o: { vonTag: string; bisTag: string; jetzt: Date; rasterMin?: number }
): FreierTag[] {
	if (!istTag(o.vonTag) || !istTag(o.bisTag) || o.bisTag < o.vonTag) return [];
	const raster = (o.rasterMin ?? rasterFuer(d.dauerMin)) * MS_MIN;
	const jetzt = o.jetzt.getTime();
	const letzter = tagPlus(berlinTag(o.jetzt), d.horizontTage);
	const aus: FreierTag[] = [];
	let tag = o.vonTag < berlinTag(o.jetzt) ? berlinTag(o.jetzt) : o.vonTag;
	for (let n = 0; tag <= o.bisTag && tag <= letzter && n < 62; n++, tag = tagPlus(tag, 1)) {
		const jeBeginn = new Map<number, string[]>();
		for (const v of mitarbeiter) {
			for (const f of fensterAmTag(v, tag)) {
				for (let b = f.beginn; b + d.dauerMin * MS_MIN <= f.ende; b += raster) {
					if (grundBelegt(d, v, b, jetzt) !== null) continue;
					const liste = jeBeginn.get(b) ?? [];
					if (!liste.includes(v.id)) liste.push(v.id);
					jeBeginn.set(b, liste);
				}
			}
		}
		const zeiten = [...jeBeginn.entries()]
			.sort((x, y) => x[0] - y[0])
			.map(([b, ids]) => ({ beginn: new Date(b).toISOString(), ende: new Date(b + d.dauerMin * MS_MIN).toISOString(), mitarbeiter: ids }));
		if (zeiten.length > 0) aus.push({ tag, zeiten });
	}
	return aus;
}

/**
 * „Beliebiger freier Mitarbeiter“: abwechselnd verteilen – wer die wenigsten kommenden Buchungen dieses Dienstes hat,
 * bei Gleichstand wer am längsten keine neue bekam (nie = zuerst), dann nach ID (stabil).
 */
export function waehleMitarbeiter(kandidaten: string[], stand: Record<string, { anzahl: number; zuletzt: number | null }>): string | null {
	if (kandidaten.length === 0) return null;
	return [...kandidaten].sort((a, b) => {
		const x = stand[a] ?? { anzahl: 0, zuletzt: null };
		const y = stand[b] ?? { anzahl: 0, zuletzt: null };
		if (x.anzahl !== y.anzahl) return x.anzahl - y.anzahl;
		const zx = x.zuletzt ?? -Infinity;
		const zy = y.zuletzt ?? -Infinity;
		if (zx !== zy) return zx - zy;
		return a < b ? -1 : a > b ? 1 : 0;
	})[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Kontaktangaben (Standardfelder)

export type Kontakt = {
	vorname: string;
	nachname: string;
	email: string;
	telefon: string;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const TELEFON = /^\+?[0-9 ()/.-]{5,30}$/;
const PLZ = /^[A-Za-z0-9 -]{3,10}$/;

const LAENGEN = { vorname: 100, nachname: 100, email: 200, telefon: 30, strasse: 200, plz: 10, ort: 100 } as const;

function feld(roh: Record<string, unknown>, name: keyof typeof LAENGEN): string {
	const w = roh[name];
	if (typeof w !== 'string') return '';
	return [...w.replaceAll('\u0000', '').replace(/\s+/g, ' ').trim()].slice(0, LAENGEN[name]).join('');
}

/** Prüft die Standardfelder; liefert Werte oder Fehler je Feld (deutsche Meldungen für die Buchungsseite). */
export function pruefeKontakt(roh: unknown, adresse: AdresseArt): { werte: Kontakt | null; fehler: Record<string, string> } {
	const r = roh && typeof roh === 'object' && !Array.isArray(roh) ? (roh as Record<string, unknown>) : {};
	const f: Record<string, string> = {};
	const vorname = feld(r, 'vorname');
	const nachname = feld(r, 'nachname');
	const email = feld(r, 'email').toLowerCase();
	const telefon = feld(r, 'telefon');
	const strasse = adresse === 'aus' ? '' : feld(r, 'strasse');
	const plz = adresse === 'aus' ? '' : feld(r, 'plz');
	const ort = adresse === 'aus' ? '' : feld(r, 'ort');
	if (!vorname) f.vorname = 'Bitte Ihren Vornamen eingeben.';
	if (!nachname) f.nachname = 'Bitte Ihren Namen eingeben.';
	if (!EMAIL.test(email)) f.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
	if (!TELEFON.test(telefon) || telefon.replace(/\D/g, '').length < 5) f.telefon = 'Bitte eine gültige Telefonnummer eingeben.';
	const irgendwas = !!(strasse || plz || ort);
	if (adresse === 'pflicht' || irgendwas) {
		if (!strasse) f.strasse = 'Bitte Straße und Hausnummer eingeben.';
		if (!PLZ.test(plz)) f.plz = 'Bitte eine gültige PLZ eingeben.';
		if (!ort) f.ort = 'Bitte den Ort eingeben.';
	}
	if (Object.keys(f).length > 0) return { werte: null, fehler: f };
	return {
		werte: { vorname, nachname, email, telefon, strasse: strasse || null, plz: plz || null, ort: ort || null },
		fehler: {}
	};
}

/** Nur Ziffern einer Telefonnummer (Vergleich beim Wiedererkennen von Kunden); führende 0049/+49 → 0. */
export function telefonSchluessel(t: string | null | undefined): string {
	if (!t) return '';
	let z = t.replace(/[^\d+]/g, '');
	if (z.startsWith('+49')) z = '0' + z.slice(3);
	else if (z.startsWith('0049')) z = '0' + z.slice(4);
	return z.replace(/\D/g, '');
}

/** Vorname für die Anzeige auf der öffentlichen Seite (nie der ganze Name). */
export const nurVorname = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** Dauer lesbar: „60 Minuten“, „1,5 Stunden“. */
export function dauerText(min: number): string {
	if (min < 60 || min % 30 !== 0) return `${min} Minuten`;
	const h = min / 60;
	return `${String(h).replace('.', ',')} Stunde${h === 1 ? '' : 'n'}`;
}
