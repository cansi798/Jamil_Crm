import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import { hashePasswort, pruefePasswort } from '../../src/lib/server/auth/passwort';
import { leereVersuche } from '../../src/lib/server/auth/ratelimit';
import { COOKIE_NAME, loescheSitzung, neueSitzung, pruefeSitzung, SitzungVerweigert } from '../../src/lib/server/auth/sitzung';
import { actions, load } from '../../src/routes/anmelden/+page.server';
import { POST as abmelden } from '../../src/routes/api/abmelden/+server';
import { handle } from '../../src/hooks.server';

// Wrapper um pruefePasswort, damit ein Test sehen kann, womit die Anmelde-Aktion gerufen hat.
vi.mock('../../src/lib/server/auth/passwort', async (original) => {
	const echt = await original<typeof import('../../src/lib/server/auth/passwort')>();
	return { ...echt, pruefePasswort: vi.fn(echt.pruefePasswort) };
});

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

function loginEvent(email: string, passwort: string, cookieStart: Record<string, string> = {}) {
	const form = new FormData();
	form.set('email', email);
	form.set('passwort', passwort);
	const cookies = fakeCookies(cookieStart);
	const event = {
		request: new Request('http://localhost/anmelden', { method: 'POST', body: form }),
		cookies,
		locals: { nutzer: null }
	};
	return { event: event as never, cookies };
}

/** Führt die Anmelde-Aktion aus; redirect() wirft, fail() wird zurückgegeben. */
async function anmelden(email: string, passwort: string, cookieStart: Record<string, string> = {}) {
	const { event, cookies } = loginEvent(email, passwort, cookieStart);
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
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 2, onnotice: () => {} });
		const hash = await hashePasswort(PASSWORT);
		const [tarif] = await root`insert into app.tarife (schluessel, name) values ('basis', 'Basis') returning id`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${tarif.id}, 'aktiv') returning id`;
		[{ id: betriebGesperrt }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Gesperrt GmbH', ${tarif.id}, 'gesperrt') returning id`;
		const [rolleA] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Monteur', ${['kunden']}) returning id`;
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
				const [z] = await alsApp((tx) => tx`select id, email, name from app.benutzer where id = ${benutzerA}`);
				expect(z.name).toBe('Anna');
				const r = await alsApp((tx) => tx`update app.benutzer set name = 'Anna' where id = ${benutzerA}`);
				expect(r.count).toBe(1);
			} finally {
				await app.end();
			}
		});

		it('Funktionen: Eigentümer crm, SECURITY DEFINER, fester search_path, nur crm_auth darf ausführen', async () => {
			const funktionen = await root`
				select p.proname, pg_get_userbyid(p.proowner) as eigentuemer, p.prosecdef, p.proconfig,
					has_function_privilege('crm_auth', p.oid, 'execute') as auth_darf,
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
				expect(f.auth_darf, f.proname).toBe(true);
				expect(f.app_darf, f.proname).toBe(false);
				expect(f.admin_darf, f.proname).toBe(false);
				expect(f.public_darf, f.proname).toBe(false);
			}
		});

		it('crm_app kann keine der vier Funktionen aufrufen (keine Sitzung für fremde Benutzer erzeugbar)', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				const aufrufe = [
					() => app`select * from app.anmeldung_finden(${'anna@beispiel.test'}::public.citext)`,
					() => app`select app.sitzung_anlegen(${adminId}::uuid, ${sha256('x')}::bytea, now() + interval '1 day')`,
					() => app`select * from app.sitzung_pruefen(${sha256('x')}::bytea)`,
					() => app`select app.sitzung_loeschen(${sha256('x')}::bytea)`
				];
				for (const aufruf of aufrufe) await expect(aufruf()).rejects.toThrow(/permission denied/);
			} finally {
				await app.end();
			}
			const rest = await root`select 1 from app.sitzungen where benutzer_id = ${adminId}`;
			expect(rest).toHaveLength(0);
		});

		it('sitzung_anlegen verweigert (false, keine Zeile) bei inaktivem Benutzer und gesperrtem Betrieb', async () => {
			const versuche: [string, string, boolean][] = [
				['aktiv', benutzerA, true],
				['inaktiv', benutzerInaktiv, false],
				['gesperrt', benutzerGesperrt, false]
			];
			for (const [name, benutzer, erwartet] of versuche) {
				const h = sha256(`anlegen-${name}`);
				const [z] = await systemAbfrage(
					(sql) => sql`select app.sitzung_anlegen(${benutzer}::uuid, ${h}::bytea, now() + interval '1 day') as ok`
				);
				expect(z.ok, name).toBe(erwartet);
				const zeilen = await root`select 1 from app.sitzungen where token_hash = ${h}`;
				expect(zeilen, name).toHaveLength(erwartet ? 1 : 0);
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
				rolle_rechte: ['kunden'], betrieb_status: 'aktiv', verlaengert: true
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
				benutzer_id: adminId, betrieb_id: null, ist_admin: true, rolle_rechte: [], betrieb_status: null,
				verlaengert: true
			});
		});

		it('sitzung_pruefen: eine frisch verlängerte Sitzung wird nicht erneut geschrieben (verlaengert = false)', async () => {
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${benutzerA}, now() + interval '29 days 12 hours')`;
			await root`update app.benutzer set letzte_aktivitaet = null where id = ${benutzerA}`;
			const [z] = await systemAbfrage(
				(sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`
			);
			expect(z.benutzer_id).toBe(benutzerA);
			expect(z.verlaengert).toBe(false);
			const [vorher] = await root`select laeuft_ab::text as ab from app.sitzungen where token_hash = ${sha256(token)}`;
			await systemAbfrage((sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`);
			const [nachher] = await root`select laeuft_ab::text as ab from app.sitzungen where token_hash = ${sha256(token)}`;
			expect(nachher.ab).toBe(vorher.ab);
			const [b] = await root`select letzte_aktivitaet from app.benutzer where id = ${benutzerA}`;
			expect(b.letzte_aktivitaet).toBeNull();
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

		it('neueSitzung wirft SitzungVerweigert für gesperrten Betrieb und inaktiven Benutzer', async () => {
			await expect(neueSitzung(benutzerGesperrt)).rejects.toBeInstanceOf(SitzungVerweigert);
			await expect(neueSitzung(benutzerInaktiv)).rejects.toBeInstanceOf(SitzungVerweigert);
		});

		it('pruefeSitzung liefert Nutzer; loescheSitzung macht sie ungültig', async () => {
			const token = await neueSitzung(benutzerA);
			expect(await pruefeSitzung(token)).toEqual({
				id: benutzerA, betriebId: betriebA, istAdmin: false,
				rechte: ['kunden'], betriebStatus: 'aktiv'
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

		it('inaktiver Benutzer und gesperrter Betrieb: richtiges Passwort → gleiche Meldung wie bei falschem Passwort, keine Sitzung', async () => {
			const inaktiv = await anmelden('inaktiv@beispiel.test', PASSWORT);
			expect(inaktiv.umleitung).toBeNull();
			expect(inaktiv.ergebnis).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
			// gesperrter Betrieb: keine Sitzung, kein Cookie, dieselbe neutrale Meldung
			await root`delete from app.sitzungen where benutzer_id = ${benutzerGesperrt}`;
			const gesperrt = await anmelden('gesperrt@beispiel.test', PASSWORT);
			expect(gesperrt.umleitung).toBeNull();
			expect(gesperrt.cookies.gesetzt).toHaveLength(0);
			expect(gesperrt.ergebnis).toMatchObject({ status: 400, data: { fehler: FALSCH_MELDUNG } });
			const zeilen = await root`select 1 from app.sitzungen where benutzer_id = ${benutzerGesperrt}`;
			expect(zeilen).toHaveLength(0);
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

		it('Anmeldung mit vorhandenem Sitzungs-Cookie löscht die alte Sitzung', async () => {
			const alt = await neueSitzung(benutzerA);
			const { umleitung, cookies } = await anmelden('anna@beispiel.test', PASSWORT, { [COOKIE_NAME]: alt });
			expect(umleitung?.status).toBe(303);
			expect(await pruefeSitzung(alt)).toBeNull();
			const rest = await root`select 1 from app.sitzungen where token_hash = ${sha256(alt)}`;
			expect(rest).toHaveLength(0);
			expect(await pruefeSitzung(cookies.gesetzt[0].wert)).not.toBeNull();
		});

		it('bei unbekannter E-Mail wird trotzdem ein Argon2id-Dummy-Hash geprüft (nicht der eines Kontos)', async () => {
			const spion = vi.mocked(pruefePasswort);
			spion.mockClear();
			await anmelden('niemand@beispiel.test', 'irgendwas');
			expect(spion).toHaveBeenCalledTimes(1);
			const [hash, passwort] = spion.mock.calls[0];
			expect(hash).toMatch(/^\$argon2id\$/);
			expect(passwort).toBe('irgendwas');
			const echte = await root`select passwort_hash from app.benutzer`;
			expect(echte.map((z) => z.passwort_hash)).not.toContain(hash);

			spion.mockClear();
			await anmelden('anna@beispiel.test', 'falsch');
			expect(spion).toHaveBeenCalledTimes(1);
			expect(echte.map((z) => z.passwort_hash)).toContain(spion.mock.calls[0][0]);
		});

		it('load: angemeldete Nutzer werden von der Anmeldeseite weggeleitet', () => {
			expect(() => load({ locals: { nutzer: { id: 'x' } }, url: new URL('http://localhost/anmelden') } as never)).toThrow();
			expect(load({ locals: { nutzer: null }, url: new URL('http://localhost/anmelden') } as never)).toEqual({ hinweis: null });
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

		it('Sitzung älter als die Schwelle: Cookie wird mit 30 Tagen neu gesetzt, DB verlängert', async () => {
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${benutzerA}, now() + interval '10 days')`;
			const { event, cookies } = await mitCookie(token);
			expect(event.locals.nutzer).toMatchObject({ id: benutzerA });
			expect(cookies.gesetzt).toHaveLength(1);
			expect(cookies.gesetzt[0]).toMatchObject({ name: COOKIE_NAME, wert: token });
			expect(cookies.gesetzt[0].opts).toMatchObject({
				httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60
			});
			const [{ tage }] = await root`
				select extract(epoch from (laeuft_ab - now())) / 86400 as tage from app.sitzungen where token_hash = ${sha256(token)}`;
			expect(Number(tage)).toBeGreaterThan(29.99);
		});

		it('frische Sitzung: weder Cookie noch DB-Schreibzugriff', async () => {
			const token = await neueSitzung(benutzerA);
			const [vorher] = await root`select laeuft_ab::text as ab from app.sitzungen where token_hash = ${sha256(token)}`;
			const { event, cookies } = await mitCookie(token);
			expect(event.locals.nutzer).toMatchObject({ id: benutzerA });
			expect(cookies.gesetzt).toHaveLength(0);
			const [nachher] = await root`select laeuft_ab::text as ab from app.sitzungen where token_hash = ${sha256(token)}`;
			expect(nachher.ab).toBe(vorher.ab);
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
			const token = randomBytes(32).toString('base64url');
			await root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${sha256(token)}, ${benutzerGesperrt}, now() + interval '1 day')`;
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
