import http from 'node:http';
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { calendarMultiGet, DAVClient } from 'tsdav';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { legeTodoAn } from '../../src/lib/server/todos';
import { caldav } from '../../src/lib/server/caldav/server';
import { legeAppPasswortAn } from '../../src/lib/server/caldav/app-passwoerter';
import { fallback as wellKnown } from '../../src/routes/.well-known/caldav/+server';

/**
 * Durchstich mit einer echten CalDAV-Bibliothek (tsdav, wie sie auch Web-Programme nutzen) über echtes HTTP:
 * Erkennung über /.well-known/caldav, Listen holen, Aufgabe anlegen, ändern, abhaken, löschen – und der Abgleich
 * per sync-collection (neu, geändert, gelöscht).
 */
describe('CalDAV mit tsdav über HTTP', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let server: http.Server;
	let basis: string;
	let betrieb: string, chefId: string, passwort: string;
	const EMAIL = 'chef@tsdav.test';
	// tsdav fragt ohne Filter nach VEVENT – Aufgaben-Programme fragen nach VTODO
	const NUR_AUFGABEN = [{ 'comp-filter': { _attributes: { name: 'VCALENDAR' }, 'comp-filter': { _attributes: { name: 'VTODO' } } } }];

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 2, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betrieb }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('T', ${premium.id}, 'aktiv') returning id`;
		const [{ id: rolle }] = await root`insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, 'Chef', ${[...VORLAGEN.chef]}) returning id`;
		[{ id: chefId }] = await root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id) values (${betrieb}, ${EMAIL}, 'Chef', 'x', ${rolle}) returning id`;
		passwort = (await legeAppPasswortAn({ betriebId: betrieb, benutzerId: chefId }, 'Test')).passwort;

		// Kleiner HTTP-Server: leitet wie die SvelteKit-Routen an den CalDAV-Handler bzw. die .well-known-Umleitung weiter
		server = http.createServer(async (req, res) => {
			const teile: Buffer[] = [];
			for await (const t of req) teile.push(t as Buffer);
			const url = new URL(req.url ?? '/', basis);
			const kopf = new Headers();
			for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') kopf.set(k, v);
			const koerper = teile.length ? Buffer.concat(teile) : undefined;
			const request = new Request(url, { method: req.method, headers: kopf, body: koerper && req.method !== 'GET' && req.method !== 'HEAD' ? koerper : undefined });
			const event = { request, url, getClientAddress: () => '127.0.0.1' };
			const r = url.pathname.startsWith('/.well-known/caldav') ? await wellKnown(event as never) : await caldav(event);
			res.writeHead(r.status, Object.fromEntries(r.headers));
			res.end(Buffer.from(await r.arrayBuffer()));
		});
		await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
		basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await new Promise((ok) => server?.close(ok));
		await schliesseDb();
		await root?.end();
	});

	it('Erkennung, Anlegen, Ändern, Abhaken, Löschen und sync-collection', async () => {
		const vorhanden = await legeTodoAn({ betriebId: betrieb, benutzerId: chefId }, { titel: 'Aus dem CRM', zustaendigId: chefId, faellig: '2026-11-05' });
		const client = new DAVClient({
			serverUrl: basis,
			credentials: { username: EMAIL, password: passwort },
			authMethod: 'Basic',
			defaultAccountType: 'caldav'
		});
		await client.login();
		expect(client.account?.principalUrl).toBe(`${basis}/caldav/nutzer/${chefId}/`);
		expect(client.account?.homeUrl).toBe(`${basis}/caldav/listen/${chefId}/`);

		const kalender = await client.fetchCalendars();
		expect(kalender.map((k) => k.displayName)).toEqual(['Meine Aufgaben (CRM)']);
		const liste = kalender[0];
		expect(liste.components).toEqual(['VTODO']);
		expect(liste.syncToken).toMatch(/^urn:x-crm-sync:/);

		// Standard-Abfrage nach Terminen (VEVENT): keine
		expect(await client.fetchCalendarObjects({ calendar: liste })).toEqual([]);
		const objekte = await client.fetchCalendarObjects({ calendar: liste, filters: NUR_AUFGABEN });
		expect(objekte).toHaveLength(1);
		expect(objekte[0].data).toContain('SUMMARY:Aus dem CRM');
		expect(objekte[0].etag).toBeTruthy();

		// Ausgangsstand für den Abgleich
		const start = await client.smartCollectionSync({ collection: { ...liste, objects: objekte, objectMultiGet: calendarMultiGet }, method: 'webdav', detailedResult: true });
		const token = start.syncToken;

		// Anlegen
		const neu = await client.createCalendarObject({
			calendar: liste,
			filename: 'tsdav-1.ics',
			iCalString: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tsdav-test//DE', 'BEGIN:VTODO', 'UID:tsdav-1', 'DTSTAMP:20261021T080000Z', 'SUMMARY:Vom Handy', 'DUE;VALUE=DATE:20261110', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n')
		});
		expect(neu.status).toBe(201);
		const [crm] = await root`select id, titel, to_char(faellig, 'YYYY-MM-DD') as faellig, zustaendig_id from app.todos where titel = 'Vom Handy'`;
		expect(crm).toMatchObject({ faellig: '2026-11-10', zustaendig_id: chefId });

		// Ändern (mit ETag) und abhaken
		const [obj] = await client.fetchCalendarObjects({ calendar: liste, objectUrls: [`${liste.url}tsdav-1.ics`] });
		const geaendert = await client.updateCalendarObject({
			calendarObject: { url: obj.url, etag: obj.etag, data: obj.data.replace('SUMMARY:Vom Handy', 'SUMMARY:Vom Handy (umbenannt)').replace(/STATUS:[A-Z-]+/, 'STATUS:COMPLETED') }
		});
		expect(geaendert.status).toBe(204);
		const [nachher] = await root`select titel, erledigt_am from app.todos where id = ${crm.id}`;
		expect(nachher.titel).toBe('Vom Handy (umbenannt)');
		expect(nachher.erledigt_am).not.toBeNull();
		// Veralteter ETag → 412
		const konflikt = await client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: obj.data } });
		expect(konflikt.status).toBe(412);

		// Im CRM gelöscht → beim Abgleich weg; neue/geänderte kommen mit
		await root`delete from app.todos where id = ${vorhanden.id}`;
		const delta = await client.smartCollectionSync({
			collection: { ...liste, syncToken: token, objects: objekte, objectMultiGet: calendarMultiGet },
			method: 'webdav',
			detailedResult: true
		});
		const o = delta.objects as unknown as { created: { url: string; data: string }[]; updated: unknown[]; deleted: { url: string }[] };
		expect(o.created.map((x) => x.url)).toEqual([`${liste.url}tsdav-1.ics`]);
		expect(o.created[0].data).toContain('STATUS:COMPLETED');
		expect(o.deleted.map((x) => x.url)).toEqual([`${liste.url}${vorhanden.id}.ics`]);
		expect(delta.syncToken).not.toBe(token);

		// Löschen vom Handy
		const [aktuell] = await client.fetchCalendarObjects({ calendar: liste, objectUrls: [`${liste.url}tsdav-1.ics`] });
		const weg = await client.deleteCalendarObject({ calendarObject: aktuell });
		expect(weg.status).toBe(204);
		expect(await root`select 1 from app.todos where id = ${crm.id}`).toHaveLength(0);
		expect(await client.fetchCalendarObjects({ calendar: liste, filters: NUR_AUFGABEN })).toEqual([]);
	});
});
