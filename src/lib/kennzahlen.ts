/**
 * Kennzahlen – Rechenregeln ohne Datenbank (testbar, auch im Browser nutzbar).
 *
 * Wunsch Jamil (Talk msg 2858): Kennzahlen-Cockpit mit Formel, Zeitraum, Trend gegenüber dem Vorzeitraum und Ampel
 * nach seinen Richtwerten; Kacheln auf Kunden/Aufträge/Angebote (msgs 2799, 2801, 2803) nutzen dieselben Zeiträume.
 * Fehlen Daten, steht „Daten fehlen: …“ statt einer irreführenden Null.
 */
import { tagPlus } from './zeit';

// ——— Zeiträume ———

export const ZEITRAUM_ARTEN = ['monat', 'quartal', 'jahr', '12monate', 'alle'] as const;
export type ZeitraumArt = (typeof ZEITRAUM_ARTEN)[number];
export const ZEITRAUM_NAMEN: Record<ZeitraumArt, string> = {
	monat: 'Dieser Monat',
	quartal: 'Dieses Quartal',
	jahr: 'Dieses Jahr',
	'12monate': 'Letzte 12 Monate',
	alle: 'Gesamt'
};
export const istZeitraumArt = (w: unknown): w is ZeitraumArt => typeof w === 'string' && (ZEITRAUM_ARTEN as readonly string[]).includes(w);

/** Tage als JJJJ-MM-TT; `von` einschließlich, `bis` AUSSCHLIESSLICH (Berliner Kalendertage). */
export type Spanne = { von: string; bis: string };
export type Zeitraum = { art: ZeitraumArt; text: string; spanne: Spanne | null; vorher: Spanne | null };

const monatsAnfang = (j: number, m: number) => {
	const jj = j + Math.floor((m - 1) / 12);
	const mm = ((((m - 1) % 12) + 12) % 12) + 1;
	return `${jj}-${String(mm).padStart(2, '0')}-01`;
};

/** Zeitraum zu „heute“ (Berliner Tag). „alle“ hat weder Grenzen noch Vorzeitraum. */
export function zeitraum(art: ZeitraumArt, heute: string): Zeitraum {
	const j = Number(heute.slice(0, 4));
	const m = Number(heute.slice(5, 7));
	const text = ZEITRAUM_NAMEN[art];
	switch (art) {
		case 'monat':
			return { art, text, spanne: { von: monatsAnfang(j, m), bis: monatsAnfang(j, m + 1) }, vorher: { von: monatsAnfang(j, m - 1), bis: monatsAnfang(j, m) } };
		case 'quartal': {
			const q = Math.floor((m - 1) / 3) * 3 + 1;
			return { art, text, spanne: { von: monatsAnfang(j, q), bis: monatsAnfang(j, q + 3) }, vorher: { von: monatsAnfang(j, q - 3), bis: monatsAnfang(j, q) } };
		}
		case 'jahr':
			return { art, text, spanne: { von: `${j}-01-01`, bis: `${j + 1}-01-01` }, vorher: { von: `${j - 1}-01-01`, bis: `${j}-01-01` } };
		case '12monate': {
			const bis = tagPlus(heute, 1);
			const von = tagPlus(bis, -365);
			return { art, text, spanne: { von, bis }, vorher: { von: tagPlus(von, -365), bis: von } };
		}
		default:
			return { art: 'alle', text, spanne: null, vorher: null };
	}
}

// ——— Rechnen ———

/** Anteil z/n – null, wenn n = 0 (nie „0 %“ ohne Grundlage). */
export const quote = (z: number, n: number): number | null => (n > 0 ? z / n : null);

/** Durchschnitt – null bei leerer Liste. */
export const schnitt = (werte: readonly number[]): number | null => (werte.length ? werte.reduce((s, w) => s + w, 0) / werte.length : null);

export const MS_TAG = 86_400_000;

// ——— Cockpit ———

export const KENNZAHL_IDS = ['abschlussquote', 'durchlaufzeit', 'termintreue', 'produktivitaet', 'nacharbeit', 'zahlungsdauer', 'umsatz_mitarbeiter'] as const;
export type KennzahlId = (typeof KENNZAHL_IDS)[number];
export type Ampel = 'gruen' | 'gelb' | 'rot';
export type Einheit = 'prozent' | 'tage' | 'faktor' | 'euro';

export type KennzahlInfo = {
	titel: string;
	formel: string;
	/** „Warum kritisch“ – Jamils Worte (msg 2858). */
	warum: string;
	/** Richtwert als Text, null = keiner vorgegeben (dann keine Ampel). */
	richtwert: string | null;
	einheit: Einheit;
	/** Wert nur mit „Preise sehen“. */
	preis: boolean;
	/** Welche Richtung ist besser (für den Trend); null = keine Wertung. */
	besser: 'hoch' | 'niedrig' | null;
};

export const KENNZAHLEN: Record<KennzahlId, KennzahlInfo> = {
	abschlussquote: {
		titel: 'Angebots-Abschlussquote',
		formel: 'Beauftragte Angebote / abgegebene Angebote',
		warum: 'Zeigt, ob Preise, Auftreten und Qualifizierung passen.',
		richtwert: '< 25 % → Angebot oder Zielgruppe falsch · 30–45 % → gesund · über 50 % → oft zu günstig',
		einheit: 'prozent',
		preis: false,
		besser: null
	},
	durchlaufzeit: {
		titel: 'Durchlaufzeit Anfrage → Angebot',
		formel: 'Ø Tage vom Erstkontakt (Anfrage angelegt) bis zum Versand des Angebots',
		warum: 'Zeit = Abschlusswahrscheinlichkeit.',
		richtwert: 'Best Practice: ≤ 3–5 Tage',
		einheit: 'tage',
		preis: false,
		besser: 'niedrig'
	},
	termintreue: {
		titel: 'Termintreue',
		formel: 'Termingerecht abgeschlossene Projekte / Gesamtprojekte (abgenommen bis zum letzten geplanten Einsatz)',
		warum: 'Direkter Einfluss auf Kundenzufriedenheit & Kosten.',
		richtwert: null,
		einheit: 'prozent',
		preis: false,
		besser: 'hoch'
	},
	produktivitaet: {
		titel: 'Produktivität (Stundenabweichung)',
		formel: 'Ist-Stunden / kalkulierte Stunden',
		warum: 'Zeigt echte Leistung der Baustelle – emotionslos.',
		richtwert: null,
		einheit: 'faktor',
		preis: false,
		besser: 'niedrig'
	},
	nacharbeit: {
		titel: 'Nacharbeitsquote',
		formel: 'Nacharbeitsstunden / Gesamtstunden',
		warum: 'Nacharbeit = reiner Geldverlust.',
		richtwert: '< 3 % sehr gut · 5 % teuer',
		einheit: 'prozent',
		preis: false,
		besser: 'niedrig'
	},
	zahlungsdauer: {
		titel: 'Durchschnittliche Zahlungsdauer',
		formel: 'Ø Tage von Rechnung bis Zahlung',
		warum: 'Cashflow schlägt Gewinn.',
		richtwert: '14–21 Tage gut · 30 Tage → Risiko',
		einheit: 'tage',
		preis: false,
		besser: 'niedrig'
	},
	umsatz_mitarbeiter: {
		titel: 'Umsatz pro Mitarbeiter',
		formel: 'Umsatz (angenommene Angebote, netto) / Anzahl Mitarbeiter (Kalkulation)',
		warum: 'Zeigt, wie viel Umsatz jede Arbeitskraft bringt.',
		richtwert: null,
		einheit: 'euro',
		preis: true,
		besser: 'hoch'
	}
};

/** Ampel nach Jamils Richtwerten; ohne Richtwert oder ohne Wert: null. Quoten als Anteil (0,3 = 30 %). */
export function ampel(id: KennzahlId, wert: number | null): Ampel | null {
	if (wert === null || !Number.isFinite(wert)) return null;
	switch (id) {
		case 'abschlussquote':
			return wert < 0.25 ? 'rot' : wert < 0.3 ? 'gelb' : wert <= 0.5 ? 'gruen' : 'gelb';
		case 'durchlaufzeit':
			return wert <= 5 ? 'gruen' : wert <= 10 ? 'gelb' : 'rot';
		case 'nacharbeit':
			return wert < 0.03 ? 'gruen' : wert <= 0.05 ? 'gelb' : 'rot';
		case 'zahlungsdauer':
			return wert <= 21 ? 'gruen' : wert < 30 ? 'gelb' : 'rot';
		default:
			return null;
	}
}

/** Kurzer Text zur Ampel (für Kachel und Vorlesen). */
export function ampelText(id: KennzahlId, wert: number | null): string | null {
	const a = ampel(id, wert);
	if (a === null || wert === null) return null;
	if (id === 'abschlussquote') return wert < 0.25 ? 'Angebot oder Zielgruppe falsch' : wert < 0.3 ? 'knapp unter gesund' : wert <= 0.5 ? 'gesund' : 'oft zu günstig';
	if (id === 'nacharbeit') return a === 'gruen' ? 'sehr gut' : a === 'gelb' ? 'wird teuer' : 'teuer';
	if (id === 'zahlungsdauer') return a === 'gruen' ? 'gut' : a === 'gelb' ? 'beobachten' : 'Risiko';
	return a === 'gruen' ? 'im Richtwert' : a === 'gelb' ? 'etwas darüber' : 'deutlich darüber';
}

export type Trend = { richtung: 'hoch' | 'runter' | 'gleich'; differenz: number; gut: boolean | null };

/** Trend gegenüber dem Vorzeitraum (Differenz in der Einheit der Kennzahl; Quoten in Prozentpunkten als Anteil). */
export function trend(id: KennzahlId, wert: number | null, vorher: number | null): Trend | null {
	if (wert === null || vorher === null) return null;
	const d = wert - vorher;
	const schwelle = KENNZAHLEN[id].einheit === 'euro' ? 1 : KENNZAHLEN[id].einheit === 'tage' ? 0.05 : 0.0005;
	const richtung = Math.abs(d) < schwelle ? 'gleich' : d > 0 ? 'hoch' : 'runter';
	const besser = KENNZAHLEN[id].besser;
	const gut = richtung === 'gleich' || besser === null ? null : (richtung === 'hoch') === (besser === 'hoch');
	return { richtung, differenz: d, gut };
}

/** Ergebnis einer Kennzahl für einen Zeitraum. `fehlt` statt Wert, wenn die Grundlage fehlt. */
export type KennzahlWert = {
	wert: number | null;
	/** Zähler/Nenner bzw. Anzahl der Fälle – für „7 von 20“ und Tests. */
	zaehler?: number;
	nenner?: number;
	fehlt: string | null;
	/** Zusätzlicher Hinweis (z. B. Grundlage des Umsatzes). */
	hinweis?: string | null;
};

export type Kennzahl = KennzahlWert & {
	id: KennzahlId;
	/** „erfasst seit TT.MM.JJJJ“, wenn ein Startdatum gesetzt ist (Jamil msg 2946) */
	seit?: string | null;
	info: KennzahlInfo;
	vorher: number | null;
	ampel: Ampel | null;
	ampelText: string | null;
	trend: Trend | null;
};

export function baueKennzahl(id: KennzahlId, jetzt: KennzahlWert, vorher: KennzahlWert | null): Kennzahl {
	const v = vorher?.fehlt ? null : (vorher?.wert ?? null);
	const w = jetzt.fehlt ? null : jetzt.wert;
	return { ...jetzt, wert: w, id, info: KENNZAHLEN[id], vorher: v, ampel: ampel(id, w), ampelText: ampelText(id, w), trend: trend(id, w, v) };
}

/** Anzeige eines Werts (deutsch). */
export function kennzahlText(einheit: Einheit, wert: number | null): string {
	if (wert === null) return '–';
	const zahl = (n: number, s: number) => n.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s });
	switch (einheit) {
		case 'prozent':
			return `${zahl(wert * 100, wert * 100 < 10 && wert !== 0 ? 1 : 0)} %`;
		case 'tage':
			return `${zahl(wert, 1)} Tage`;
		case 'faktor':
			return `${zahl(wert * 100, 0)} %`;
		case 'euro':
			return `${zahl(Math.round(wert / 100), 0)} €`;
	}
}

// ——— Zeitmessung je Vorlagen-Aufgabe (msg 2858) ———

export type AufgabenMessung = { angelegt: string; begonnen: string | null; erledigt: string | null };
export type AufgabenZeiten = { anzahl: number; erledigt: number; durchlaufTage: number | null; warteTage: number | null; bearbeitungTage: number | null };

/** Ø Tage: angelegt → erledigt (Durchlauf), angelegt → begonnen (Warten), begonnen → erledigt (Bearbeitung); nur erledigte. */
export function aufgabenZeiten(liste: readonly AufgabenMessung[]): AufgabenZeiten {
	const fertig = liste.filter((a) => a.erledigt);
	const tage = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / MS_TAG);
	const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
	return {
		anzahl: liste.length,
		erledigt: fertig.length,
		durchlaufTage: r1(schnitt(fertig.map((a) => tage(a.angelegt, a.erledigt!)))),
		warteTage: r1(schnitt(fertig.map((a) => tage(a.angelegt, a.begonnen ?? a.angelegt)))),
		bearbeitungTage: r1(schnitt(fertig.map((a) => tage(a.begonnen ?? a.angelegt, a.erledigt!))))
	};
}

// ——— Einstellungen je Kennzahl (Jamil msg 2946): an/aus und „Erfassen ab“ ———

export type KonfigBereich = 'Cockpit' | 'Kunden' | 'Aufträge' | 'Angebote';
export type KonfigEintrag = { id: string; bereich: KonfigBereich; titel: string; erklaerung: string };

/** Alle einstellbaren Kennzahlen: die sieben des Cockpits und die Kacheln der Übersichtsseiten (auch auf „Start“). */
export const KONFIG_KENNZAHLEN: readonly KonfigEintrag[] = [
	...KENNZAHL_IDS.map((id) => ({ id, bereich: 'Cockpit' as const, titel: KENNZAHLEN[id].titel, erklaerung: KENNZAHLEN[id].formel })),
	{ id: 'kunden_aktiv', bereich: 'Kunden', titel: 'Aktive Kunden', erklaerung: 'Kunden mit offenem Auftrag' },
	{ id: 'kunden_angenommen', bereich: 'Kunden', titel: 'Kunden mit angenommenem Angebot', erklaerung: 'im gewählten Zeitraum' },
	{ id: 'kunden_abgelehnt', bereich: 'Kunden', titel: 'Kunden mit abgelehntem Angebot', erklaerung: 'im gewählten Zeitraum' },
	{ id: 'kunden_abgelaufen', bereich: 'Kunden', titel: 'Kunden mit abgelaufenem Angebot', erklaerung: 'versendet, ohne Antwort, Gültigkeit vorbei' },
	{ id: 'auftraege_status', bereich: 'Aufträge', titel: 'Aufträge je Status', erklaerung: 'neue Aufträge im Zeitraum, je Status' },
	{ id: 'auftraege_nachfassen', bereich: 'Aufträge', titel: 'Nachfassen fällig', erklaerung: 'auch unter „Handlungsbedarf“ auf Start' },
	{ id: 'auftraege_wert', bereich: 'Aufträge', titel: 'Auftragswert offen', erklaerung: 'angenommen, noch nicht abgerechnet (nur mit Preisen)' },
	{ id: 'angebote_entwurf', bereich: 'Angebote', titel: 'Angebots-Entwürfe', erklaerung: 'auch unter „Handlungsbedarf“ auf Start' },
	{ id: 'angebote_offen', bereich: 'Angebote', titel: 'Offene Angebote', erklaerung: 'versendet und noch gültig' },
	{ id: 'angebote_angenommen', bereich: 'Angebote', titel: 'Angenommene Angebote', erklaerung: 'im Zeitraum' },
	{ id: 'angebote_abgelehnt', bereich: 'Angebote', titel: 'Abgelehnte Angebote', erklaerung: 'im Zeitraum' },
	{ id: 'angebote_abgelaufen', bereich: 'Angebote', titel: 'Abgelaufene Angebote', erklaerung: 'auch unter „Handlungsbedarf“ auf Start' },
	{ id: 'angebote_quote', bereich: 'Angebote', titel: 'Annahmequote', erklaerung: 'wie die Abschlussquote im Cockpit' },
	{ id: 'angebote_schnitt', bereich: 'Angebote', titel: 'Ø Angebotswert', erklaerung: 'abgegebene Angebote im Zeitraum (nur mit Preisen)' }
];
export const KONFIG_IDS = KONFIG_KENNZAHLEN.map((k) => k.id);
export const istKonfigId = (w: unknown): w is string => typeof w === 'string' && KONFIG_IDS.includes(w);

/** Einstellung einer Kennzahl; fehlt sie, gilt: an, ohne Startdatum. */
export type KennzahlEinstellung = { aktiv: boolean; ab: string | null };
export type KennzahlEinstellungen = Record<string, KennzahlEinstellung>;
export const STANDARD_EINSTELLUNG: KennzahlEinstellung = { aktiv: true, ab: null };
export const einstellung = (e: KennzahlEinstellungen | null | undefined, id: string): KennzahlEinstellung => e?.[id] ?? STANDARD_EINSTELLUNG;
export const istAktiv = (e: KennzahlEinstellungen | null | undefined, id: string) => einstellung(e, id).aktiv;
export const abTag = (e: KennzahlEinstellungen | null | undefined, id: string) => einstellung(e, id).ab;

/** Nur Datensätze, die am oder nach dem „Erfassen ab“-Tag angelegt wurden (Berliner Tag); ohne Datum: alle. */
export function seit<T>(liste: readonly T[], ab: string | null, angelegt: (x: T) => Date): T[] {
	if (!ab) return [...liste];
	const grenze = Date.parse(`${ab}T00:00:00Z`) - 3 * 3_600_000; // vorsichtig: frühester möglicher Berliner Tagesbeginn (UTC+2)
	return liste.filter((x) => {
		const t = angelegt(x).getTime();
		if (t < grenze) return false;
		return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(angelegt(x)) >= ab;
	});
}

/** „erfasst seit TT.MM.JJJJ“ für die Anzeige (oder null). */
export function seitText(e: KennzahlEinstellungen | null | undefined, id: string): string | null {
	const ab = abTag(e, id);
	if (!ab) return null;
	const [j, m, t] = ab.split('-');
	return `erfasst seit ${t}.${m}.${j}`;
}

/**
 * Kacheln einer Seite an die Einstellungen anpassen: ausgeschaltete weglassen, bei „Erfassen ab“ den Hinweis
 * „erfasst seit …“ an die Info hängen. `konfigId` ordnet die Kachel-ID der Kennzahl zu.
 */
export function mitEinstellungen<T extends { id: string; info?: string | null }>(
	kacheln: readonly T[],
	konfig: { aus: readonly string[]; seit: Readonly<Record<string, string>> },
	konfigId: (kachelId: string) => string
): T[] {
	return kacheln
		.filter((k) => !konfig.aus.includes(konfigId(k.id)))
		.map((k) => {
			const s = konfig.seit[konfigId(k.id)];
			return s ? { ...k, info: k.info ? `${k.info} · ${s}` : s } : k;
		});
}
