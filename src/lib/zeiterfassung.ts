import { berlinTag, berlinUhrzeit, tagesGrenzen, tagPlus } from './zeit';

/**
 * Zeiterfassung (Wunsch Jamil msgs 2770/2772/2774) – reine Rechnung ohne Datenbank (Server, Oberfläche, Tests).
 *
 * Ein Eintrag ist ein Abschnitt: Arbeit, Pause oder Fahrt mit Beginn und Ende (Ende leer = läuft noch, gerechnet bis
 * „jetzt“). Arbeitsabschnitte können eine nachgetragene Pause enthalten (`pauseMin`, z. B. „8–16:30, 30 Min. Pause“).
 *
 * Summen je Tag sind robust gegen Überschneidungen (die Datenbank verhindert sie, Rechnung und Export sollen aber nie
 * doppelt zählen):
 *   Arbeitszeit = Vereinigung aller Arbeitsabschnitte − Pausenabschnitte darin − nachgetragene Pausen
 *   Pausen      = Pausenabschnitte (vereinigt) + nachgetragene Pausen
 *   Fahrzeit    = Vereinigung der Fahrten ohne die Teile, die schon als Arbeit oder Pause zählen
 * Abschnitte über Mitternacht werden auf die Berliner Kalendertage aufgeteilt.
 */

export const ZEIT_ARTEN = ['arbeit', 'pause', 'fahrt'] as const;
export type ZeitArt = (typeof ZEIT_ARTEN)[number];
export const ZEIT_ART_NAMEN: Record<ZeitArt, string> = { arbeit: 'Arbeit', pause: 'Pause', fahrt: 'Fahrt' };

export const STEMPEL_AKTIONEN = ['start', 'pause', 'weiter', 'fertig', 'abfahrt', 'angekommen'] as const;
export type StempelAktion = (typeof STEMPEL_AKTIONEN)[number];

export type ZeitEintrag = {
	id: string;
	benutzerId: string;
	benutzerName?: string;
	auftragId: string;
	auftragNummer?: string | null;
	auftragTitel?: string | null;
	art: ZeitArt;
	beginn: string;
	/** leer = läuft noch */
	ende: string | null;
	pauseMin: number;
	km: number | null;
	kmBerechnet: number | null;
	kmQuelle: 'route' | 'luftlinie' | 'manuell' | null;
	startAdresse?: string | null;
	zielAdresse?: string | null;
	notiz: string | null;
	manuell: boolean;
	korrekturGrund: string | null;
	freigegeben: boolean;
	/** Nacharbeit (Jamil msg 2858) – nur bei Arbeit. */
	nacharbeit?: boolean;
};

type Abschnitt = { von: number; bis: number };

const MIN = 60_000;

/** Vereinigt Abschnitte (sortiert, überlappende/angrenzende zusammengefasst). */
export function vereinige(liste: readonly Abschnitt[]): Abschnitt[] {
	const s = liste.filter((a) => a.bis > a.von).map((a) => ({ ...a })).sort((a, b) => a.von - b.von);
	const aus: Abschnitt[] = [];
	for (const a of s) {
		const letzter = aus.at(-1);
		if (letzter && a.von <= letzter.bis) letzter.bis = Math.max(letzter.bis, a.bis);
		else aus.push(a);
	}
	return aus;
}

/** `a` ohne die Teile, die in `weg` liegen (beide beliebig, Ergebnis vereinigt). */
export function ohne(a: readonly Abschnitt[], weg: readonly Abschnitt[]): Abschnitt[] {
	let rest = vereinige(a);
	for (const w of vereinige(weg)) {
		const neu: Abschnitt[] = [];
		for (const r of rest) {
			if (w.bis <= r.von || w.von >= r.bis) neu.push(r);
			else {
				if (w.von > r.von) neu.push({ von: r.von, bis: w.von });
				if (w.bis < r.bis) neu.push({ von: w.bis, bis: r.bis });
			}
		}
		rest = neu;
	}
	return rest;
}

const summeMs = (l: readonly Abschnitt[]) => l.reduce((s, a) => s + (a.bis - a.von), 0);

export type Summe = { arbeitMin: number; pauseMin: number; fahrtMin: number; km: number };

/** Summen über Einträge (laufende bis `jetzt`), wahlweise beschränkt auf einen Zeitraum [von, bis). */
export function summiere(eintraege: readonly Pick<ZeitEintrag, 'art' | 'beginn' | 'ende' | 'pauseMin' | 'km'>[], jetzt: Date, rahmen?: { von: Date; bis: Date }): Summe {
	const zu = (e: (typeof eintraege)[number]): Abschnitt | null => {
		let von = Date.parse(e.beginn);
		let bis = e.ende ? Date.parse(e.ende) : Math.max(jetzt.getTime(), von);
		if (rahmen) {
			von = Math.max(von, rahmen.von.getTime());
			bis = Math.min(bis, rahmen.bis.getTime());
		}
		return bis > von ? { von, bis } : null;
	};
	const je = (art: ZeitArt) => eintraege.filter((e) => e.art === art).map(zu).filter((x): x is Abschnitt => x !== null);
	const arbeitRoh = je('arbeit');
	const pausen = vereinige(je('pause'));
	const arbeit = ohne(arbeitRoh, pausen);
	// Nachgetragene Pausen: anteilig, wenn der Abschnitt nur teilweise im Rahmen liegt
	let nachgetragen = 0;
	for (const e of eintraege) {
		if (e.art !== 'arbeit' || !e.pauseMin) continue;
		const ganz = (e.ende ? Date.parse(e.ende) : jetzt.getTime()) - Date.parse(e.beginn);
		const teil = zu(e);
		if (!teil || ganz <= 0) continue;
		nachgetragen += e.pauseMin * MIN * ((teil.bis - teil.von) / ganz);
	}
	const arbeitMs = Math.max(0, summeMs(arbeit) - nachgetragen);
	const fahrt = ohne(je('fahrt'), [...arbeitRoh, ...pausen]);
	// Kilometer zählen nur ohne Rahmen bzw. am Tag, an dem die Fahrt beginnt
	const km = eintraege
		.filter((e) => e.art === 'fahrt' && e.km !== null && (!rahmen || (Date.parse(e.beginn) >= rahmen.von.getTime() && Date.parse(e.beginn) < rahmen.bis.getTime())))
		.reduce((s, e) => s + Number(e.km), 0);
	return {
		arbeitMin: Math.round(arbeitMs / MIN),
		pauseMin: Math.round((summeMs(pausen) + nachgetragen) / MIN),
		fahrtMin: Math.round(summeMs(fahrt) / MIN),
		km: Math.round(km * 10) / 10
	};
}

/** Gesetzliche Pausen (§ 4 ArbZG): mehr als 6 h → 30 Min., mehr als 9 h → 45 Min.; mehr als 10 h ist nicht erlaubt. */
export function arbzgHinweise(s: Pick<Summe, 'arbeitMin' | 'pauseMin'>): string[] {
	const h: string[] = [];
	if (s.arbeitMin > 9 * 60 && s.pauseMin < 45) h.push('Über 9 Stunden Arbeit: mindestens 45 Minuten Pause nötig (§ 4 ArbZG).');
	else if (s.arbeitMin > 6 * 60 && s.pauseMin < 30) h.push('Über 6 Stunden Arbeit: mindestens 30 Minuten Pause nötig (§ 4 ArbZG).');
	if (s.arbeitMin > 10 * 60) h.push('Mehr als 10 Stunden Arbeit an einem Tag (§ 3 ArbZG).');
	return h;
}

export type TagesZeile = Summe & { tag: string; beginn: string | null; ende: string | null; hinweise: string[]; eintraege: number };

/** Tagesübersicht für die Tage `tage` (Berlin): erster Beginn, letztes Ende, Summen, Hinweise. */
export function tagesUebersicht(eintraege: readonly ZeitEintrag[], tage: readonly string[], jetzt: Date): TagesZeile[] {
	return tage.map((tag) => {
		const { beginn: von, ende: bis } = tagesGrenzen(tag);
		const drin = eintraege.filter((e) => Date.parse(e.beginn) < bis.getTime() && (e.ende ? Date.parse(e.ende) : jetzt.getTime()) > von.getTime());
		const s = summiere(drin, jetzt, { von, bis });
		const anfaenge = drin.map((e) => Math.max(Date.parse(e.beginn), von.getTime()));
		const enden = drin.map((e) => Math.min(e.ende ? Date.parse(e.ende) : jetzt.getTime(), bis.getTime()));
		return {
			tag,
			...s,
			beginn: anfaenge.length ? berlinUhrzeit(new Date(Math.min(...anfaenge))) : null,
			ende: enden.length ? berlinUhrzeit(new Date(Math.max(...enden))) : null,
			hinweise: arbzgHinweise(s),
			eintraege: drin.length
		};
	});
}

/** „7:45 h“ */
export function stundenText(min: number): string {
	const v = min < 0 ? '−' : '';
	const m = Math.abs(Math.round(min));
	return `${v}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

/** Dezimalstunden für Export/Rechnung (2 Stellen). */
export const stundenDezimal = (min: number) => Math.round((min / 60) * 100) / 100;

// ——— Kilometer ———

export type Punkt = { lat: number; lng: number };

/** Luftlinie (Haversine) in km. */
export function luftlinieKm(a: Punkt, b: Punkt): number {
	const R = 6371.0088;
	const rad = (g: number) => (g * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Standard-Umwegfaktor Straße/Luftlinie. Studien für Deutschland liegen meist bei 1,2–1,4 (kurze Stadtfahrten höher);
 * 1,3 ist ein üblicher Mittelwert. Einstellbar über `CRM_ROUTEN_FAKTOR`.
 */
export const STANDARD_UMWEG = 1.3;

/** Fahr-km als Schätzung aus der Luftlinie (auf 0,1 km gerundet). */
export function kmAusLuftlinie(a: Punkt, b: Punkt, faktor = STANDARD_UMWEG): number {
	return Math.round(luftlinieKm(a, b) * faktor * 10) / 10;
}

// ——— Export ———

/** Ein CSV-Feld (Semikolon, Excel-tauglich): Anführungszeichen bei Bedarf, Formel-Einschleusung entschärft. */
export function csvFeld(w: string | number | null | undefined): string {
	if (w === null || w === undefined) return '';
	let t = typeof w === 'number' ? String(w).replace('.', ',') : w;
	if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
	return /[;"\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

export function csv(zeilen: readonly (readonly (string | number | null | undefined)[])[]): string {
	// BOM, damit Excel Umlaute erkennt
	return '﻿' + zeilen.map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}

/** Tage von `von` bis `bis` (beide eingeschlossen), höchstens 62. */
export function tageZwischen(von: string, bis: string): string[] {
	const aus: string[] = [];
	for (let t = von; t <= bis && aus.length < 62; t = tagPlus(t, 1)) aus.push(t);
	return aus;
}

/** Laufzeit „1:23 h“ seit `beginn`. */
export const laufzeitText = (beginn: string, jetzt: Date) => stundenText(Math.max(0, (jetzt.getTime() - Date.parse(beginn)) / MIN));

export { berlinTag };

// ——— Monatssicht (Jamil msg 2797) ———

/** Alle Tage eines Monats `JJJJ-MM`. */
export function monatsTage(monat: string): string[] {
	const [j, m] = monat.split('-').map(Number);
	const anzahl = new Date(Date.UTC(j, m, 0)).getUTCDate();
	return Array.from({ length: anzahl }, (_, i) => `${monat}-${String(i + 1).padStart(2, '0')}`);
}

export const istMonat = (w: unknown): w is string => typeof w === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(w);

/**
 * Soll-Stunden: Arbeitstage (Mo–Fr) im Zeitraum ohne Abwesenheitstage × Stunden pro Tag (Kalkulation: je Mitarbeiter,
 * sonst Standard des Betriebs). `null`, wenn der Mitarbeiter nicht in der Kalkulation steht.
 */
export function sollMinuten(tage: readonly string[], stundenTag: number | null, abwesend: ReadonlySet<string>, wochentagVon: (t: string) => number): number | null {
	if (stundenTag === null || !(stundenTag > 0)) return null;
	const arbeitstage = tage.filter((t) => wochentagVon(t) < 5 && !abwesend.has(t)).length;
	return Math.round(arbeitstage * stundenTag * 60);
}

/** Wochen-Zwischensummen (ISO-Kalenderwoche) für die Monatstabelle. */
export function wochenSummen(zeilen: readonly TagesZeile[], kw: (t: string) => number): { kw: number; arbeitMin: number; pauseMin: number; fahrtMin: number; km: number }[] {
	const m = new Map<number, { kw: number; arbeitMin: number; pauseMin: number; fahrtMin: number; km: number }>();
	for (const z of zeilen) {
		const w = kw(z.tag);
		const s = m.get(w) ?? { kw: w, arbeitMin: 0, pauseMin: 0, fahrtMin: 0, km: 0 };
		s.arbeitMin += z.arbeitMin;
		s.pauseMin += z.pauseMin;
		s.fahrtMin += z.fahrtMin;
		s.km = Math.round((s.km + z.km) * 10) / 10;
		m.set(w, s);
	}
	return [...m.values()];
}
