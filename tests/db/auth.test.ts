import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import { hashePasswort } from '../../src/lib/server/auth/passwort';
import { leereVersuche } from '../../src/lib/server/auth/ratelimit';
import { COOKIE_NAME, loescheSitzung, neueSitzung, pruefeSitzung } from '../../src/lib/server/auth/sitzung';
import { actions, load } from '../../src/routes/anmelden/+page.server';
import { POST as abmelden } from '../../src/routes/api/abmelden/+server';
import { handle } from '../../src/hooks.server';

const PASSWORT = 'richtiges-Passwort-1';
const FALSCH_MELDUNG = 'E-Mail oder Passwort ist falsch.';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

type Gesetzt = { name: string; wert: string; opts: Record<string, unknown> };

/** Minimaler Ersatz für SvelteKits cookies-Objekt. */
function fakeCookies(start: Record<string, string> = {}) {
	const speicher = new Map(Object.entries(start));
	const gesetzt: Gesetzt[] = [];
	const geloescht: string[] = [];
	return {
		gesetzt,
		geloescht,
		get: (n: string) => speicher.get(n),
		set: (n: string, wert: string, opts: Record<string, unknown>) => {
			speicher.set(n, wert);
			gesetzt.push({ name: n, wert, opts });
		},
		delete: (n: string) => {
			speicher.delete(n);
			geloescht.push(n);
		}
	};
}

function loginEvent(email: string, passwort: string) {
	const form = new FormData();
	form.set('email', email);
	form.set('passwort', passwort);
	const cookies = fakeCookies();
	const event = {
		request: new Request('http://localhost/anmelden', { method: 'POST', body: form }),
		cookies,
		locals: { nutzer: null }
	};
	return { event: event as never, cookies };
}

/** Führt die Anmelde-Aktion aus; redirect() wirft, fail() wird zurückgegeben. */
async function anmelden(email: string, passwort: string) {
	const { event, cookies } = loginEvent(email, passwort);
	try {
		const ergebnis = await actions.default(event);
		return { ergebnis, umleitung: null as null | { status: number; location: string }, cookies };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.status === 'number' && typeof r.location === 'string') {
			return { ergebnis: null, umleitung: { status: r.status, location: r.location }, cookies };
		}
		throw e;
	}
}

describe('Anmeldung, Sitzungen, Begrenzung', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebGesperrt: string;
	let benutzerA: string, benutzerInaktiv: string, benutzerGesperrt: string, adminId: string;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin });
		root = postgres(db.urlSuper, { max: 2, onnotice: () => {} });
		const hash = await hashePasswort(PASSWORT);
		const [tarif] = await root`insert into app.tarife (schluessel, name) values ('basis', 'Basis') returning id`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${tarif.id}, 'aktiv') returning id`;
		[{ id: betriebGesperrt }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Gesperrt GmbH', ${tarif.id}, 'gesperrt') returning id`;
		const [rolleA] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Chef', ${['kunden', 'einstellungen']}) returning id`;
		const [rolleG] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betriebGesperrt}, 'Chef', ${['kunden']}) returning id`;
		[{ id: benutzerA }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betriebA}, 'Anna@Beispiel.test', 'Anna', ${hash}, ${rolleA.id}) returning id`;
		[{ id: benutzerInaktiv }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id, aktiv)
			values (${betriebA}, 'inaktiv@beispiel.test', 'Ina', ${hash}, ${rolleA.id}, false) returning id`;
		[{ id: benutzerGesperrt }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betriebGesperrt}, 'gesperrt@beispiel.test', 'Gerd', ${hash}, ${rolleG.id}) returning id`;
		[{ id: adminId }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash)
			values (null, 'admin@beispiel.test', 'Admin', ${hash}) returning id`;
		await root`insert into app.plattform_admins (benutzer_id) values (${adminId})`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(() => leereVersuche());

	describe('SQL-Funktionen', () => {
		it('anmeldung_finden findet ohne Groß-/Kleinschreibung und liefert den Hash', async () => {
			const zeilen = await systemAbfrage(
				(sql) => sql`select * from app.anmeldung_finden(${'anna@beispiel.TEST'}::public.citext)`
			);
			expect(zeilen).toHaveLength(1);
			expect(zeilen[0]).toMatchObject({ id: benutzerA, betrieb_id: betriebA, aktiv: true, totp_aktiv: false });
			expect(String(zeilen[0].passwort_hash).startsWith('$argon2id$')).toBe(true);
		});

		it('anmeldung_finden: unbekannte E-Mail → keine Zeile', async () => {
			const zeilen = await systemAbfrage(
				(sql) => sql`select * from app.anmeldung_finden(${'niemand@beispiel.test'}::public.citext)`
			);
			expect(zeilen).toHaveLength(0);
		});

		it('crm_app kann passwort_hash weder lesen noch ändern (Spaltenrechte)', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			const alsApp = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
				app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebA}, true)`;
					return fn(tx);
				}) as Promise<T>;
			try {
				await expect(alsApp((tx) => tx`select passwort_hash from app.benutzer`)).rejects.toThrow(/permission denied/);
				await expect(alsApp((tx) => tx`select * from app.benutzer`)).rejects.toThrow(/permission denied/);
				await expect(
					alsApp((tx) => tx`update app.benutzer set passwort_hash = 'x' where id = ${benutzerA}`)
				).rejects.toThrow(/permission denied/);
				// übrige Spalten bleiben nutzbar
				const [z] = await alsApp((tx) => tx`select id, email, name, totp_geheim, totp_aktiv from app.benutzer where id = ${benutzerA}`);
				expect(z.name).toBe('Anna');
				const r = await alsApp((tx) => tx`update app.benutzer set name = 'Anna' where id = ${benutzerA}`);
				expect(r.count).toBe(1);
			} finally {
				await app.end();
			}
		});

		it('Funktionen: Eigentümer crm, SECURITY DEFINER, fester search_path, nur crm_app darf ausführen', async () => {
			const funktionen = await root`
				select p.proname, pg_get_userbyid(p.proowner) as eigentuemer, p.prosecdef, p.proconfig,
					has_function_privilege('crm_app', p.oid, 'execute') as app_darf,
					has_function_privilege('crm_admin', p.oid, 'execute') as admin_darf,
					has_function_privilege('public', p.oid, 'execute') as public_darf
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'app' and p.proname in ('anmeldung_finden', 'sitzung_anlegen', 'sitzung_pruefen', 'sitzung_loeschen')`;
			expect(funktionen.map((f) => f.proname).sort()).toEqual([
				'anmeldung_finden', 'sitzung_anlegen', 'sitzung_loeschen', 'sitzung_pruefen'
			]);
			for (const f of funktionen) {
				expect(f.eigentuemer, f.proname).toBe('crm');
				expect(f.prosecdef, f.proname).toBe(true);
				expect(String(f.proconfig), f.proname).toMatch(/search_path=app, pg_temp/);
				expect(f.app_darf, f.proname).toBe(true);
				expect(f.admin_darf, f.proname).toBe(false);
				expect(f.public_darf, f.proname).toBe(false);
			}
		});

		it('sitzung_pruefen liefert Rechte/Status und verlängert gleitend', async () => {
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${benutzerA}, now() + interval '1 day')`;
			const [z] = await systemAbfrage(
				(sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`
			);
			expect(z).toEqual({
				benutzer_id: benutzerA, betrieb_id: betriebA, ist_admin: false,
				rolle_rechte: ['kunden', 'einstellungen'], betrieb_status: 'aktiv'
			});
			const [tage] = await root`
				select extract(epoch from (laeuft_ab - now())) / 86400 as tage from app.sitzungen where token_hash = ${sha256(token)}`;
			expect(Number(tage.tage)).toBeGreaterThan(29.99);
			expect(Number(tage.tage)).toBeLessThanOrEqual(30);
			const [b] = await root`select letzte_aktivitaet from app.benutzer where id = ${benutzerA}`;
			expect(b.letzte_aktivitaet).not.toBeNull();
		});

		it('sitzung_pruefen: Plattform-Admin ohne Betrieb', async () => {
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${adminId}, now() + interval '1 day')`;
			const [z] = await systemAbfrage(
				(sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`
			);
			expect(z).toEqual({
				benutzer_id: adminId, betrieb_id: null, ist_admin: true, rolle_rechte: [], betrieb_status: null
			});
		});

		it('sitzung_pruefen: nichts bei abgelaufener Sitzung, inaktivem Benutzer, gesperrtem Betrieb, unbekanntem Token', async () => {
			const faelle: [string, string, string][] = [
				['abgelaufen', benutzerA, "now() - interval '1 second'"],
				['inaktiv', benutzerInaktiv, "now() + interval '1 day'"],
				['gesperrt', benutzerGesperrt, "now() + interval '1 day'"]
			];
			for (const [name, benutzer, ablauf] of faelle) {
				const token = `${name}-${randomBytes(8).toString('hex')}`;
				await root.unsafe(
					`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab) values ($1, $2, ${ablauf})`,
					[sha256(token) as never, benutzer]
				);
				const zeilen = await systemAbfrage(
					(sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`
				);
				expect(zeilen, name).toHaveLength(0);
			}
			const zeilen = await systemAbfrage(
				(sql) => sql`select * from app.sitzung_pruefen(${sha256('unbekannt')}::bytea)`
			);
			expect(zeilen).toHaveLength(0);
		});

		it('sitzung_loeschen entfernt die Sitzung', async () => {
			const h = sha256('zu-loeschen');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${h}, ${benutzerA}, now() + interval '1 day')`;
			await systemAbfrage((sql) => sql`select app.sitzung_loeschen(${h}::bytea)`);
			const rest = await root`select 1 from app.sitzungen where token_hash = ${h}`;
			expect(rest).toHaveLength(0);
		});
	});

	describe('Sitzungs-Token', () => {
		it('neueSitzung: 32 Byte base64url, gespeichert wird nur der SHA-256', async () => {
			const token = await neueSitzung(benutzerA);
			expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			const zeilen = await root`select token_hash from app.sitzungen where benutzer_id = ${benutzerA}`;
			const hashes = zeilen.map((z) => Buffer.from(z.token_hash).toString('hex'));
			expect(hashes).toContain(sha256(token).toString('hex'));
			expect(hashes).not.toContain(Buffer.from(token).toString('hex'));
			expect(hashes).not.toContain(Buffer.from(token, 'base64url').toString('hex'));
		});

		it('pruefeSitzung liefert Nutzer; loescheSitzung macht sie ungültig', async () => {
			const token = await neueSitzung(benutzerA);
			expect(await pruefeSitzung(token)).toEqual({
				id: benutzerA, betriebId: betriebA, istAdmin: false,
				rechte: ['kunden', 'einstellungen'], betriebStatus: 'aktiv'
			});
			await loescheSitzung(token);
			expect(await pruefeSitzung(token)).toBeNull();
		});

		it('pruefeSitzung: offensichtlich ungültige Tokens → null ohne DB', async () => {
			expect(await pruefeSitzung('')).toBeNull();
			expect(await pruefeSitzung('x'.repeat(5000))).toBeNull();
			expect(await pruefeSitzung('nicht base64url!')).toBeNull();
		});
	});

	describe('Anmelde-Aktion', () => {
		it('richtiges Passwort → Sitzung + Cookie, Weiterleitung', async () => {
			const { umleitung, cookies } = await anmelden('anna@beispiel.test', PASSWORT);
			expect(umleitung).toEqual({ status: 303, location: '/' });
			expect(cookies.gesetzt).toHaveLength(1);
			const c = cookies.gesetzt[0];
			expect(c.name).toBe(COOKIE_NAME);
			expect(c.name).toBe('crm_sitzung');
			expect(c.opts).toMatchObject({
				httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60
			});
			const nutzer = await pruefeSitzung(c.wert);
			expect(nutzer?.id).toBe(benutzerA);
		});

		it('E-Mail wird ohne Beachtung von Groß-/Kleinschreibung und Leerzeichen erkannt', async () => {
			const { umleitung } = await anmelden('  ANNA@Beispiel.Test ', PASSWORT);
			expect(umleitung?.status).toBe(303);
		});

		it('falsches Passwort und unbekannte E-Mail → gleiche Meldung und gleicher Status', async () => {
			const falsch = await anmelden('anna@beispiel.test', 'falsch');
			const unbekannt = await anmelden('niemand@beispiel.test', 'falsch');
			expect(falsch.umleitung).toBeNull();
			expect(unbekannt.umleitung).toBeNull();
			expect(falsch.cookies.gesetzt).toHaveLength(0);
			expect(unbekannt.cookies.gesetzt).toHaveLength(0);
			expect(falsch.ergebnis).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
			expect(unbekannt.ergebnis).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
		});

		it('inaktiver Benutzer und gesperrter Betrieb: richtiges Passwort → gleiche Meldung wie bei falschem Passwort', async () => {
			const inaktiv = await anmelden('inaktiv@beispiel.test', PASSWORT);
			expect(inaktiv.umleitung).toBeNull();
			expect(inaktiv.ergebnis).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
			// gesperrter Betrieb: die Sitzung entsteht, wird aber nie gültig (sitzung_pruefen → nichts)
			const gesperrt = await anmelden('gesperrt@beispiel.test', PASSWORT);
			expect(gesperrt.umleitung?.status).toBe(303);
			expect(await pruefeSitzung(gesperrt.cookies.gesetzt[0].wert)).toBeNull();
		});

		it('fehlende oder fehlerhafte Felder → gleiche Meldung', async () => {
			const { event } = loginEvent('', '');
			const r = await actions.default(event);
			expect(r).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
		});

		it('6. Fehlversuch → 429 (auch mit richtigem Passwort)', async () => {
			for (let i = 1; i <= 5; i++) {
				const { ergebnis } = await anmelden('anna@beispiel.test', 'falsch');
				expect(ergebnis, `Versuch ${i}`).toMatchObject({ status: 400 });
			}
			const sechster = await anmelden('anna@beispiel.test', PASSWORT);
			expect(sechster.umleitung).toBeNull();
			expect(sechster.ergebnis).toMatchObject({ status: 429 });
			expect(sechster.cookies.gesetzt).toHaveLength(0);
			// andere E-Mail-Adressen sind nicht betroffen
			const andere = await anmelden('admin@beispiel.test', PASSWORT);
			expect(andere.umleitung?.status).toBe(303);
		});

		it('Groß-/Kleinschreibung der E-Mail umgeht die Begrenzung nicht', async () => {
			for (let i = 0; i < 5; i++) await anmelden(i % 2 ? 'ANNA@beispiel.test' : 'anna@beispiel.test', 'falsch');
			const r = await anmelden('Anna@Beispiel.Test', PASSWORT);
			expect(r.ergebnis).toMatchObject({ status: 429 });
		});

		it('erfolgreiche Anmeldung setzt den Zähler zurück', async () => {
			for (let i = 0; i < 4; i++) await anmelden('anna@beispiel.test', 'falsch');
			expect((await anmelden('anna@beispiel.test', PASSWORT)).umleitung?.status).toBe(303);
			for (let i = 0; i < 4; i++) {
				expect((await anmelden('anna@beispiel.test', 'falsch')).ergebnis).toMatchObject({ status: 400 });
			}
		});

		it('load: angemeldete Nutzer werden von der Anmeldeseite weggeleitet', () => {
			expect(() => load({ locals: { nutzer: { id: 'x' } } } as never)).toThrow();
			expect(load({ locals: { nutzer: null } } as never)).toBeUndefined();
		});
	});

	describe('hooks.server handle', () => {
		async function mitCookie(token: string | undefined) {
			const cookies = fakeCookies(token ? { [COOKIE_NAME]: token } : {});
			const event = { cookies, locals: {} as { nutzer?: unknown }, url: new URL('http://localhost/') };
			await handle({ event: event as never, resolve: async () => new Response('ok') });
			return { event, cookies };
		}

		it('gültige Sitzung → locals.nutzer gesetzt', async () => {
			const token = await neueSitzung(benutzerA);
			const { event } = await mitCookie(token);
			expect(event.locals.nutzer).toMatchObject({ id: benutzerA, betriebId: betriebA });
		});

		it('kein Cookie → locals.nutzer null', async () => {
			const { event } = await mitCookie(undefined);
			expect(event.locals.nutzer).toBeNull();
		});

		it('abgelaufene Sitzung → locals.nutzer null und Cookie wird entfernt', async () => {
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${benutzerA}, now() - interval '1 minute')`;
			const { event, cookies } = await mitCookie(token);
			expect(event.locals.nutzer).toBeNull();
			expect(cookies.geloescht).toContain(COOKIE_NAME);
		});

		it('Sitzung eines gesperrten Betriebs → locals.nutzer null', async () => {
			const token = await neueSitzung(benutzerGesperrt);
			const { event } = await mitCookie(token);
			expect(event.locals.nutzer).toBeNull();
		});
	});

	describe('Abmelden', () => {
		it('abmelden löscht Sitzung und Cookie', async () => {
			const token = await neueSitzung(benutzerA);
			const cookies = fakeCookies({ [COOKIE_NAME]: token });
			const antwort = await abmelden({ cookies, locals: { nutzer: null } } as never);
			expect(antwort.status).toBe(303);
			expect(antwort.headers.get('location')).toBe('/anmelden');
			expect(cookies.geloescht).toContain(COOKIE_NAME);
			expect(await pruefeSitzung(token)).toBeNull();
			const rest = await root`select 1 from app.sitzungen where token_hash = ${sha256(token)}`;
			expect(rest).toHaveLength(0);
		});

		it('abmelden ohne Cookie ist unschädlich', async () => {
			const antwort = await abmelden({ cookies: fakeCookies(), locals: { nutzer: null } } as never);
			expect(antwort.status).toBe(303);
		});
	});
});
