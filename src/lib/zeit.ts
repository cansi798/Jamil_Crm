/**
 * Kalendertage, Wochen und Uhrzeiten in Europe/Berlin – ohne Serverbezug (auch für die Oberfläche) und ohne Paket:
 * Die Umrechnung nutzt `Intl.DateTimeFormat` mit fester Zeitzone. Gespeichert werden Zeitpunkte (UTC, `timestamptz`);
 * was ein „Tag“, eine „Woche“ (Montag–Sonntag) oder „heute“ ist, gilt immer in Berliner Zeit – unabhängig von der
 * Zeitzone des Servers oder des Geräts. Tage sind Zeichenketten `YYYY-MM-DD`.
 */

export const ZEITZONE = 'Europe/Berlin';

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_TAG = 86_400_000;

const teileFormat = new Intl.DateTimeFormat('de-DE', {
	timeZone: ZEITZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

type Teile = { jahr: number; monat: number; tag: number; stunde: number; minute: number; sekunde: number };

/** Berliner Wanduhr-Zeit eines Zeitpunkts. */
function berlinTeile(d: Date): Teile {
	const t: Record<string, number> = {};
	for (const p of teileFormat.formatToParts(d)) {
		if (p.type !== 'literal') t[p.type] = Number(p.value);
	}
	return { jahr: t.year, monat: t.month, tag: t.day, stunde: t.hour % 24, minute: t.minute, sekunde: t.second };
}

/** Abstand Berlin − UTC in Millisekunden zum Zeitpunkt `ms` (3 600 000 im Winter, 7 200 000 im Sommer). */
function versatz(ms: number): number {
	const t = berlinTeile(new Date(ms));
	const wand = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde);
	return wand - Math.floor(ms / 1000) * 1000;
}

const zwei = (n: number) => String(n).padStart(2, '0');
const alsTag = (jahr: number, monat: number, tag: number) => `${String(jahr).padStart(4, '0')}-${zwei(monat)}-${zwei(tag)}`;

/** Zerlegt `YYYY-MM-DD`; wirft bei Unsinn (auch 30. Februar). */
function zerlege(tag: string): { jahr: number; monat: number; tag: number } {
	const m = TAG.exec(tag);
	if (!m) throw new RangeError(`Ungültiger Tag: ${tag}`);
	const [jahr, monat, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(Date.UTC(jahr, monat - 1, t));
	if (d.getUTCFullYear() !== jahr || d.getUTCMonth() !== monat - 1 || d.getUTCDate() !== t) {
		throw new RangeError(`Ungültiger Tag: ${tag}`);
	}
	return { jahr, monat, tag: t };
}

/** Ist `w` ein gültiger Tag `YYYY-MM-DD`? */
export function istTag(w: unknown): w is string {
	if (typeof w !== 'string') return false;
	try {
		zerlege(w);
		return true;
	} catch {
		return false;
	}
}

/** Kalendertag eines Zeitpunkts in Berlin. */
export function berlinTag(d: Date): string {
	const t = berlinTeile(d);
	return alsTag(t.jahr, t.monat, t.tag);
}

/** Berliner Uhrzeit `HH:MM`. */
export function berlinUhrzeit(d: Date): string {
	const t = berlinTeile(d);
	return `${zwei(t.stunde)}:${zwei(t.minute)}`;
}

/**
 * Zeitpunkt zu einer Berliner Wanduhr-Zeit. In der Herbst-Umstellungsnacht (02:00–03:00 doppelt) gilt die erste
 * (Sommerzeit-)Stunde; eine Uhrzeit in der Frühjahrs-Lücke (02:00–03:00 gibt es nicht) rückt um eine Stunde vor
 * (29.03. 02:30 → 03:30 Sommerzeit).
 */
export function berlinZeitpunkt(tag: string, stunde = 0, minute = 0, sekunde = 0, millis = 0): Date {
	const t = zerlege(tag);
	const wand = Date.UTC(t.jahr, t.monat - 1, t.tag, stunde, minute, sekunde, millis);
	// Mögliche Abstände zu UTC rund um diese Zeit (vor und nach einer Umstellung)
	const kandidaten = [...new Set([versatz(wand - 12 * 3_600_000), versatz(wand + 12 * 3_600_000)])];
	// Passt ein Abstand zu sich selbst, gibt es die Wanduhr-Zeit; bei zwei Treffern (Herbst) die frühere = größerer Abstand
	const passend = kandidaten.filter((v) => versatz(wand - v) === v);
	const v = passend.length > 0 ? Math.max(...passend) : Math.min(...kandidaten);
	return new Date(wand - v);
}

/** `HH:MM` eines Tages in Berlin als Zeitpunkt (z. B. aus einem Formular); wirft bei ungültiger Uhrzeit. */
export function ausTagUndUhrzeit(tag: string, uhrzeit: string): Date {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(uhrzeit);
	if (!m) throw new RangeError(`Ungültige Uhrzeit: ${uhrzeit}`);
	return berlinZeitpunkt(tag, Number(m[1]), Number(m[2]));
}

/** Berliner Mitternacht bis zur nächsten Mitternacht (halboffen; 23 bzw. 25 Stunden an Umstellungstagen). */
export function tagesGrenzen(tag: string): { beginn: Date; ende: Date } {
	return { beginn: berlinZeitpunkt(tag), ende: berlinZeitpunkt(tagPlus(tag, 1)) };
}

/** Tag ± n Kalendertage. */
export function tagPlus(tag: string, n: number): string {
	const t = zerlege(tag);
	const d = new Date(Date.UTC(t.jahr, t.monat - 1, t.tag) + n * MS_TAG);
	return alsTag(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Wochentag 0 = Montag … 6 = Sonntag. */
export function wochentag(tag: string): number {
	const t = zerlege(tag);
	return (new Date(Date.UTC(t.jahr, t.monat - 1, t.tag)).getUTCDay() + 6) % 7;
}

/** Die 7 Tage (Montag–Sonntag) der Woche, die `tag` enthält. */
export function wocheVon(tag: string): string[] {
	const montag = tagPlus(tag, -wochentag(tag));
	return Array.from({ length: 7 }, (_, i) => tagPlus(montag, i));
}

/** Verschiebt einen Zeitraum auf `zielTag`: gleiche Berliner Uhrzeit des Beginns, gleiche Dauer. */
export function verschiebeAufTag(beginn: Date, ende: Date, zielTag: string): { beginn: Date; ende: Date } {
	const t = berlinTeile(beginn);
	const neu = berlinZeitpunkt(zielTag, t.stunde, t.minute, t.sekunde, beginn.getTime() % 1000);
	return { beginn: neu, ende: new Date(neu.getTime() + (ende.getTime() - beginn.getTime())) };
}

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Kopf einer Tagesspalte: „Mo 19.10.“. */
export function tagKurz(tag: string): string {
	const t = zerlege(tag);
	return `${WOCHENTAGE_KURZ[wochentag(tag)]} ${zwei(t.tag)}.${zwei(t.monat)}.`;
}

/** „19.10.2026“. */
export function tagDeutsch(tag: string): string {
	const t = zerlege(tag);
	return `${zwei(t.tag)}.${zwei(t.monat)}.${t.jahr}`;
}

/** Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag des Jahres ist KW 1). */
export function kalenderwoche(tag: string): number {
	const donnerstag = tagPlus(tag, 3 - wochentag(tag));
	const jahr = donnerstag.slice(0, 4);
	const t = zerlege(donnerstag);
	const tagImJahr = (Date.UTC(t.jahr, t.monat - 1, t.tag) - Date.UTC(Number(jahr), 0, 1)) / MS_TAG;
	return Math.floor(tagImJahr / 7) + 1;
}
