import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { legeTodoAn } from '../../src/lib/server/todos';
import { caldav } from '../../src/lib/server/caldav/server';
import { legeAppPasswortAn, leereAnmeldeSpeicher, listeAppPasswoerter, widerrufeAppPasswort } from '../../src/lib/server/caldav/app-passwoerter';
import { setzeListenJeAuftrag } from '../../src/lib/server/caldav/daten';

type Antwort = { status: number; text: string; kopf: Headers };

const basic = (email: string, pw: string) => `Basic ${Buffer.from(`${email}:${pw}`).toString('base64')}`;

async function anfrage(
	methode: string,
	pfad: string,
	o: { auth?: string; body?: string; kopf?: Record<string, string>; basis?: string; ip?: string } = {}
): Promise<Antwort> {
	const url = new URL(pfad, o.basis ?? 'http://localhost');
	const kopf: Record<string, string> = { ...(o.kopf ?? {}) };
	if (o.auth) kopf.authorization = o.auth;
	const r = await caldav({
		request: new Request(url, { method: methode, headers: kopf, body: o.body }),
		url,
		getClientAddress: () => o.ip ?? '10.0.0.1'
	});
	return { status: r.status, text: await r.text(), kopf: r.headers };
}

const PROPFIND = (props: string) => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${props}</d:prop></d:propfind>`;

const vtodo = (uid: string, zeilen: string[]) =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//DE', 'BEGIN:VTODO', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', ...zeilen, 'END:VTODO', 'END:VCALENDAR'].join('\r\n') + '\r\n';

/** Hrefs und ETags aus einem Multistatus. */
function eintraege(xml: string): { href: string; etag: string | null; status: string | null }[] {
	return [...xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)].map((m) => ({
		href: /<d:href>([^<]*)<\/d:href>/.exec(m[1])![1],
		etag: /<d:getetag>([^<]*)<\/d:getetag>/.exec(m[1])?.[1].replace(/&quot;/g, '"') ?? null,
		status: /^<d:href>[^<]*<\/d:href><d:status>([^<]*)<\/d:status>/.exec(m[1])?.[1] ?? null
	}));
}

describe('CalDAV (Aufgaben aufs Handy)', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefId: string, monteurId: string, kollegeId: string, chefBId: string;
	let auftragA: string, auftrag2A: string, kundeA: string;
	let pwChef: string, pwMonteur: string, pwKollege: string;
	const kChef = () => ({ betriebId: betriebA, benutzerId: chefId });
	const kMonteur = () => ({ betriebId: betriebA, benutzerId: monteurId });
	const CHEF = 'chef@caldav.test';
	const MONTEUR = 'monteur@caldav.test';
	const meineListe = (id: string) => `/caldav/listen/${id}/meine/`;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('B', ${premium.id}, 'aktiv') returning id`;
		const rolle = async (b: string, name: string, rechte: readonly string[]) =>
			(await root`insert into app.rollen (betrieb_id, name, rechte) values (${b}, ${name}, ${rechte as string[]}) returning id`)[0].id as string;
		const benutzer = async (b: string, r: string, email: string, name: string) =>
			(await root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id) values (${b}, ${email}, ${name}, 'x', ${r}) returning id`)[0].id as string;
		const monteurRolle = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		chefId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), CHEF, 'Chef');
		monteurId = await benutzer(betriebA, monteurRolle, MONTEUR, 'Ali Monteur');
		kollegeId = await benutzer(betriebA, monteurRolle, 'kollege@caldav.test', 'Kollege');
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@caldav.test', 'Chef B');
		[{ id: kundeA }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Müller') returning id`;
		pwChef = (await legeAppPasswortAn(kChef(), 'iPhone')).passwort;
		pwMonteur = (await legeAppPasswortAn(kMonteur(), 'Android')).passwort;
		pwKollege = (await legeAppPasswortAn({ betriebId: betriebA, benutzerId: kollegeId }, 'Handy')).passwort;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		leereAnmeldeSpeicher();
		await root`delete from app.todos`;
		await root`delete from app.auftraege`;
		await root`delete from app.caldav_sync`;
		await root`delete from app.caldav_einstellungen`;
		await root`update app.betriebe set abo_status = 'aktiv', abo_ende = null where id = ${betriebA}`;
		[{ id: auftragA }] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Badsanierung', ${kundeA}) returning id`;
		[{ id: auftrag2A }] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Fliesen Küche', ${kundeA}) returning id`;
		await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${betriebA}, ${auftragA}, ${monteurId})`;
	});

	describe('Anmeldung und Erkennung', () => {
		it('OPTIONS ohne Anmeldung; sonst 401 mit Basic-Aufforderung; falsches Passwort 401; Sperre nach 10 Fehlversuchen', async () => {
			const o = await anfrage('OPTIONS', '/caldav/');
			expect(o.status).toBe(200);
			expect(o.kopf.get('dav')).toContain('calendar-access');
			const ohne = await anfrage('PROPFIND', '/caldav/', { body: PROPFIND('<d:current-user-principal/>') });
			expect(ohne.status).toBe(401);
			expect(ohne.kopf.get('www-authenticate')).toMatch(/^Basic realm=/);
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, 'falsch-falsch-falsch-falsch-xxxx') })).status).toBe(401);
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwMonteur) })).status).toBe(401);
			// Anmelde-Passwort/Fremde: nie
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic('chef-b@caldav.test', pwChef) })).status).toBe(401);
			for (let i = 0; i < 8; i++) await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, `x${i}`) });
			const gesperrt = await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwChef) });
			expect(gesperrt.status).toBe(429);
			leereAnmeldeSpeicher();
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwChef) })).status).toBe(207);
		});

		it('App-Passwort auch mit Großbuchstaben/Leerzeichen; über http nur lokal', async () => {
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF.toUpperCase(), pwChef.toUpperCase().replace(/-/g, ' ')) })).status).toBe(207);
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwChef), basis: 'http://crm.example.de' })).status).toBe(403);
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwChef), basis: 'https://crm.example.de' })).status).toBe(207);
		});

		it('Erkennung: Wurzel → Principal → calendar-home-set → Liste mit VTODO', async () => {
			const auth = basic(CHEF, pwChef);
			const w = await anfrage('PROPFIND', '/caldav/', { auth, kopf: { depth: '0' }, body: PROPFIND('<d:current-user-principal/><d:resourcetype/>') });
			expect(w.status).toBe(207);
			expect(w.text).toContain(`<d:current-user-principal><d:href>/caldav/nutzer/${chefId}/</d:href></d:current-user-principal>`);
			const p = await anfrage('PROPFIND', `/caldav/nutzer/${chefId}/`, { auth, kopf: { depth: '0' }, body: PROPFIND('<c:calendar-home-set/><c:calendar-user-address-set/><d:displayname/>') });
			expect(p.text).toContain(`<c:calendar-home-set><d:href>/caldav/listen/${chefId}/</d:href></c:calendar-home-set>`);
			expect(p.text).toContain(`mailto:${CHEF}`);
			const h = await anfrage('PROPFIND', `/caldav/listen/${chefId}/`, {
				auth,
				kopf: { depth: '1' },
				body: PROPFIND('<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/><d:current-user-privilege-set/>')
			});
			expect(h.text).toContain(`<d:href>${meineListe(chefId)}</d:href>`);
			expect(h.text).toContain('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>');
			expect(h.text).toContain('<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>');
			expect(h.text).toContain('Meine Aufgaben (CRM)');
			expect(h.text).toMatch(/<d:sync-token>urn:x-crm-sync:[0-9a-f-]{36}<\/d:sync-token>/);
			expect(h.text).toContain('<d:privilege><d:bind/></d:privilege>');
			// Monteur darf nicht anlegen/löschen (bind/unbind fehlen)
			const m = await anfrage('PROPFIND', meineListe(monteurId), { auth: basic(MONTEUR, pwMonteur), kopf: { depth: '0' }, body: PROPFIND('<d:current-user-privilege-set/>') });
			expect(m.text).not.toContain('<d:bind/>');
			// unbekannte Eigenschaft → 404 im propstat
			expect((await anfrage('PROPFIND', meineListe(chefId), { auth, kopf: { depth: '0' }, body: PROPFIND('<d:quota-used-bytes/>') })).text).toContain('404 Not Found');
		});

		it('fremde Pfade sind 404 (auch anderer Benutzer desselben Betriebs)', async () => {
			const auth = basic(CHEF, pwChef);
			for (const p of [`/caldav/nutzer/${monteurId}/`, meineListe(monteurId), `/caldav/listen/${chefBId}/`, '/caldav/irgendwas/']) {
				expect((await anfrage('PROPFIND', p, { auth, body: PROPFIND('<d:displayname/>') })).status, p).toBe(404);
			}
		});

		it('widerrufenes App-Passwort, deaktivierter Benutzer, gesperrter Betrieb → 401', async () => {
			const neu = await legeAppPasswortAn(kChef(), 'Wegwerf');
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, neu.passwort) })).status).toBe(207);
			await widerrufeAppPasswort(kChef(), neu.id);
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, neu.passwort) })).status).toBe(401);
			expect((await listeAppPasswoerter(kChef())).map((x) => x.bezeichnung)).toEqual(['iPhone']);
			// Fremdes App-Passwort widerrufen: 404
			const [m] = await listeAppPasswoerter(kMonteur());
			await expect(widerrufeAppPasswort(kChef(), m.id)).rejects.toMatchObject({ status: 404 });
			await root`update app.benutzer set aktiv = false where id = ${kollegeId}`;
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic('kollege@caldav.test', pwKollege) })).status).toBe(401);
			await root`update app.benutzer set aktiv = true where id = ${kollegeId}`;
			await root`update app.betriebe set abo_status = 'gesperrt' where id = ${betriebA}`;
			leereAnmeldeSpeicher();
			expect((await anfrage('PROPFIND', '/caldav/', { auth: basic(CHEF, pwChef) })).status).toBe(401);
		});

		it('„zuletzt benutzt“ wird gemerkt', async () => {
			await anfrage('PROPFIND', '/caldav/', { auth: basic(MONTEUR, pwMonteur) });
			expect((await listeAppPasswoerter(kMonteur()))[0].zuletztBenutzt).toEqual(expect.any(String));
		});
	});

	describe('Inhalt und Sichtbarkeit', () => {
		it('Monteur: direkt zugewiesen + über seinen Auftrag; nicht die Aufgabe des Kollegen in fremdem Auftrag', async () => {
			const direkt = await legeTodoAn(kChef(), { titel: 'Direkt', zustaendigId: monteurId });
			const ueberAuftrag = await legeTodoAn(kChef(), { titel: 'Im Auftrag', auftragId: auftragA });
			const fremd = await legeTodoAn(kChef(), { titel: 'Kollege', auftragId: auftrag2A, zustaendigId: kollegeId });
			const r = await anfrage('PROPFIND', meineListe(monteurId), { auth: basic(MONTEUR, pwMonteur), kopf: { depth: '1' }, body: PROPFIND('<d:getetag/>') });
			const hrefs = eintraege(r.text).map((e) => e.href);
			expect(hrefs).toContain(`${meineListe(monteurId)}${direkt.id}.ics`);
			expect(hrefs).toContain(`${meineListe(monteurId)}${ueberAuftrag.id}.ics`);
			expect(hrefs).not.toContain(`${meineListe(monteurId)}${fremd.id}.ics`);
			// GET der fremden Aufgabe über den eigenen Pfad → 404
			expect((await anfrage('GET', `${meineListe(monteurId)}${fremd.id}.ics`, { auth: basic(MONTEUR, pwMonteur) })).status).toBe(404);
		});

		it('Chef: eigene Aufgabe ohne Auftrag (angelegt von ihm) ist drin; lange erledigte nicht', async () => {
			const eigene = await legeTodoAn(kChef(), { titel: 'Eigene Notiz' });
			const alt = await legeTodoAn(kChef(), { titel: 'Alt erledigt', zustaendigId: chefId });
			await root`update app.todos set erledigt_am = now() - interval '40 days' where id = ${alt.id}`;
			const r = await anfrage('PROPFIND', meineListe(chefId), { auth: basic(CHEF, pwChef), kopf: { depth: '1' }, body: PROPFIND('<d:getetag/>') });
			const hrefs = eintraege(r.text).map((e) => e.href);
			expect(hrefs).toContain(`${meineListe(chefId)}${eigene.id}.ics`);
			expect(hrefs).not.toContain(`${meineListe(chefId)}${alt.id}.ics`);
		});

		it('GET liefert VTODO mit ETag, Kategorien (Auftrag, Kunde) und Link', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Silikon', auftragId: auftragA, zustaendigId: monteurId, faellig: '2026-11-03' });
			const r = await anfrage('GET', `${meineListe(monteurId)}${t.id}.ics`, { auth: basic(MONTEUR, pwMonteur) });
			expect(r.status).toBe(200);
			expect(r.kopf.get('content-type')).toContain('text/calendar');
			expect(r.kopf.get('etag')).toMatch(/^"/);
			expect(r.text).toContain(`UID:${t.id}`);
			expect(r.text).toContain('SUMMARY:Silikon');
			expect(r.text).toContain('DUE;VALUE=DATE:20261103');
			expect(r.text).toMatch(/CATEGORIES:A-\d{4}-\d{4} Badsanierung,Müller/);
			expect(r.text).toContain(`URL:http://localhost/auftraege/${auftragA}`);
		});
	});

	describe('Schreiben vom Handy', () => {
		const objekt = (id: string, name: string) => `${meineListe(id)}${name}`;

		it('Chef ändert Titel und Fälligkeit mit passendem ETag (Verlauf: Quelle caldav); falscher ETag → 412', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Alt', zustaendigId: chefId });
			const auth = basic(CHEF, pwChef);
			const g = await anfrage('GET', objekt(chefId, `${t.id}.ics`), { auth });
			const etag = g.kopf.get('etag')!;
			const neu = g.text.replace('SUMMARY:Alt', 'SUMMARY:Neu vom Handy').replace('STATUS:NEEDS-ACTION', 'DUE;VALUE=DATE:20261224\r\nSTATUS:NEEDS-ACTION');
			expect((await anfrage('PUT', objekt(chefId, `${t.id}.ics`), { auth, body: neu, kopf: { 'content-type': 'text/calendar', 'if-match': '"veraltet"' } })).status).toBe(412);
			const r = await anfrage('PUT', objekt(chefId, `${t.id}.ics`), { auth, body: neu, kopf: { 'content-type': 'text/calendar', 'if-match': etag } });
			expect(r.status).toBe(204);
			expect(r.kopf.get('etag')).toBeNull();
			const [z] = await root`select titel, to_char(faellig, 'YYYY-MM-DD') as faellig from app.todos where id = ${t.id}`;
			expect(z).toEqual({ titel: 'Neu vom Handy', faellig: '2026-12-24' });
			const [v] = await root`select quelle, benutzer_id from app.aenderungen where tabelle = 'todos' and datensatz_id = ${t.id} and aktion = 'geaendert' order by zeit desc limit 1`;
			expect(v).toEqual({ quelle: 'caldav', benutzer_id: chefId });
			// alter ETag gilt nicht mehr
			expect((await anfrage('PUT', objekt(chefId, `${t.id}.ics`), { auth, body: neu, kopf: { 'if-match': etag } })).status).toBe(412);
		});

		it('Monteur: abhaken ja (und wieder öffnen), umbenennen/löschen/anlegen nein', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Fugen', auftragId: auftragA, zustaendigId: monteurId });
			const auth = basic(MONTEUR, pwMonteur);
			const pfad = objekt(monteurId, `${t.id}.ics`);
			const g = await anfrage('GET', pfad, { auth });
			const fertig = g.text.replace('STATUS:NEEDS-ACTION', 'STATUS:COMPLETED\r\nCOMPLETED:20261021T100000Z');
			expect((await anfrage('PUT', pfad, { auth, body: fertig, kopf: { 'if-match': g.kopf.get('etag')! } })).status).toBe(204);
			expect((await root`select erledigt_am from app.todos where id = ${t.id}`)[0].erledigt_am).not.toBeNull();
			const g2 = await anfrage('GET', pfad, { auth });
			expect(g2.text).toContain('STATUS:COMPLETED');
			expect((await anfrage('PUT', pfad, { auth, body: g2.text.replace('STATUS:COMPLETED', 'STATUS:NEEDS-ACTION').replace(/COMPLETED:[0-9TZ]+\r\n/, '').replace('PERCENT-COMPLETE:100\r\n', '') })).status).toBe(204);
			expect((await root`select erledigt_am from app.todos where id = ${t.id}`)[0].erledigt_am).toBeNull();
			const g3 = await anfrage('GET', pfad, { auth });
			expect((await anfrage('PUT', pfad, { auth, body: g3.text.replace('SUMMARY:Fugen', 'SUMMARY:Anders') })).status).toBe(403);
			expect((await anfrage('DELETE', pfad, { auth })).status).toBe(403);
			expect((await anfrage('PUT', objekt(monteurId, 'neu-123.ics'), { auth, body: vtodo('neu-123', ['SUMMARY:Neu']) })).status).toBe(403);
			expect((await root`select titel from app.todos where id = ${t.id}`)[0].titel).toBe('Fugen');
		});

		it('Neue Aufgabe vom Handy: UID/Name bleiben, zuständig = ich, Priorität und Erinnerung; doppelte UID → 403', async () => {
			const auth = basic(CHEF, pwChef);
			const morgen = new Date(Date.now() + 2 * 86_400_000);
			const ts = morgen.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
			const body = vtodo('IOS-ABC-1', ['SUMMARY:Material bestellen', 'PRIORITY:1', `DUE:${ts}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;RELATED=END:-PT1H', 'END:VALARM']);
			const r = await anfrage('PUT', objekt(chefId, 'IOS-ABC-1.ics'), { auth, body, kopf: { 'if-none-match': '*', 'content-type': 'text/calendar; charset=utf-8' } });
			expect(r.status).toBe(201);
			const [t] = await root`select id, titel, zustaendig_id, prioritaet, auftrag_id from app.todos where titel = 'Material bestellen'`;
			expect(t).toMatchObject({ zustaendig_id: chefId, prioritaet: 1, auftrag_id: null });
			const [e] = await root`select zeitpunkt, benutzer_id from app.erinnerungen where todo_id = ${t.id}`;
			expect(e.benutzer_id).toBe(chefId);
			expect(new Date(e.zeitpunkt).getTime()).toBe(Math.floor((morgen.getTime() - 3_600_000) / 60_000) * 60_000);
			const g = await anfrage('GET', objekt(chefId, 'IOS-ABC-1.ics'), { auth });
			expect(g.status).toBe(200);
			expect(g.text).toContain('UID:IOS-ABC-1');
			expect(g.text).toContain('PRIORITY:1');
			expect(g.text).toContain('BEGIN:VALARM');
			// gleiche Datei nochmal mit If-None-Match * → 412; andere Datei, gleiche UID → 403 no-uid-conflict
			expect((await anfrage('PUT', objekt(chefId, 'IOS-ABC-1.ics'), { auth, body, kopf: { 'if-none-match': '*' } })).status).toBe(412);
			const doppelt = await anfrage('PUT', objekt(chefId, 'anders.ics'), { auth, body });
			expect(doppelt.status).toBe(403);
			expect(doppelt.text).toContain('no-uid-conflict');
			// Löschen vom Handy
			expect((await anfrage('DELETE', objekt(chefId, 'IOS-ABC-1.ics'), { auth, kopf: { 'if-match': '"falsch"' } })).status).toBe(412);
			expect((await anfrage('DELETE', objekt(chefId, 'IOS-ABC-1.ics'), { auth })).status).toBe(204);
			expect(await root`select 1 from app.todos where id = ${t.id}`).toHaveLength(0);
			const [v] = await root`select quelle from app.aenderungen where tabelle = 'todos' and datensatz_id = ${t.id} and aktion = 'geloescht'`;
			expect(v.quelle).toBe('caldav');
		});

		it('Ungültige Daten: kein iCalendar → 403 valid-calendar-data, VEVENT → 403, falscher Typ → 415', async () => {
			const auth = basic(CHEF, pwChef);
			expect((await anfrage('PUT', objekt(chefId, 'x.ics'), { auth, body: 'Hallo' })).text).toContain('valid-calendar-data');
			const ev = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:e1', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
			expect((await anfrage('PUT', objekt(chefId, 'e1.ics'), { auth, body: ev })).text).toContain('supported-calendar-component');
			expect((await anfrage('PUT', objekt(chefId, 'x.ics'), { auth, body: vtodo('x', ['SUMMARY:x']), kopf: { 'content-type': 'application/json' } })).status).toBe(415);
			expect((await anfrage('PUT', `/caldav/listen/${chefId}/meine/`, { auth, body: vtodo('x', ['SUMMARY:x']) })).status).toBe(405);
		});

		it('Nur-Lesezugriff des Betriebs sperrt Schreiben, Lesen geht', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Lesen', zustaendigId: chefId });
			await root`update app.betriebe set abo_status = 'ueberfaellig', abo_ende = current_date - 30 where id = ${betriebA}`;
			const auth = basic(CHEF, pwChef);
			const g = await anfrage('GET', objekt(chefId, `${t.id}.ics`), { auth });
			expect(g.status).toBe(200);
			expect((await anfrage('PUT', objekt(chefId, `${t.id}.ics`), { auth, body: g.text.replace('SUMMARY:Lesen', 'SUMMARY:x') })).status).toBe(403);
			expect((await anfrage('DELETE', objekt(chefId, `${t.id}.ics`), { auth })).status).toBe(403);
		});
	});

	describe('Zeitraum und mehrere Mitarbeiter (Aufgaben-Erweiterung msgs 2977/2978)', () => {
		it('Zeitraum → DTSTART/DUE; am Handy verschoben → von/bis im CRM', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Estrich', zustaendigId: chefId, vonTag: '2026-11-02', faellig: '2026-11-04' });
			const auth = basic(CHEF, pwChef);
			const pfad = `${meineListe(chefId)}${t.id}.ics`;
			const g = await anfrage('GET', pfad, { auth });
			expect(g.text).toContain('DTSTART;VALUE=DATE:20261102');
			expect(g.text).toContain('DUE;VALUE=DATE:20261104');
			const r = await anfrage('PUT', pfad, { auth, body: g.text.replace('DTSTART;VALUE=DATE:20261102', 'DTSTART;VALUE=DATE:20261103').replace('DUE;VALUE=DATE:20261104', 'DUE;VALUE=DATE:20261106') });
			expect(r.status).toBe(204);
			const [z] = await root`select to_char(von_tag, 'YYYY-MM-DD') as von, to_char(faellig, 'YYYY-MM-DD') as bis from app.todos where id = ${t.id}`;
			expect(z).toEqual({ von: '2026-11-03', bis: '2026-11-06' });
			// Zeitraum am Handy entfernt (nur noch DUE) → ein Tag
			const g2 = await anfrage('GET', pfad, { auth });
			expect((await anfrage('PUT', pfad, { auth, body: g2.text.replace(/DTSTART;VALUE=DATE:\d+\r\n/, '') })).status).toBe(204);
			expect((await root`select von_tag from app.todos where id = ${t.id}`)[0].von_tag).toBeNull();
		});

		it('Zweiter Mitarbeiter einer Aufgabe hat sie in seiner Liste und darf sie abhaken', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Zu zweit', auftragId: auftrag2A, mitarbeiterIds: [kollegeId, monteurId] });
			const auth = basic(MONTEUR, pwMonteur);
			const pfad = `${meineListe(monteurId)}${t.id}.ics`;
			const g = await anfrage('GET', pfad, { auth });
			expect(g.status).toBe(200);
			expect((await anfrage('PUT', pfad, { auth, body: g.text.replace(/STATUS:[A-Z-]+/, 'STATUS:COMPLETED') })).status).toBe(204);
			expect((await root`select erledigt_am from app.todos where id = ${t.id}`)[0].erledigt_am).not.toBeNull();
		});
	});

	describe('Abgleich (REPORT)', () => {
		it('sync-collection: erst alles, dann nur Änderungen und Weggefallenes; ungültiges Token → 403', async () => {
			const auth = basic(MONTEUR, pwMonteur);
			const a = await legeTodoAn(kChef(), { titel: 'A', zustaendigId: monteurId });
			const b = await legeTodoAn(kChef(), { titel: 'B', zustaendigId: monteurId });
			const sync = (token: string) =>
				anfrage('REPORT', meineListe(monteurId), {
					auth,
					body: `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`
				});
			const erst = await sync('');
			expect(erst.status).toBe(207);
			expect(eintraege(erst.text).map((e) => e.href).sort()).toEqual([`${meineListe(monteurId)}${a.id}.ics`, `${meineListe(monteurId)}${b.id}.ics`].sort());
			const token = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(erst.text)![1];
			// ohne Änderung: nichts, gleiches Token
			const leer = await sync(token);
			expect(eintraege(leer.text)).toEqual([]);
			expect(leer.text).toContain(token);
			// A umbenannt, B einem Kollegen gegeben (fällt aus der Sicht), C neu
			await root`update app.todos set titel = 'A2' where id = ${a.id}`;
			await root`update app.todos set zustaendig_id = ${kollegeId} where id = ${b.id}`;
			await root`delete from app.todo_mitarbeiter where todo_id = ${b.id} and benutzer_id = ${monteurId}`.catch(() => {});
			const c = await legeTodoAn(kChef(), { titel: 'C', zustaendigId: monteurId });
			const delta = await sync(token);
			const e = eintraege(delta.text);
			expect(e.filter((x) => x.etag).map((x) => x.href).sort()).toEqual([`${meineListe(monteurId)}${a.id}.ics`, `${meineListe(monteurId)}${c.id}.ics`].sort());
			expect(e.filter((x) => x.status)).toEqual([{ href: `${meineListe(monteurId)}${b.id}.ics`, etag: null, status: 'HTTP/1.1 404 Not Found' }]);
			const kaputt = await sync('urn:x-crm-sync:00000000-0000-4000-8000-000000000000');
			expect(kaputt.status).toBe(403);
			expect(kaputt.text).toContain('valid-sync-token');
			// Token eines anderen Benutzers gilt nicht
			const fremd = await anfrage('REPORT', meineListe(chefId), {
				auth: basic(CHEF, pwChef),
				body: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:prop><d:getetag/></d:prop></d:sync-collection>`
			});
			expect(fremd.status).toBe(403);
		});

		it('calendar-multiget und calendar-query (offene Aufgaben)', async () => {
			const auth = basic(CHEF, pwChef);
			const offen = await legeTodoAn(kChef(), { titel: 'Offen', zustaendigId: chefId });
			const fertig = await legeTodoAn(kChef(), { titel: 'Fertig', zustaendigId: chefId });
			await root`update app.todos set erledigt_am = now() where id = ${fertig.id}`;
			const mg = await anfrage('REPORT', meineListe(chefId), {
				auth,
				body: `<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>${meineListe(chefId)}${offen.id}.ics</d:href><d:href>${meineListe(chefId)}gibtsnicht.ics</d:href></c:calendar-multiget>`
			});
			expect(mg.status).toBe(207);
			expect(mg.text).toContain('SUMMARY:Offen');
			expect(mg.text).toContain('404 Not Found');
			const q = await anfrage('REPORT', meineListe(chefId), {
				auth,
				body: `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"><c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`
			});
			const hrefs = eintraege(q.text).map((e) => e.href);
			expect(hrefs).toContain(`${meineListe(chefId)}${offen.id}.ics`);
			expect(hrefs).not.toContain(`${meineListe(chefId)}${fertig.id}.ics`);
			const events = await anfrage('REPORT', meineListe(chefId), {
				auth,
				body: `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`
			});
			expect(eintraege(events.text)).toEqual([]);
		});

		it('XML mit DOCTYPE/Entitäten → 400, ohne etwas auszuführen', async () => {
			const r = await anfrage('PROPFIND', meineListe(chefId), {
				auth: basic(CHEF, pwChef),
				body: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><d:propfind xmlns:d="DAV:"><d:prop><d:displayname>&e;</d:displayname></d:prop></d:propfind>'
			});
			expect(r.status).toBe(400);
			expect(r.text).not.toContain('root:');
		});

		it('PROPPATCH: Farbe angenommen, Name verboten; MKCALENDAR verboten', async () => {
			const auth = basic(CHEF, pwChef);
			const ok = await anfrage('PROPPATCH', meineListe(chefId), {
				auth,
				body: '<d:propertyupdate xmlns:d="DAV:" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><ic:calendar-color>#FF0000FF</ic:calendar-color></d:prop></d:set></d:propertyupdate>'
			});
			expect(ok.text).toContain('200 OK');
			const nein = await anfrage('PROPPATCH', meineListe(chefId), {
				auth,
				body: '<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>Neu</d:displayname></d:prop></d:set></d:propertyupdate>'
			});
			expect(nein.text).toContain('403 Forbidden');
			expect((await anfrage('MKCALENDAR', `/caldav/listen/${chefId}/neu/`, { auth })).status).toBe(403);
		});
	});

	describe('Liste je Auftrag', () => {
		it('An: eigene Liste je Auftrag; „Meine Aufgaben“ nur ohne Auftrag; Anlegen in der Auftragsliste hängt am Auftrag', async () => {
			await setzeListenJeAuftrag(kMonteur(), true);
			await setzeListenJeAuftrag(kChef(), true);
			const ohne = await legeTodoAn(kChef(), { titel: 'Ohne Auftrag', zustaendigId: monteurId });
			const mit = await legeTodoAn(kChef(), { titel: 'Mit Auftrag', auftragId: auftragA });
			const auth = basic(MONTEUR, pwMonteur);
			const h = await anfrage('PROPFIND', `/caldav/listen/${monteurId}/`, { auth, kopf: { depth: '1' }, body: PROPFIND('<d:displayname/>') });
			const liste = `/caldav/listen/${monteurId}/auftrag-${auftragA}/`;
			expect(eintraege(h.text).map((e) => e.href)).toEqual([`/caldav/listen/${monteurId}/`, meineListe(monteurId), liste]);
			expect(h.text).toContain('Badsanierung');
			const meine = eintraege((await anfrage('PROPFIND', meineListe(monteurId), { auth, kopf: { depth: '1' }, body: PROPFIND('<d:getetag/>') })).text).map((e) => e.href);
			expect(meine).toContain(`${meineListe(monteurId)}${ohne.id}.ics`);
			expect(meine).not.toContain(`${meineListe(monteurId)}${mit.id}.ics`);
			const imAuftrag = eintraege((await anfrage('PROPFIND', liste, { auth, kopf: { depth: '1' }, body: PROPFIND('<d:getetag/>') })).text).map((e) => e.href);
			expect(imAuftrag).toContain(`${liste}${mit.id}.ics`);
			// Chef ist nicht zuständig für den Auftrag → keine Liste dafür (404)
			expect((await anfrage('PROPFIND', `/caldav/listen/${chefId}/auftrag-${auftragA}/`, { auth: basic(CHEF, pwChef), body: PROPFIND('<d:displayname/>') })).status).toBe(404);
			// Aus: Auftragsliste weg
			await setzeListenJeAuftrag(kMonteur(), false);
			expect((await anfrage('PROPFIND', liste, { auth, body: PROPFIND('<d:displayname/>') })).status).toBe(404);
		});

		it('Neue Aufgabe in einer Auftragsliste hängt am Auftrag', async () => {
			await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${betriebA}, ${auftrag2A}, ${chefId})`;
			await setzeListenJeAuftrag(kChef(), true);
			const liste = `/caldav/listen/${chefId}/auftrag-${auftrag2A}/`;
			const r = await anfrage('PUT', `${liste}neu-1.ics`, { auth: basic(CHEF, pwChef), body: vtodo('neu-1', ['SUMMARY:Fliesen holen']) });
			expect(r.status).toBe(201);
			expect((await root`select auftrag_id from app.todos where titel = 'Fliesen holen'`)[0].auftrag_id).toBe(auftrag2A);
		});
	});

	describe('Datenbank-Rechte (RLS)', () => {
		it('crm_app sieht nur eigene App-Passwörter, nie den Hash; Prüf-Funktionen nur für crm_auth', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				const alsChef = await app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebA}, true), set_config('app.benutzer_id', ${chefId}, true)`;
					return tx`select distinct benutzer_id from app.app_passwoerter`;
				});
				expect(alsChef.map((z) => z.benutzer_id)).toEqual([chefId]);
				await expect(
					app.begin(async (tx) => {
						await tx`select set_config('app.betrieb_id', ${betriebA}, true), set_config('app.benutzer_id', ${chefId}, true)`;
						return tx`select hash from app.app_passwoerter`;
					})
				).rejects.toThrow(/permission denied/);
				await expect(app`select * from app.app_passwort_kandidaten(${CHEF}::public.citext)`).rejects.toThrow(/permission denied/);
				await expect(app`select * from app.app_passwort_nutzer(${chefId}::uuid)`).rejects.toThrow(/permission denied/);
				// Fremde Abgleich-Stände/Einstellungen unsichtbar, nicht schreibbar
				await setzeListenJeAuftrag(kMonteur(), true);
				const fremd = await app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebA}, true), set_config('app.benutzer_id', ${chefId}, true)`;
					return tx`select * from app.caldav_einstellungen`;
				});
				expect(fremd).toEqual([]);
				await expect(
					app.begin(async (tx) => {
						await tx`select set_config('app.betrieb_id', ${betriebA}, true), set_config('app.benutzer_id', ${chefId}, true)`;
						await tx`insert into app.app_passwoerter (betrieb_id, benutzer_id, bezeichnung, hash) values (${betriebA}, ${monteurId}, 'x', '$argon2id$x')`;
					})
				).rejects.toThrow(/row-level security/);
				await expect(
					app.begin(async (tx) => {
						await tx`select set_config('app.betrieb_id', ${betriebB}, true), set_config('app.benutzer_id', ${chefBId}, true)`;
						await tx`insert into app.caldav_sync (betrieb_id, benutzer_id, sammlung, eintraege, pruefsumme) values (${betriebA}, ${chefId}, 'meine', '{}', 'x')`;
					})
				).rejects.toThrow(/row-level security/);
			} finally {
				await app.end();
			}
		});

		it('angelegt_von kommt aus dem Kontext; öffentliche Abläufe ohne Benutzer → NULL', async () => {
			const t = await legeTodoAn(kChef(), { titel: 'Von wem' });
			expect((await root`select angelegt_von from app.todos where id = ${t.id}`)[0].angelegt_von).toBe(chefId);
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				const [z] = await app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebA}, true), set_config('app.quelle', 'kundenportal', true)`;
					return tx`insert into app.todos (betrieb_id, titel) values (${betriebA}, 'Portal') returning angelegt_von`;
				});
				expect(z.angelegt_von).toBeNull();
			} finally {
				await app.end();
			}
		});
	});
});
