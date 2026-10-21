import type { RequestEvent } from '@sveltejs/kit';
import { ApiFehler } from '../fehler';
import { darfEines, istNurLesen } from '../tarif';
import { todoSichtVon } from '../todos';
import { ipVon } from '../buchung-anfrage';
import { leseBasic, meldeMitAppPasswortAn } from './app-passwoerter';
import {
	aktuellerStand,
	ctagVon,
	darfBearbeiten,
	inhalt,
	ladeStand,
	loesche,
	sammlung,
	sammlungen,
	speichere,
	Vorbedingung,
	type Objekt,
	type Sammlung,
	type Sitzung
} from './daten';
import { leseVtodo, VtodoFehler } from './vtodo';
import {
	esc,
	fehlerXml,
	kind,
	kinder,
	leseXml,
	MAX_BYTES,
	multistatus,
	NS,
	propResponse,
	schluessel,
	statusResponse,
	tag,
	XmlFehler,
	type Eigenschaft,
	type Element
} from './xml';

/**
 * CalDAV-Server für Aufgaben (RFC 4791, VTODO; Abgleich nach RFC 6578) unter `/caldav/` – genug für die Erinnerungen-
 * App (iPhone/Mac), DAVx⁵ mit Tasks.org/jtx (Android) und Thunderbird.
 *
 * Aufbau:
 *   /caldav/                              Einstieg (zeigt auf den eigenen Principal)
 *   /caldav/nutzer/<id>/                  Principal (calendar-home-set)
 *   /caldav/listen/<id>/                  Kalender-Ordner mit den Listen
 *   /caldav/listen/<id>/meine/            „Meine Aufgaben (CRM)“
 *   /caldav/listen/<id>/auftrag-<uuid>/   eine Liste je Auftrag (nur wenn eingeschaltet)
 *   /caldav/listen/<id>/<liste>/<name>.ics  eine Aufgabe
 *
 * Anmeldung: HTTP Basic mit E-Mail und App-Passwort, nur über HTTPS (lokal auch http für Tests). Fremde IDs im Pfad
 * sind 404. Nur-Lesezugriff des Betriebs sperrt jedes Schreiben (403).
 */

export const BASIS = '/caldav/';
const REALM = 'Basic realm="CRM Aufgaben", charset="UTF-8"';
const ERLAUBT = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT';
const DAV_KOPF = '1, 3, calendar-access';
const XML_TYP = 'application/xml; charset=utf-8';
const ICS_TYP = 'text/calendar; charset=utf-8';

type Ziel =
	| { art: 'wurzel' }
	| { art: 'principals' }
	| { art: 'principal' }
	| { art: 'heim' }
	| { art: 'liste'; sammlung: string }
	| { art: 'objekt'; sammlung: string; name: string };

const antwort = (status: number, koerper: string | null, kopf: Record<string, string> = {}) =>
	new Response(koerper, { status, headers: { 'cache-control': 'no-store', ...kopf } });
const text = (status: number, t: string, kopf: Record<string, string> = {}) =>
	antwort(status, t, { 'content-type': 'text/plain; charset=utf-8', ...kopf });
const xml = (status: number, x: string) => antwort(status, x, { 'content-type': XML_TYP });

/** Pfad (ab /caldav/) → Ziel; `null` für Unbekanntes oder fremde Benutzer. */
export function zielVon(pfad: string, benutzerId: string): Ziel | null {
	if (!pfad.startsWith('/caldav')) return null;
	let teile: string[];
	try {
		teile = pfad.slice('/caldav'.length).split('/').filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	if (teile.length === 0) return { art: 'wurzel' };
	const [bereich, id, liste, name, ...rest] = teile;
	if (rest.length > 0) return null;
	if (bereich === 'nutzer') {
		if (id === undefined) return { art: 'principals' };
		return id === benutzerId && liste === undefined ? { art: 'principal' } : null;
	}
	if (bereich !== 'listen' || id !== benutzerId) return null;
	if (liste === undefined) return { art: 'heim' };
	if (name === undefined) return { art: 'liste', sammlung: liste };
	return { art: 'objekt', sammlung: liste, name };
}

const href = {
	principal: (id: string) => `${BASIS}nutzer/${id}/`,
	heim: (id: string) => `${BASIS}listen/${id}/`,
	liste: (id: string, s: string) => `${BASIS}listen/${id}/${encodeURIComponent(s)}/`,
	objekt: (id: string, s: string, n: string) => `${BASIS}listen/${id}/${encodeURIComponent(s)}/${encodeURIComponent(n)}`
};

const E = (ns: string, name: string): Eigenschaft => ({ ns, name });
const D = (name: string) => E(NS.dav, name);
const C = (name: string) => E(NS.caldav, name);

/** Eigenschaften für „allprop“ bzw. ohne Körper. */
const ALLPROP = [D('resourcetype'), D('displayname'), D('getetag'), D('getcontenttype'), D('getlastmodified'), D('getcontentlength'), D('current-user-principal'), D('owner'), D('sync-token')];

const hrefXml = (h: string) => `<d:href>${esc(h)}</d:href>`;

function privilegien(s: Sitzung, liste: boolean): string {
	const p = ['read', 'read-current-user-privilege-set', 'write', 'write-content', 'write-properties'];
	if (liste && darfBearbeiten(s)) p.push('bind', 'unbind');
	return p.map((x) => `<d:privilege><d:${x}/></d:privilege>`).join('');
}

const BERICHTE = ['<c:calendar-multiget/>', '<c:calendar-query/>', '<d:sync-collection/>']
	.map((r) => `<d:supported-report><d:report>${r}</d:report></d:supported-report>`)
	.join('');

const http = (d: Date) => d.toUTCString();

type Wert = string | undefined;

/** Werte je Ressource; `undefined` = gibt es hier nicht (404 im propstat). */
async function werte(s: Sitzung, ziel: Ziel, e: Eigenschaft, extra: { liste?: Sammlung; objekte?: Map<string, Objekt>; objekt?: Objekt; token?: () => Promise<string> }): Promise<Wert> {
	const id = s.k.benutzerId;
	const k = schluessel(e);
	// überall
	if (k === `{${NS.dav}}current-user-principal`) return hrefXml(href.principal(id));
	if (k === `{${NS.dav}}principal-collection-set`) return hrefXml(`${BASIS}nutzer/`);
	switch (ziel.art) {
		case 'wurzel':
		case 'principals':
			if (k === `{${NS.dav}}resourcetype`) return '<d:collection/>';
			if (k === `{${NS.dav}}displayname`) return 'CRM';
			return undefined;
		case 'principal':
			if (k === `{${NS.dav}}resourcetype`) return '<d:principal/>';
			if (k === `{${NS.dav}}displayname`) return esc(s.nutzer.name);
			if (k === `{${NS.dav}}principal-URL`) return hrefXml(href.principal(id));
			if (k === `{${NS.caldav}}calendar-home-set`) return hrefXml(href.heim(id));
			if (k === `{${NS.caldav}}calendar-user-address-set`) return hrefXml(`mailto:${s.nutzer.email}`) + hrefXml(href.principal(id));
			if (k === `{${NS.dav}}supported-report-set`) return '';
			return undefined;
		case 'heim':
			if (k === `{${NS.dav}}resourcetype`) return '<d:collection/>';
			if (k === `{${NS.dav}}displayname`) return 'Aufgaben';
			if (k === `{${NS.dav}}owner`) return hrefXml(href.principal(id));
			if (k === `{${NS.dav}}current-user-privilege-set`) return privilegien(s, false);
			return undefined;
		case 'liste': {
			const l = extra.liste!;
			if (k === `{${NS.dav}}resourcetype`) return '<d:collection/><c:calendar/>';
			if (k === `{${NS.dav}}displayname`) return esc(l.name);
			if (k === `{${NS.caldav}}calendar-description`) return esc(l.auftragId ? `Aufgaben zum Auftrag ${l.name}` : 'Meine Aufgaben aus dem CRM');
			if (k === `{${NS.caldav}}supported-calendar-component-set`) return '<c:comp name="VTODO"/>';
			if (k === `{${NS.caldav}}supported-calendar-data`) return '<c:calendar-data content-type="text/calendar" version="2.0"/>';
			if (k === `{${NS.caldav}}max-resource-size`) return String(MAX_BYTES);
			if (k === `{${NS.dav}}owner`) return hrefXml(href.principal(id));
			if (k === `{${NS.dav}}current-user-privilege-set`) return privilegien(s, true);
			if (k === `{${NS.dav}}supported-report-set`) return BERICHTE;
			if (k === `{${NS.dav}}sync-token`) return esc(syncToken(await extra.token!()));
			if (k === `{${NS.cs}}getctag`) return esc(ctagVon(extra.objekte!));
			if (k === `{${NS.apple}}calendar-color`) return '#C3A56FFF';
			if (k === `{${NS.apple}}calendar-order`) return l.auftragId ? '2' : '1';
			if (k === `{${NS.dav}}getcontenttype`) return 'text/calendar';
			return undefined;
		}
		case 'objekt': {
			const o = extra.objekt!;
			if (k === `{${NS.dav}}resourcetype`) return '';
			if (k === `{${NS.dav}}getetag`) return esc(o.etag);
			if (k === `{${NS.dav}}getcontenttype`) return 'text/calendar; charset=utf-8; component=VTODO';
			if (k === `{${NS.dav}}getcontentlength`) return String(Buffer.byteLength(o.ics, 'utf8'));
			if (k === `{${NS.dav}}getlastmodified`) return http(new Date(o.aufgabe.geaendert));
			if (k === `{${NS.caldav}}calendar-data`) return esc(o.ics);
			if (k === `{${NS.dav}}displayname`) return esc(o.aufgabe.titel);
			return undefined;
		}
	}
}

async function propAntwort(s: Sitzung, h: string, ziel: Ziel, props: Eigenschaft[], extra: Parameters<typeof werte>[3], allprop = false): Promise<string> {
	const gefunden: [Eigenschaft, string][] = [];
	const fehlend: Eigenschaft[] = [];
	for (const e of props) {
		const w = await werte(s, ziel, e, extra);
		if (w === undefined) {
			if (!allprop) fehlend.push(e);
		} else gefunden.push([e, w]);
	}
	return propResponse({ href: h, gefunden, fehlend });
}

const syncToken = (t: string) => `urn:x-crm-sync:${t}`;
const tokenAus = (t: string) => /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(t.trim())?.[1] ?? null;

/** Gewünschte Eigenschaften aus <prop>; `null` = allprop. */
function gewuenscht(wurzel: Element | null): { props: Eigenschaft[]; allprop: boolean } {
	const prop = kind(wurzel, NS.dav, 'prop');
	if (!wurzel || !prop) return { props: ALLPROP, allprop: true };
	return { props: prop.kinder.map((x) => E(x.ns, x.name)), allprop: false };
}

async function leseKoerper(request: Request, max = MAX_BYTES): Promise<string> {
	const laenge = Number(request.headers.get('content-length') ?? '0');
	if (laenge > max) throw new ApiFehler(413, 'Zu groß.');
	const t = await request.text();
	if (Buffer.byteLength(t, 'utf8') > max) throw new ApiFehler(413, 'Zu groß.');
	return t;
}

// ——— Methoden ———

async function propfind(s: Sitzung, ziel: Ziel, request: Request, pfad: string): Promise<Response> {
	const tiefe = (request.headers.get('depth') ?? '1').trim().toLowerCase();
	const wurzel = leseXml(await leseKoerper(request));
	if (wurzel && !(wurzel.ns === NS.dav && wurzel.name === 'propfind')) throw new XmlFehler('propfind erwartet');
	if (kind(wurzel, NS.dav, 'propname')) {
		// Nur Namen: die gängigen Eigenschaften leer melden
		return xml(207, multistatus([propResponse({ href: pfad, gefunden: ALLPROP.map((e) => [e, ''] as [Eigenschaft, string]), fehlend: [] })]));
	}
	const { props, allprop } = gewuenscht(wurzel);
	const mitKindern = tiefe !== '0';
	const id = s.k.benutzerId;
	const teile: string[] = [];
	switch (ziel.art) {
		case 'wurzel':
		case 'principals':
		case 'principal':
			teile.push(await propAntwort(s, pfad, ziel, props, {}, allprop));
			break;
		case 'heim': {
			teile.push(await propAntwort(s, href.heim(id), ziel, props, {}, allprop));
			if (mitKindern) {
				for (const l of await sammlungen(s)) {
					const objekte = await inhalt(s, l.schluessel);
					teile.push(
						await propAntwort(s, href.liste(id, l.schluessel), { art: 'liste', sammlung: l.schluessel }, props, { liste: l, objekte, token: () => aktuellerStand(s, l.schluessel, objekte) }, allprop)
					);
				}
			}
			break;
		}
		case 'liste': {
			const l = await sammlung(s, ziel.sammlung);
			if (!l) return text(404, 'Nicht gefunden.');
			const objekte = await inhalt(s, l.schluessel);
			teile.push(await propAntwort(s, href.liste(id, l.schluessel), ziel, props, { liste: l, objekte, token: () => aktuellerStand(s, l.schluessel, objekte) }, allprop));
			if (mitKindern) {
				for (const o of objekte.values()) {
					teile.push(await propAntwort(s, href.objekt(id, l.schluessel, o.name), { art: 'objekt', sammlung: l.schluessel, name: o.name }, props, { objekt: o }, allprop));
				}
			}
			break;
		}
		case 'objekt': {
			const o = (await inhalt(s, ziel.sammlung)).get(ziel.name);
			if (!o) return text(404, 'Nicht gefunden.');
			teile.push(await propAntwort(s, href.objekt(id, ziel.sammlung, o.name), ziel, props, { objekt: o }, allprop));
			break;
		}
	}
	return xml(207, multistatus(teile));
}

/** Filter einer calendar-query (RFC 4791 9.7) – das Nötige für Aufgaben-Programme. */
export function passtFilter(filter: Element | undefined, o: Objekt): boolean {
	if (!filter) return true;
	const kal = kind(filter, NS.caldav, 'comp-filter');
	if (!kal) return true;
	if ((kal.attrs.name ?? '').toUpperCase() !== 'VCALENDAR') return false;
	const komp = kinder(kal, NS.caldav, 'comp-filter');
	if (komp.length === 0) return true;
	return komp.every((cf) => {
		const name = (cf.attrs.name ?? '').toUpperCase();
		const nicht = kind(cf, NS.caldav, 'is-not-defined');
		if (name !== 'VTODO') return !!nicht;
		if (nicht) return false;
		const a = o.aufgabe;
		const zeitraum = kind(cf, NS.caldav, 'time-range');
		if (zeitraum) {
			const zeit = (w: string | undefined) => (w ? Date.parse(w.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) : NaN);
			const von = zeit(zeitraum.attrs.start);
			const bis = zeit(zeitraum.attrs.end);
			const ende = a.faellig ? Date.parse(`${a.faellig}T23:59:59Z`) : null;
			const anfang = a.vonTag ? Date.parse(`${a.vonTag}T00:00:00Z`) : a.faellig ? Date.parse(`${a.faellig}T00:00:00Z`) : null;
			// ohne Datum passt eine Aufgabe immer (RFC 4791 9.9)
			if (ende !== null && anfang !== null) {
				if (!Number.isNaN(von) && ende < von) return false;
				if (!Number.isNaN(bis) && anfang >= bis) return false;
			}
		}
		for (const pf of kinder(cf, NS.caldav, 'prop-filter')) {
			const p = (pf.attrs.name ?? '').toUpperCase();
			const fehlt = !!kind(pf, NS.caldav, 'is-not-defined');
			const tm = kind(pf, NS.caldav, 'text-match');
			if (p === 'COMPLETED') {
				const da = a.erledigtAm !== null;
				if (fehlt && da) return false;
				if (!fehlt && !tm && !da) return false;
			} else if (p === 'STATUS' && tm) {
				const status = a.erledigtAm ? 'COMPLETED' : a.faellig ? 'IN-PROCESS' : 'NEEDS-ACTION';
				const treffer = status.includes(tm.text.trim().toUpperCase());
				const negiert = (tm.attrs['negate-condition'] ?? 'no') === 'yes';
				if (treffer === negiert) return false;
			}
		}
		return true;
	});
}

async function report(s: Sitzung, ziel: Ziel, request: Request): Promise<Response> {
	const wurzel = leseXml(await leseKoerper(request));
	if (!wurzel) throw new XmlFehler('REPORT ohne Inhalt');
	if (ziel.art !== 'liste') return xml(403, fehlerXml(D('supported-report')));
	const l = await sammlung(s, ziel.sammlung);
	if (!l) return text(404, 'Nicht gefunden.');
	const id = s.k.benutzerId;
	const objekte = await inhalt(s, l.schluessel);
	const { props } = gewuenscht(wurzel);
	const fuer = async (o: Objekt) =>
		propAntwort(s, href.objekt(id, l.schluessel, o.name), { art: 'objekt', sammlung: l.schluessel, name: o.name }, props, { objekt: o });

	if (wurzel.ns === NS.caldav && wurzel.name === 'calendar-multiget') {
		const teile: string[] = [];
		for (const h of kinder(wurzel, NS.dav, 'href').slice(0, 1000)) {
			const roh = h.text.trim();
			let pfad = roh;
			try {
				pfad = new URL(roh, 'http://x').pathname;
			} catch {
				/* bleibt roh */
			}
			const z = zielVon(pfad, id);
			const o = z && z.art === 'objekt' && z.sammlung === l.schluessel ? objekte.get(z.name) : undefined;
			teile.push(o ? await fuer(o) : statusResponse(roh, '404 Not Found'));
		}
		return xml(207, multistatus(teile));
	}
	if (wurzel.ns === NS.caldav && wurzel.name === 'calendar-query') {
		const filter = kind(wurzel, NS.caldav, 'filter');
		const teile: string[] = [];
		for (const o of objekte.values()) if (passtFilter(filter, o)) teile.push(await fuer(o));
		return xml(207, multistatus(teile));
	}
	if (wurzel.ns === NS.dav && wurzel.name === 'sync-collection') {
		const tokenText = kind(wurzel, NS.dav, 'sync-token')?.text.trim() ?? '';
		let alt: Record<string, string> = {};
		if (tokenText !== '') {
			const t = tokenAus(tokenText);
			const stand = t ? await ladeStand(s, l.schluessel, t) : null;
			if (!stand) return xml(403, fehlerXml(D('valid-sync-token')));
			alt = stand;
		}
		const teile: string[] = [];
		for (const o of objekte.values()) if (alt[o.name] !== o.etag) teile.push(await fuer(o));
		for (const name of Object.keys(alt)) if (!objekte.has(name)) teile.push(statusResponse(href.objekt(id, l.schluessel, name), '404 Not Found'));
		const neu = await aktuellerStand(s, l.schluessel, objekte);
		return xml(207, multistatus(teile, `<d:sync-token>${esc(syncToken(neu))}</d:sync-token>`));
	}
	return xml(403, fehlerXml(D('supported-report')));
}

async function proppatch(s: Sitzung, ziel: Ziel, request: Request, pfad: string): Promise<Response> {
	const wurzel = leseXml(await leseKoerper(request));
	if (!wurzel || !(wurzel.ns === NS.dav && wurzel.name === 'propertyupdate')) throw new XmlFehler('propertyupdate erwartet');
	const props = [...kinder(wurzel, NS.dav, 'set'), ...kinder(wurzel, NS.dav, 'remove')].flatMap((x) => kind(x, NS.dav, 'prop')?.kinder ?? []);
	// Farbe/Reihenfolge der Liste nimmt das Handy gern mit – angenommen (nicht gespeichert); alles andere verboten
	const ok = (e: Element) => ziel.art === 'liste' && e.ns === NS.apple && (e.name === 'calendar-color' || e.name === 'calendar-order');
	const erlaubt = props.filter(ok);
	const verboten = props.filter((e) => !ok(e));
	let x = `<d:response><d:href>${esc(pfad)}</d:href>`;
	const block = (liste: Element[], status: string) =>
		liste.length ? `<d:propstat><d:prop>${liste.map((e) => tag(E(e.ns, e.name)).leer).join('')}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat>` : '';
	// Bei einem Verbot schlägt alles fehl (RFC 4918: atomar)
	x += verboten.length ? block(verboten, '403 Forbidden') + block(erlaubt, '424 Failed Dependency') : block(erlaubt, '200 OK');
	x += '</d:response>';
	return xml(207, multistatus([x]));
}

async function hole(s: Sitzung, ziel: Ziel, mitKoerper: boolean): Promise<Response> {
	if (ziel.art !== 'objekt') return text(200, mitKoerper ? 'CalDAV-Aufgaben des CRM. Bitte in der Erinnerungen-App bzw. DAVx⁵ einrichten.' : '');
	const o = (await inhalt(s, ziel.sammlung)).get(ziel.name);
	if (!o) return text(404, 'Nicht gefunden.');
	return antwort(200, mitKoerper ? o.ics : null, {
		'content-type': ICS_TYP,
		etag: o.etag,
		'last-modified': http(new Date(o.aufgabe.geaendert))
	});
}

const bedingungen = (request: Request) => ({ ifMatch: request.headers.get('if-match'), ifNoneMatch: request.headers.get('if-none-match') });

async function lege(s: Sitzung, ziel: Ziel, request: Request): Promise<Response> {
	if (ziel.art !== 'objekt') return text(405, 'Hier kann nichts gespeichert werden.', { allow: 'OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, REPORT' });
	if (!(await sammlung(s, ziel.sammlung))) return text(409, 'Liste nicht gefunden.');
	// text/calendar; manche Programme schicken text/plain oder nichts – JSON, XML, Formulare usw. nie
	const typ = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!['', 'text/calendar', 'text/plain', 'application/octet-stream'].includes(typ)) return xml(415, fehlerXml(C('supported-calendar-data')));
	let gelesen;
	try {
		gelesen = leseVtodo(await leseKoerper(request));
	} catch (e) {
		if (e instanceof VtodoFehler) return xml(403, fehlerXml(C(e.message.includes('VTODO') || e.message.includes('VEVENT') ? 'supported-calendar-component' : 'valid-calendar-data')));
		throw e;
	}
	const { neu } = await speichere(s, ziel.sammlung, ziel.name, gelesen, bedingungen(request));
	// Kein ETag zurück: das CRM speichert die Aufgabe in eigener Form – das Programm holt sie neu (RFC 4791 5.3.4)
	return antwort(neu ? 201 : 204, null);
}

async function entferne(s: Sitzung, ziel: Ziel, request: Request): Promise<Response> {
	if (ziel.art !== 'objekt') return text(403, 'Listen können nicht gelöscht werden.');
	await loesche(s, ziel.sammlung, ziel.name, bedingungen(request));
	return antwort(204, null);
}

// ——— Einstieg ———

/** Lokale Adressen dürfen ohne HTTPS (Tests, Vorschau im Container); alles andere nur über HTTPS. */
const LOKAL = new Set(['localhost', '127.0.0.1', '[::1]']);

function protokolliere(methode: string, pfad: string, status: number, wer: string | null, ms: number): void {
	// Nie Kopfzeilen, Passwörter oder Inhalte protokollieren
	if (status >= 400 || !['GET', 'HEAD', 'PROPFIND', 'REPORT', 'OPTIONS'].includes(methode)) {
		console.info(`[caldav] ${methode} ${pfad.slice(0, 200)} → ${status}${wer ? ` (Benutzer ${wer.slice(0, 8)})` : ''} ${ms} ms`);
	}
}

export async function caldav(event: Pick<RequestEvent, 'request' | 'url' | 'getClientAddress'>): Promise<Response> {
	const beginn = Date.now();
	const { request, url } = event;
	const methode = request.method.toUpperCase();
	const pfad = url.pathname;
	let wer: string | null = null;
	let r: Response;
	try {
		r = await bearbeite();
	} catch (e) {
		r = fehlerAntwort(e);
	}
	protokolliere(methode, pfad, r.status, wer, Date.now() - beginn);
	return r;

	async function bearbeite(): Promise<Response> {
		if (methode === 'OPTIONS') return antwort(200, null, { dav: DAV_KOPF, allow: ERLAUBT, 'content-length': '0' });
		if (url.protocol !== 'https:' && !LOKAL.has(url.hostname)) return text(403, 'Nur über HTTPS.');
		const zugang = leseBasic(request.headers.get('authorization'));
		if (!zugang) return text(401, 'Bitte mit E-Mail und App-Passwort anmelden.', { 'www-authenticate': REALM });
		const ergebnis = await meldeMitAppPasswortAn(zugang.email, zugang.passwort, ipVon(event));
		if ('fehler' in ergebnis) {
			if (ergebnis.fehler === 'gesperrt') return text(429, 'Zu viele Fehlversuche. Bitte 15 Minuten warten.', { 'retry-after': '900' });
			return text(401, 'E-Mail oder App-Passwort falsch.', { 'www-authenticate': REALM });
		}
		const nutzer = ergebnis.nutzer;
		wer = nutzer.id;
		const locals = { nutzer };
		await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
		const s: Sitzung = {
			k: { betriebId: nutzer.betriebId!, benutzerId: nutzer.id },
			nutzer,
			sicht: todoSichtVon(nutzer),
			origin: process.env.ORIGIN ?? url.origin
		};
		const ziel = zielVon(pfad, nutzer.id);
		if (!ziel) return text(404, 'Nicht gefunden.');
		const schreibend = ['PUT', 'DELETE', 'PROPPATCH'].includes(methode);
		if (schreibend && (await istNurLesen(nutzer))) return text(403, 'Nur Lesezugriff (Abo).');
		switch (methode) {
			case 'PROPFIND':
				return propfind(s, ziel, request, pfad);
			case 'REPORT':
				return report(s, ziel, request);
			case 'PROPPATCH':
				return proppatch(s, ziel, request, pfad);
			case 'GET':
				return hole(s, ziel, true);
			case 'HEAD':
				return hole(s, ziel, false);
			case 'PUT':
				return lege(s, ziel, request);
			case 'DELETE':
				return entferne(s, ziel, request);
			case 'MKCALENDAR':
			case 'MKCOL':
				return xml(403, fehlerXml(D('resource-must-be-null')));
			default:
				return text(405, 'Methode nicht unterstützt.', { allow: ERLAUBT });
		}
	}
}

function fehlerAntwort(e: unknown): Response {
	if (e instanceof XmlFehler) return text(400, e.message);
	if (e instanceof Vorbedingung) return e.bedingung ? xml(e.status, fehlerXml(e.bedingung)) : text(e.status, e.message);
	if (e instanceof ApiFehler) return text(e.status, e.message);
	// Doppelte UID/Name bei gleichzeitigem Anlegen
	if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') return text(412, 'Die Aufgabe gibt es schon.');
	console.error('[caldav] Unerwarteter Fehler:', e instanceof Error ? e.message : e);
	return text(500, 'Interner Fehler.');
}
