import ICAL from 'ical.js';
import { createHash } from 'node:crypto';
import { falte, icsText } from '../../ics';
import { ausTagUndUhrzeit, berlinTag, berlinUhrzeit, berlinZeitpunkt, istTag } from '../../zeit';

/**
 * Aufgabe ↔ VTODO (RFC 5545) – ohne Datenbank, damit beide Richtungen als Unit-Test prüfbar sind.
 *
 * Abbildung (CRM → Handy):
 * - Titel → SUMMARY, Beschreibung → DESCRIPTION
 * - Fällig (Tag) → DUE;VALUE=DATE, mit Uhrzeit → DUE in UTC; Zeitraum (`vonTag`) → DTSTART bis DUE
 *   (beide als Tag, oder – sobald eine Uhrzeit dabei ist – beide als Zeitpunkt: ohne Uhrzeit „von“ 00:00, „bis“ 23:59)
 * - offen → NEEDS-ACTION, „In Arbeit“ (offen mit Fälligkeit, wie im Aufgaben-Board) → IN-PROCESS,
 *   erledigt → COMPLETED mit COMPLETED-Zeitpunkt und PERCENT-COMPLETE:100
 * - Priorität → PRIORITY (1 hoch … 9 niedrig)
 * - eigene, noch offene Erinnerungen → VALARM mit festem Zeitpunkt (TRIGGER;VALUE=DATE-TIME)
 * - Auftrag und Kunde → CATEGORIES; Link ins CRM → URL
 * - wiederkehrende Aufgaben: nur die aktuelle Instanz (kein RRULE) – die nächste entsteht im CRM beim Abhaken und
 *   kommt mit dem nächsten Abgleich aufs Handy. Kategorie „Wiederkehrend“ zeigt, dass es eine Serie ist.
 *
 * Rückweg (Handy → CRM): `leseVtodo` liest SUMMARY, DESCRIPTION, DTSTART/DUE (Tag, UTC, TZID mit mitgeschickter
 * VTIMEZONE, schwebend = Berliner Zeit), STATUS/COMPLETED, PRIORITY und VALARM (fest oder relativ zur Fälligkeit).
 * `aenderungen` vergleicht das Gelesene mit dem, was das CRM selbst ausliefern würde – so werden nur Felder
 * übernommen, die am Handy wirklich geändert wurden (verlustbehaftete Rundreisen ändern nichts).
 */

export type CalAufgabe = {
	id: string;
	uid: string;
	titel: string;
	beschreibung: string | null;
	faellig: string | null;
	faelligZeit: string | null;
	vonTag: string | null;
	vonZeit: string | null;
	/** ISO-Zeitpunkt oder null */
	erledigtAm: string | null;
	prioritaet: number | null;
	auftrag: { id: string; nummer: string | null; titel: string } | null;
	kundeName: string | null;
	wiederkehrend: boolean;
	/** eigene, noch nicht gesendete Erinnerungen (ISO) */
	erinnerungen: string[];
	angelegt: string;
	geaendert: string;
	/** Link ins CRM (absolut) oder null */
	link: string | null;
};

/** Normalisierte Felder, die zwischen CRM und Handy abgeglichen werden. */
export type Felder = {
	titel: string;
	beschreibung: string | null;
	faellig: string | null;
	faelligZeit: string | null;
	vonTag: string | null;
	vonZeit: string | null;
	erledigt: boolean;
	prioritaet: number | null;
	/** Erinnerungen als Zeitpunkte (ms), aufsteigend, ohne Doppelte */
	erinnerungen: number[];
};

export type Gelesen = Felder & { uid: string; wiederholung: boolean };

export const MAX_TITEL = 200;
export const MAX_BESCHREIBUNG = 500;
export const PRODID = '-//waybuild//CRM Aufgaben//DE';

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const tagWert = (tag: string) => tag.replace(/-/g, '');

export class VtodoFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'VtodoFehler';
	}
}

/** Das VCALENDAR einer Aufgabe (CRLF, gefaltet). DTSTAMP = letzte Änderung, damit der Text stabil bleibt. */
export function erzeugeVtodo(t: CalAufgabe): string {
	const z: string[] = [];
	const geaendert = new Date(t.geaendert);
	z.push('BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'BEGIN:VTODO');
	z.push(`UID:${icsText(t.uid)}`);
	z.push(`DTSTAMP:${utc(geaendert)}`, `CREATED:${utc(new Date(t.angelegt))}`, `LAST-MODIFIED:${utc(geaendert)}`);
	z.push(`SUMMARY:${icsText(t.titel)}`);
	if (t.beschreibung) z.push(`DESCRIPTION:${icsText(t.beschreibung)}`);
	if (t.faellig) {
		const mitZeit = t.faelligZeit !== null || (t.vonTag !== null && t.vonZeit !== null);
		if (t.vonTag) {
			if (mitZeit) {
				z.push(`DTSTART:${utc(ausTagUndUhrzeit(t.vonTag, t.vonZeit ?? '00:00'))}`);
				z.push(`DUE:${utc(ausTagUndUhrzeit(t.faellig, t.faelligZeit ?? '23:59'))}`);
			} else {
				z.push(`DTSTART;VALUE=DATE:${tagWert(t.vonTag)}`, `DUE;VALUE=DATE:${tagWert(t.faellig)}`);
			}
		} else if (t.faelligZeit) {
			z.push(`DUE:${utc(ausTagUndUhrzeit(t.faellig, t.faelligZeit))}`);
		} else {
			z.push(`DUE;VALUE=DATE:${tagWert(t.faellig)}`);
		}
	}
	if (t.erledigtAm) {
		z.push('STATUS:COMPLETED', `COMPLETED:${utc(new Date(t.erledigtAm))}`, 'PERCENT-COMPLETE:100');
	} else {
		z.push(`STATUS:${t.faellig ? 'IN-PROCESS' : 'NEEDS-ACTION'}`);
	}
	if (t.prioritaet) z.push(`PRIORITY:${t.prioritaet}`);
	const kategorien: string[] = [];
	if (t.auftrag) kategorien.push(t.auftrag.nummer ? `${t.auftrag.nummer} ${t.auftrag.titel}` : t.auftrag.titel);
	if (t.kundeName) kategorien.push(t.kundeName);
	if (t.wiederkehrend) kategorien.push('Wiederkehrend');
	if (kategorien.length > 0) z.push(`CATEGORIES:${kategorien.map(icsText).join(',')}`);
	if (t.link) z.push(`URL:${t.link.replace(/[\r\n]/g, '')}`);
	for (const e of t.erinnerungen) {
		z.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(t.titel)}`, `TRIGGER;VALUE=DATE-TIME:${utc(new Date(e))}`, 'END:VALARM');
	}
	z.push('END:VTODO', 'END:VCALENDAR');
	return z.map(falte).join('\r\n') + '\r\n';
}

/** Starker ETag aus dem ausgelieferten Text: jede sichtbare Änderung (auch an Auftrag, Kunde, Erinnerung) ändert ihn. */
export function etagVon(ics: string): string {
	return `"${createHash('sha256').update(ics).digest('base64url').slice(0, 27)}"`;
}

// ——— Lesen ———

type Zeitangabe = { tag: string; zeit: string | null };

const zwei = (n: number) => String(n).padStart(2, '0');

function zeitAus(prop: InstanceType<typeof ICAL.Property> | null, zonen: Map<string, InstanceType<typeof ICAL.Component>>): Zeitangabe | null {
	if (!prop) return null;
	const wert = prop.getFirstValue();
	if (!(wert instanceof ICAL.Time)) return null;
	const tag = `${String(wert.year).padStart(4, '0')}-${zwei(wert.month)}-${zwei(wert.day)}`;
	if (!istTag(tag)) return null;
	if (wert.isDate) return { tag, zeit: null };
	const tzid = prop.getParameter('tzid');
	const tz = typeof tzid === 'string' ? tzid : null;
	let zeitpunkt: Date;
	const istUtc = wert.zone === ICAL.Timezone.utcTimezone || wert.zone?.tzid === 'UTC';
	if (tz && zonen.has(tz)) {
		// Zeitzone wie mitgeschickt (VTIMEZONE) – nur lokal benutzt, nie global registriert
		const zone = new ICAL.Timezone({ component: zonen.get(tz), tzid: tz });
		const t = new ICAL.Time({ year: wert.year, month: wert.month, day: wert.day, hour: wert.hour, minute: wert.minute, second: wert.second, isDate: false }, zone);
		zeitpunkt = new Date(t.toUnixTime() * 1000);
	} else if (istUtc && !tz) {
		zeitpunkt = new Date(Date.UTC(wert.year, wert.month - 1, wert.day, wert.hour, wert.minute, wert.second));
	} else {
		// schwebend oder unbekannte TZID ohne VTIMEZONE: als Berliner Wanduhr-Zeit
		zeitpunkt = berlinZeitpunkt(tag, wert.hour, wert.minute);
	}
	if (Number.isNaN(zeitpunkt.getTime())) return null;
	return { tag: berlinTag(zeitpunkt), zeit: berlinUhrzeit(zeitpunkt) };
}

const momentVon = (z: Zeitangabe | null): number | null => (z ? ausTagUndUhrzeit(z.tag, z.zeit ?? '08:00').getTime() : null);

function kuerze(text: string, max: number): string {
	const zeichen = [...text];
	return zeichen.length > max ? zeichen.slice(0, max).join('').trimEnd() : text;
}

function textWert(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
	return t === '' ? null : t;
}

/**
 * Liest das (erste) VTODO aus einem VCALENDAR. Wirft `VtodoFehler`, wenn der Text kein gültiges iCalendar ist oder kein
 * VTODO enthält. Zu lange Texte werden gekürzt (statt die Speicherung am Handy scheitern zu lassen).
 */
export function leseVtodo(text: string): Gelesen {
	let kal: InstanceType<typeof ICAL.Component>;
	try {
		kal = new ICAL.Component(ICAL.parse(text));
	} catch {
		throw new VtodoFehler('Kein gültiges iCalendar.');
	}
	if (kal.name !== 'vcalendar') throw new VtodoFehler('Kein VCALENDAR.');
	const todos = kal.getAllSubcomponents('vtodo');
	if (todos.length === 0) throw new VtodoFehler('Kein VTODO enthalten.');
	if (kal.getAllSubcomponents('vevent').length > 0) throw new VtodoFehler('Nur Aufgaben (VTODO) erlaubt.');
	const uids = new Set(todos.map((t) => String(t.getFirstPropertyValue('uid') ?? '')));
	if (uids.size !== 1) throw new VtodoFehler('Genau eine Aufgabe (UID) je Datei.');
	// Ausnahmen (RECURRENCE-ID) ignorieren: die Hauptkomponente zählt
	const v = todos.find((t) => !t.hasProperty('recurrence-id')) ?? todos[0];
	const uid = String(v.getFirstPropertyValue('uid') ?? '').trim();
	if (uid === '' || uid.length > 255) throw new VtodoFehler('UID fehlt oder ist zu lang.');
	const zonen = new Map<string, InstanceType<typeof ICAL.Component>>();
	for (const z of kal.getAllSubcomponents('vtimezone')) {
		const id = z.getFirstPropertyValue('tzid');
		if (typeof id === 'string' && zonen.size < 10) zonen.set(id, z);
	}

	const titel = kuerze(textWert(v.getFirstPropertyValue('summary')) ?? '(ohne Titel)', MAX_TITEL).replace(/\n/g, ' ');
	const besch = textWert(v.getFirstPropertyValue('description'));
	const beschreibung = besch === null ? null : kuerze(besch, MAX_BESCHREIBUNG);

	let due = zeitAus(v.getFirstProperty('due'), zonen);
	let start = zeitAus(v.getFirstProperty('dtstart'), zonen);
	if (!due && start) {
		// Nur Beginn: als Fälligkeit (das CRM kennt keinen Beginn ohne Ende)
		due = start;
		start = null;
	}
	let vonTag: string | null = null;
	let vonZeit: string | null = null;
	if (due && start) {
		const s = momentVon({ tag: start.tag, zeit: start.zeit ?? '00:00' })!;
		const e = momentVon({ tag: due.tag, zeit: due.zeit ?? '23:59' })!;
		// iPhone schreibt oft DTSTART = DUE (gleicher Tag bzw. gleicher Zeitpunkt): das ist kein Zeitraum
		const gleich = start.tag === due.tag && (start.zeit === null || start.zeit === due.zeit);
		if (s <= e && !gleich) {
			vonTag = start.tag;
			vonZeit = start.zeit;
		}
	}

	const status = String(v.getFirstPropertyValue('status') ?? '').toUpperCase();
	const erledigt = status === 'COMPLETED' || (status === '' && v.hasProperty('completed'));

	const prio = Number(v.getFirstPropertyValue('priority'));
	const prioritaet = Number.isInteger(prio) && prio >= 1 && prio <= 9 ? prio : null;

	// Erinnerungen: fester Zeitpunkt oder relativ (RELATED=END → Fälligkeit, sonst Beginn bzw. Fälligkeit)
	const alarme = new Set<number>();
	for (const a of v.getAllSubcomponents('valarm').slice(0, 20)) {
		const aktion = String(a.getFirstPropertyValue('action') ?? '').toUpperCase();
		if (aktion === 'NONE') continue;
		const trigger = a.getFirstProperty('trigger');
		if (!trigger) continue;
		const w = trigger.getFirstValue();
		if (w instanceof ICAL.Time) {
			const z = zeitAus(trigger, zonen);
			if (z && z.zeit) alarme.add(ausTagUndUhrzeit(z.tag, z.zeit).getTime());
		} else if (w instanceof ICAL.Duration) {
			const bezug = String(trigger.getParameter('related') ?? 'START').toUpperCase();
			const anker = bezug === 'END' ? momentVon(due) : (momentVon(vonTag ? { tag: vonTag, zeit: vonZeit } : null) ?? momentVon(due));
			if (anker !== null) alarme.add(anker + w.toSeconds() * 1000);
		}
	}

	return {
		uid,
		titel,
		beschreibung,
		faellig: due?.tag ?? null,
		faelligZeit: due?.zeit ?? null,
		vonTag,
		vonZeit,
		erledigt,
		prioritaet,
		erinnerungen: [...alarme].map((ms) => Math.floor(ms / 60_000) * 60_000).filter((x, i, l) => l.indexOf(x) === i).sort((a, b) => a - b),
		wiederholung: v.hasProperty('rrule')
	};
}

/** Felder einer CRM-Aufgabe so, wie sie nach einer Rundreise über das Handy aussehen. */
export function felderVon(t: CalAufgabe): Felder {
	const { uid: _u, wiederholung: _w, ...f } = leseVtodo(erzeugeVtodo(t));
	return f;
}

export type Aenderung = Partial<Omit<Felder, 'faelligZeit' | 'vonTag' | 'vonZeit'>> & {
	/** Fälligkeit/Zeitraum als Ganzes (wenn sich etwas daran geändert hat) */
	zeit?: { faellig: string | null; faelligZeit: string | null; vonTag: string | null; vonZeit: string | null };
};

/** Was hat das Handy gegenüber dem Stand im CRM geändert? Leeres Objekt = nichts. */
export function aenderungen(alt: Felder, neu: Felder): Aenderung {
	const a: Aenderung = {};
	if (alt.titel !== neu.titel) a.titel = neu.titel;
	if (alt.beschreibung !== neu.beschreibung) a.beschreibung = neu.beschreibung;
	if (alt.faellig !== neu.faellig || alt.faelligZeit !== neu.faelligZeit || alt.vonTag !== neu.vonTag || alt.vonZeit !== neu.vonZeit) {
		a.zeit = { faellig: neu.faellig, faelligZeit: neu.faelligZeit, vonTag: neu.vonTag, vonZeit: neu.vonZeit };
	}
	if (alt.erledigt !== neu.erledigt) a.erledigt = neu.erledigt;
	if (alt.prioritaet !== neu.prioritaet) a.prioritaet = neu.prioritaet;
	if (JSON.stringify(alt.erinnerungen) !== JSON.stringify(neu.erinnerungen)) a.erinnerungen = neu.erinnerungen;
	return a;
}
