/**
 * Wiederkehrende Aufgaben (Wunsch Jamil, msg 2501): Regel täglich / wöchentlich / monatlich / jährlich, „alle N“,
 * optional Enddatum. Reine Datumsrechnung auf Kalendertagen (YYYY-MM-DD, ohne Uhrzeit/Zeitzone).
 *
 * Monatlich/jährlich rechnet immer vom Starttag der Serie aus (31.01. → 28.02. → 31.03. …), damit der Tag am
 * Monatsende nicht dauerhaft auf den 28. „wandert“. Wird eine Aufgabe erst nach seinem Termin abgehakt, überspringt die
 * Serie verpasste Termine: Der nächste liegt nach `heute`.
 */

export const REGELN = ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich'] as const;
export type Regel = (typeof REGELN)[number];

export const REGEL_NAMEN: Record<Regel, string> = {
	taeglich: 'täglich',
	woechentlich: 'wöchentlich',
	monatlich: 'monatlich',
	jaehrlich: 'jährlich'
};
const EINHEIT: Record<Regel, [string, string]> = {
	taeglich: ['Tag', 'Tage'],
	woechentlich: ['Woche', 'Wochen'],
	monatlich: ['Monat', 'Monate'],
	jaehrlich: ['Jahr', 'Jahre']
};

export const istRegel = (w: unknown): w is Regel => typeof w === 'string' && (REGELN as readonly string[]).includes(w);

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const alsDatum = (tag: string) => new Date(`${tag}T00:00:00Z`);
const alsTag = (d: Date) => d.toISOString().slice(0, 10);
const tageImMonat = (jahr: number, monat0: number) => new Date(Date.UTC(jahr, monat0 + 1, 0)).getUTCDate();

/** n-ter Termin der Serie ab `startTag` (n = 0 ist der Starttag). */
function terminNr(startTag: string, regel: Regel, intervall: number, n: number): string {
	const s = alsDatum(startTag);
	if (regel === 'taeglich' || regel === 'woechentlich') {
		const tage = n * intervall * (regel === 'woechentlich' ? 7 : 1);
		return alsTag(new Date(s.getTime() + tage * 86_400_000));
	}
	const monate = n * intervall * (regel === 'jaehrlich' ? 12 : 1);
	const ziel = s.getUTCMonth() + monate;
	const jahr = s.getUTCFullYear() + Math.floor(ziel / 12);
	const monat0 = ((ziel % 12) + 12) % 12;
	const tag = Math.min(s.getUTCDate(), tageImMonat(jahr, monat0));
	return alsTag(new Date(Date.UTC(jahr, monat0, tag)));
}

/**
 * Nächster Termin nach `letzter` (dem Termin des gerade abgehakten Aufgaben) – und nach `heute`, falls angegeben
 * (verpasste Termine werden übersprungen).
 */
export function naechsterTermin(
	letzter: string,
	serie: { regel: Regel; intervall: number; startTag: string },
	heute?: string
): string {
	const grenze = heute && heute > letzter ? heute : letzter;
	// Schritt-Schätzung, dann sicher vorwärts zählen
	let n = 1;
	if (serie.regel === 'taeglich' || serie.regel === 'woechentlich') {
		const schritt = serie.intervall * (serie.regel === 'woechentlich' ? 7 : 1);
		n = Math.max(1, Math.floor((alsDatum(grenze).getTime() - alsDatum(serie.startTag).getTime()) / 86_400_000 / schritt));
	} else {
		const g = alsDatum(grenze);
		const s = alsDatum(serie.startTag);
		const monate = (g.getUTCFullYear() - s.getUTCFullYear()) * 12 + g.getUTCMonth() - s.getUTCMonth();
		n = Math.max(1, Math.floor(monate / (serie.intervall * (serie.regel === 'jaehrlich' ? 12 : 1))));
	}
	while (n > 1 && terminNr(serie.startTag, serie.regel, serie.intervall, n - 1) > grenze) n--;
	let t = terminNr(serie.startTag, serie.regel, serie.intervall, n);
	while (t <= grenze) t = terminNr(serie.startTag, serie.regel, serie.intervall, ++n);
	return t;
}

export type RegelWerte = { regel: Regel; intervall: number; ende: string | null };

/** Prüft Eingaben aus Formular/API; Fehler als `Error` mit deutscher Meldung (Aufrufer machen 400 daraus). */
export function pruefeRegel(e: { regel?: unknown; intervall?: unknown; ende?: unknown }, startTag: string): RegelWerte {
	if (!istRegel(e.regel)) throw new Error('Wiederholung: Bitte täglich, wöchentlich, monatlich oder jährlich wählen.');
	const roh = e.intervall === undefined || e.intervall === null || e.intervall === '' ? 1 : e.intervall;
	const intervall = typeof roh === 'string' && /^\s*\d+\s*$/.test(roh) ? Number(roh) : roh;
	if (typeof intervall !== 'number' || !Number.isInteger(intervall) || intervall < 1 || intervall > 365) {
		throw new Error('Wiederholung: „alle …“ muss eine Zahl von 1 bis 365 sein.');
	}
	let ende: string | null = null;
	if (e.ende !== undefined && e.ende !== null && e.ende !== '') {
		if (typeof e.ende !== 'string' || !TAG.test(e.ende)) throw new Error('Wiederholung: Das Ende ist kein gültiges Datum.');
		if (e.ende < startTag) throw new Error('Wiederholung: Das Ende liegt vor dem ersten Termin.');
		ende = e.ende;
	}
	return { regel: e.regel, intervall, ende };
}

const deutsch = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;

/** „täglich“, „alle 2 Wochen“, „monatlich bis 30.06.2027“. */
export function regelText(regel: Regel, intervall: number, ende: string | null): string {
	const basis = intervall === 1 ? REGEL_NAMEN[regel] : `alle ${intervall} ${EINHEIT[regel][1]}`;
	return ende ? `${basis} bis ${deutsch(ende)}` : basis;
}
