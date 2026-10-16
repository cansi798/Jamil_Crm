import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import { hashePasswort } from '../../src/lib/server/auth/passwort';
import { leereVersuche } from '../../src/lib/server/auth/ratelimit';
import { COOKIE_NAME, pruefeSitzung } from '../../src/lib/server/auth/sitzung';
import { actions as anmeldeAktion, load as anmeldeLoad } from '../../src/routes/anmelden/+page.server';

function fakeCookies() {
	const speicher = new Map<string, string>();
	return {
		speicher,
		get: (n: string) => speicher.get(n),
		set: (n: string, w: string) => void speicher.set(n, w),
		delete: (n: string) => void speicher.delete(n)
	};
}
async function anmelden(email: string, passwort = '') {
	const cookies = fakeCookies();
	const form = new FormData();
	form.set('email', email);
	form.set('passwort', passwort);
	const event = {
		request: new Request('http://localhost/anmelden', { method: 'POST', body: form }),
		cookies,
		locals: { nutzer: null },
		url: new URL('http://localhost/anmelden')
	} as never;
	try {
		return { ergebnis: await anmeldeAktion.default(event), umleitung: null as string | null, cookies };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location === 'string') return { ergebnis: null, umleitung: r.location, cookies };
		throw e;
	}
}

describe('Testmodus der Vorschau (Anmeldung nur mit Benutzername)', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let echtId: string;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 2, onnotice: () => {} });
		const hash = await hashePasswort('richtiges-Passwort-1');
		const [tarif] = await root`select id from app.tarife where schluessel = 'basis'`;
		const [{ id: betrieb }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Bauwelt', ${tarif.id}, 'aktiv') returning id`;
		const [chef] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, 'Chef', ${['kunden', 'einstellungen']}) returning id`;
		await root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betrieb}, 'can.chef@bauwelt.test', 'Can Chef', ${hash}, ${chef.id})`;
		[{ id: echtId }] = await root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betrieb}, 'chef@firma.de', 'Echter Chef', ${hash}, ${chef.id}) returning id`;
		const [{ id: admin }] = await root`insert into app.benutzer (email, name, passwort_hash)
			values ('can.admin@crm.test', 'Can Admin', ${hash}) returning id`;
		await root`insert into app.plattform_admins (benutzer_id) values (${admin})`;
	});
	afterEach(() => {
		delete process.env.CRM_TESTMODUS;
		leereVersuche();
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('ist ohne CRM_TESTMODUS aus: ohne Passwort keine Anmeldung', async () => {
		const r = await anmelden('can.chef');
		expect(r.umleitung).toBeNull();
		expect(r.cookies.speicher.has(COOKIE_NAME)).toBe(false);
		expect((anmeldeLoad({ locals: {}, url: new URL('http://localhost/anmelden') } as never) as { testmodus: boolean }).testmodus).toBe(false);
	});

	it('meldet Test-Chef und Test-Admin mit Testmodus ohne Passwort und ohne 2FA an', async () => {
		process.env.CRM_TESTMODUS = '1';
		for (const name of ['can.chef', 'can.admin']) {
			const r = await anmelden(name);
			expect(r.umleitung).toBe('/');
			const token = r.cookies.speicher.get(COOKIE_NAME);
			expect(token).toBeTruthy();
			expect(await pruefeSitzung(token!)).not.toBeNull();
		}
	});

	it('lässt echte Konten auch im Testmodus nicht ohne Passwort herein', async () => {
		process.env.CRM_TESTMODUS = '1';
		const r = await anmelden('chef@firma.de');
		expect(r.umleitung).toBeNull();
		expect(r.cookies.speicher.has(COOKIE_NAME)).toBe(false);
		const [z] = await systemAbfrage(
			(sql) => sql`select app.test_anmeldung(${echtId}::uuid, ${Buffer.alloc(32, 1)}::bytea, now() + interval '1 day') as ok`
		);
		expect(z.ok).toBe(false);
	});

	it('unbekannter Test-Benutzer bekommt eine Meldung', async () => {
		process.env.CRM_TESTMODUS = '1';
		const r = await anmelden('niemand.chef');
		expect(r.umleitung).toBeNull();
		expect(JSON.stringify(r.ergebnis)).toContain('Test-Benutzer');
	});
});
