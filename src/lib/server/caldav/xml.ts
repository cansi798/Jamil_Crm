import { SaxesParser } from 'saxes';

/**
 * XML für CalDAV/WebDAV – Einlesen gehärtet und Ausgabe mit festen Präfixen.
 *
 * Einlesen (`leseXml`): Parser `saxes` mit Namensräumen. Er kennt nur die fünf vordefinierten Entitäten und
 * Zeichenreferenzen und lädt nie etwas nach. Zusätzlich gilt: kein DOCTYPE (damit weder XXE noch Entitäten-Bomben),
 * keine Verarbeitungsanweisungen außer der XML-Deklaration, höchstens `MAX_BYTES` Text, `MAX_ELEMENTE` Elemente und
 * Verschachtelungstiefe `MAX_TIEFE`. Jeder Verstoß ist ein `XmlFehler` (→ 400).
 */

export const NS = {
	dav: 'DAV:',
	caldav: 'urn:ietf:params:xml:ns:caldav',
	cs: 'http://calendarserver.org/ns/',
	apple: 'http://apple.com/ns/ical/'
} as const;

export const MAX_BYTES = 256 * 1024;
export const MAX_ELEMENTE = 5000;
export const MAX_TIEFE = 40;

export class XmlFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'XmlFehler';
	}
}

export type Element = {
	ns: string;
	name: string;
	attrs: Record<string, string>;
	kinder: Element[];
	text: string;
};

/** Liest ein XML-Dokument; leerer Text → `null`. */
export function leseXml(text: string): Element | null {
	if (text.trim() === '') return null;
	if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new XmlFehler('XML zu groß');
	// Grobe Vorprüfung (auch für Varianten in anderer Schreibweise): DOCTYPE und ENTITY sind nie erlaubt
	if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new XmlFehler('DOCTYPE ist nicht erlaubt');
	const parser = new SaxesParser({ xmlns: true, position: false });
	const stapel: Element[] = [];
	let wurzel: Element | null = null;
	let anzahl = 0;
	let fehler: Error | null = null;
	parser.on('doctype', () => {
		throw new XmlFehler('DOCTYPE ist nicht erlaubt');
	});
	parser.on('processinginstruction', () => {
		throw new XmlFehler('Verarbeitungsanweisungen sind nicht erlaubt');
	});
	parser.on('opentag', (tag) => {
		anzahl += 1;
		if (anzahl > MAX_ELEMENTE) throw new XmlFehler('Zu viele XML-Elemente');
		if (stapel.length >= MAX_TIEFE) throw new XmlFehler('XML zu tief verschachtelt');
		const attrs: Record<string, string> = {};
		for (const a of Object.values(tag.attributes)) {
			if (typeof a === 'object' && a !== null && 'local' in a) {
				if (a.prefix === 'xmlns' || a.name === 'xmlns') continue;
				attrs[a.local] = a.value;
			}
		}
		const el: Element = { ns: tag.uri ?? '', name: tag.local ?? tag.name, attrs, kinder: [], text: '' };
		const eltern = stapel[stapel.length - 1];
		if (eltern) eltern.kinder.push(el);
		else if (wurzel) throw new XmlFehler('Mehr als ein Wurzelelement');
		else wurzel = el;
		stapel.push(el);
	});
	parser.on('text', (t) => {
		const el = stapel[stapel.length - 1];
		if (el) el.text += t;
	});
	parser.on('cdata', (t) => {
		const el = stapel[stapel.length - 1];
		if (el) el.text += t;
	});
	parser.on('closetag', () => {
		stapel.pop();
	});
	parser.on('error', (e) => {
		fehler = e;
	});
	try {
		parser.write(text).close();
	} catch (e) {
		if (e instanceof XmlFehler) throw e;
		throw new XmlFehler('XML ungültig');
	}
	if (fehler || !wurzel) throw new XmlFehler('XML ungültig');
	return wurzel;
}

/** Erstes Kind mit Namensraum und Namen. */
export function kind(el: Element | null | undefined, ns: string, name: string): Element | undefined {
	return el?.kinder.find((k) => k.ns === ns && k.name === name);
}

export function kinder(el: Element | null | undefined, ns: string, name: string): Element[] {
	return el?.kinder.filter((k) => k.ns === ns && k.name === name) ?? [];
}

// ——— Ausgabe ———

export function esc(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

const PRAEFIX: Record<string, string> = { [NS.dav]: 'd', [NS.caldav]: 'c', [NS.cs]: 'cs', [NS.apple]: 'ic' };

/** Eine Eigenschaft (Namensraum + Name) als Schlüssel `{ns}name`. */
export type Eigenschaft = { ns: string; name: string };
export const schluessel = (e: Eigenschaft) => `{${e.ns}}${e.name}`;

const NAME = /^[A-Za-z_][A-Za-z0-9._-]{0,100}$/;

/** Start- und Endtag für eine Eigenschaft; fremde Namensräume bekommen eine eigene Deklaration. */
export function tag(e: Eigenschaft): { auf: string; zu: string; leer: string } {
	const name = NAME.test(e.name) ? e.name : 'unbekannt';
	const p = PRAEFIX[e.ns];
	if (p) return { auf: `<${p}:${name}>`, zu: `</${p}:${name}>`, leer: `<${p}:${name}/>` };
	if (e.ns === '') return { auf: `<${name}>`, zu: `</${name}>`, leer: `<${name}/>` };
	const x = `x:${name} xmlns:x="${esc(e.ns)}"`;
	return { auf: `<${x}>`, zu: `</x:${name}>`, leer: `<${x}/>` };
}

/** Eine Antwort im Multistatus: gefundene Eigenschaften (200) und unbekannte (404). */
export type PropAntwort = { href: string; gefunden: [Eigenschaft, string][]; fehlend: Eigenschaft[] };

const KOPF = `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">`;

export function propResponse(a: PropAntwort): string {
	let s = `<d:response><d:href>${esc(a.href)}</d:href>`;
	if (a.gefunden.length > 0) {
		s += '<d:propstat><d:prop>';
		for (const [e, inhalt] of a.gefunden) {
			const t = tag(e);
			s += inhalt === '' ? t.leer : t.auf + inhalt + t.zu;
		}
		s += '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>';
	}
	if (a.fehlend.length > 0) {
		s += '<d:propstat><d:prop>';
		for (const e of a.fehlend) s += tag(e).leer;
		s += '</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>';
	}
	return s + '</d:response>';
}

export function statusResponse(href: string, status: string): string {
	return `<d:response><d:href>${esc(href)}</d:href><d:status>HTTP/1.1 ${status}</d:status></d:response>`;
}

export function multistatus(antworten: string[], zusatz = ''): string {
	return `${KOPF}${antworten.join('')}${zusatz}</d:multistatus>`;
}

/** Fehlerkörper mit Vorbedingung (z. B. `<d:valid-sync-token/>`). */
export function fehlerXml(vorbedingung: Eigenschaft): string {
	return `<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${tag(vorbedingung).leer}</d:error>`;
}
