import { createHash } from 'node:crypto';
import postgres from 'postgres';
import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import { hashePasswort } from '../../src/lib/server/auth/passwort';
import { leereVersuche } from '../../src/lib/server/auth/ratelimit';
import { COOKIE_NAME, neueSitzung, pruefeSitzung, SitzungVerweigert } from '../../src/lib/server/auth/sitzung';
import { VORSITZUNG_COOKIE } from '../../src/lib/server/auth/vorsitzung';
import { neuesTotpGeheimnis } from '../../src/lib/server/auth/totp';
import { actions as anmeldeAktion } from '../../src/routes/anmelden/+page.server';
import { actions as codeAktion, load as codeLoad } from '../../src/routes/anmelden/zweiter-faktor/+page.server';
import { actions as einrichtungAktion, load as einrichtungLoad } from '../../src/routes/(app)/konto/zwei-faktor/+page.server';
import { handle } from '../../src/hooks.server';

const PASSWORT = 'richtiges-Passwort-1';
const SCHRITT_MS = 30_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Code, den eine Authenticator-App zum Zeitpunkt `zeit` anzeigt. */
function code(geheimnis: string, zeit: number = Date.now()): string {
	return new OTPAuth.TOTP({
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(geheimnis)
	}).generate({ timestamp: zeit });
}

function fakeCookies(start: Record<string, string> = {}) {
	const speicher = new Map(Object.entries(start));
	const gesetzt: { name: string; wert: string; opts: Record<string, unknown> }[] = [];
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
type Cookies = ReturnType<typeof fakeCookies>;

type Ausgang = {
	ergebnis: unknown;
	umleitung: null | { status: number; location: string };
};

/** Führt einen Handler aus; redirect() wirft, fail() wird zurückgegeben. */
async function ausfuehren(fn: () => unknown): Promise<Ausgang> {
	try {
		return { ergebnis: await fn(), umleitung: null };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.status === 'number' && typeof r.location === 'string') {
			return { ergebnis: null, umleitung: { status: r.status, location: r.location } };
		}
		throw e;
	}
}

function formEvent(cookies: Cookies, felder: Record<string, string>, pfad = '/') {
	const form = new FormData();
	for (const [k, v] of Object.entries(felder)) form.set(k, v);
	return {
		request: new Request(`http://localhost${pfad}`, { method: 'POST', body: form }),
		cookies,
		locals: { nutzer: null },
		url: new URL(`http://localhost${pfad}`)
	} as never;
}
const seitenEvent = (cookies: Cookies, nutzer: unknown = null, kopfzeilen: Record<string, string> = {}) =>
	({
		cookies,
		locals: { nutzer },
		url: new URL('http://localhost/'),
		setHeaders: (h: Record<string, string>) => Object.assign(kopfzeilen, h)
	}) as never;

const anmelden = (cookies: Cookies, email: string, passwort = PASSWORT) =>
	ausfuehren(() => anmeldeAktion.default(formEvent(cookies, { email, passwort }, '/anmelden')));

describe('Zwei-Faktor-Anmeldung', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string;
	let chefOhne: string, chefMit: string, monteur: string, monteurMit: string, adminOhne: string, adminMit: string;
	let geheimnisChefMit: string, geheimnisMonteurMit: string;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 2, onnotice: () => {} });
		const hash = await hashePasswort(PASSWORT);
		const [tarif] = await root`select id from app.tarife where schluessel = 'basis'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${tarif.id}, 'aktiv') returning id`;
		const [chefRolle] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Chef', ${['kunden', 'einstellungen']}) returning id`;
		const [monteurRolle] = await root`
			insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Monteur', ${['kunden']}) returning id`;
		const neu = async (email: string, rolle: string | null, betrieb: string | null) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betrieb}, ${email}, ${email}, ${hash}, ${rolle}) returning id`)[0].id as string;
		chefOhne = await neu('chef-ohne@beispiel.test', chefRolle.id, betriebA);
		chefMit = await neu('chef-mit@beispiel.test', chefRolle.id, betriebA);
		monteur = await neu('monteur@beispiel.test', monteurRolle.id, betriebA);
		monteurMit = await neu('monteur-mit@beispiel.test', monteurRolle.id, betriebA);
		adminOhne = await neu('admin-ohne@beispiel.test', null, null);
		adminMit = await neu('admin-mit@beispiel.test', null, null);
		await root`insert into app.plattform_admins (benutzer_id) values (${adminOhne}), (${adminMit})`;
		geheimnisChefMit = neuesTotpGeheimnis('x').geheimnis;
		geheimnisMonteurMit = neuesTotpGeheimnis('x').geheimnis;
		await root`update app.benutzer set totp_geheim = ${geheimnisChefMit}, totp_aktiv = true where id = ${chefMit}`;
		await root`update app.benutzer set totp_geheim = ${geheimnisMonteurMit}, totp_aktiv = true where id = ${monteurMit}`;
		const geheimnisAdmin = neuesTotpGeheimnis('x').geheimnis;
		await root`update app.benutzer set totp_geheim = ${geheimnisAdmin}, totp_aktiv = true where id = ${adminMit}`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		leereVersuche();
		await root`delete from app.sitzungen`;
		await root`update app.benutzer set totp_letzter_schritt = null, totp_fehlversuche = 0, totp_gesperrt_bis = null, totp_sperr_stufe = 0`;
		await root`update app.benutzer set totp_geheim = null, totp_aktiv = false where id in (${chefOhne}, ${adminOhne})`;
	});

	const vorsitzungen = (benutzer: string) =>
		root`select laeuft_ab, zweiter_faktor_offen from app.sitzungen where benutzer_id = ${benutzer} and zweiter_faktor_offen`;
	const vollSitzungen = (benutzer: string) =>
		root`select 1 from app.sitzungen where benutzer_id = ${benutzer} and not zweiter_faktor_offen`;

	describe('Anmeldung nach dem Passwort', () => {
		it('Chef ohne 2FA erhält nach Passwort nur Vor-Sitzung und Weiterleitung zur Einrichtung', async () => {
			const cookies = fakeCookies();
			const { umleitung } = await anmelden(cookies, 'chef-ohne@beispiel.test');
			expect(umleitung).toEqual({ status: 303, location: '/konto/zwei-faktor' });
			expect(cookies.gesetzt.map((c) => c.name)).toEqual([VORSITZUNG_COOKIE]);
			expect(VORSITZUNG_COOKIE).toBe('crm_vorsitzung');
			expect(cookies.gesetzt[0].opts).toMatchObject({
				httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 5 * 60
			});
			expect(await vollSitzungen(chefOhne)).toHaveLength(0);
			const vor = await vorsitzungen(chefOhne);
			expect(vor).toHaveLength(1);
			const [{ sek }] = await root`
				select extract(epoch from (laeuft_ab - now())) as sek from app.sitzungen where benutzer_id = ${chefOhne}`;
			expect(Number(sek)).toBeGreaterThan(5 * 60 - 10);
			expect(Number(sek)).toBeLessThanOrEqual(5 * 60);
			// das Cookie enthält das Token, in der Datenbank steht nur der Hash
			const gespeichert = await root`select token_hash from app.sitzungen where benutzer_id = ${chefOhne}`;
			expect(Buffer.from(gespeichert[0].token_hash).equals(sha256(cookies.gesetzt[0].wert))).toBe(true);
		});

		it('Plattform-Admin ohne 2FA → Vor-Sitzung und Einrichtung', async () => {
			const cookies = fakeCookies();
			const { umleitung } = await anmelden(cookies, 'admin-ohne@beispiel.test');
			expect(umleitung).toEqual({ status: 303, location: '/konto/zwei-faktor' });
			expect(cookies.gesetzt.map((c) => c.name)).toEqual([VORSITZUNG_COOKIE]);
			expect(await vollSitzungen(adminOhne)).toHaveLength(0);
		});

		it('Monteur ohne 2FA → volle Sitzung', async () => {
			const cookies = fakeCookies();
			const { umleitung } = await anmelden(cookies, 'monteur@beispiel.test');
			expect(umleitung).toEqual({ status: 303, location: '/' });
			expect(cookies.gesetzt.map((c) => c.name)).toEqual([COOKIE_NAME]);
			expect((await pruefeSitzung(cookies.gesetzt[0].wert))?.id).toBe(monteur);
			// R13: ohne zweiten Faktor entstanden → Kennzeichen false (für den Monteur unschädlich)
			const [s] = await root`select mit_zweitem_faktor from app.sitzungen where token_hash = ${sha256(cookies.gesetzt[0].wert)}`;
			expect(s.mit_zweitem_faktor).toBe(false);
			expect(await vorsitzungen(monteur)).toHaveLength(0);
		});

		it('aktive 2FA verlangt immer einen Code, auch bei Rolle ohne Einstellungsrecht', async () => {
			const cookies = fakeCookies();
			const { umleitung } = await anmelden(cookies, 'monteur-mit@beispiel.test');
			expect(umleitung).toEqual({ status: 303, location: '/anmelden/zweiter-faktor' });
			expect(cookies.gesetzt.map((c) => c.name)).toEqual([VORSITZUNG_COOKIE]);
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('Chef mit aktiver 2FA → Code-Seite', async () => {
			const { umleitung } = await anmelden(fakeCookies(), 'chef-mit@beispiel.test');
			expect(umleitung).toEqual({ status: 303, location: '/anmelden/zweiter-faktor' });
		});

		it('Anmeldung löscht eine alte Vor-Sitzung dieses Browsers', async () => {
			const cookies = fakeCookies();
			await anmelden(cookies, 'chef-ohne@beispiel.test');
			const alt = cookies.gesetzt[0].wert;
			await anmelden(cookies, 'chef-ohne@beispiel.test');
			const rest = await root`select 1 from app.sitzungen where token_hash = ${sha256(alt)}`;
			expect(rest).toHaveLength(0);
			expect(await vorsitzungen(chefOhne)).toHaveLength(1);
		});

		it('neueSitzung (ohne Code) wird für Konten mit Pflicht-2FA verweigert', async () => {
			await expect(neueSitzung(chefOhne)).rejects.toBeInstanceOf(SitzungVerweigert);
			await expect(neueSitzung(adminOhne)).rejects.toBeInstanceOf(SitzungVerweigert);
			await expect(neueSitzung(monteurMit)).rejects.toBeInstanceOf(SitzungVerweigert);
			await expect(neueSitzung(monteur)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
		});

		it('gesperrter Betrieb: Chef mit richtigem Passwort bekommt auch keine Vor-Sitzung', async () => {
			await root`update app.betriebe set abo_status = 'gesperrt' where id = ${betriebA}`;
			try {
				const cookies = fakeCookies();
				const { ergebnis, umleitung } = await anmelden(cookies, 'chef-ohne@beispiel.test');
				expect(umleitung).toBeNull();
				expect(ergebnis).toMatchObject({ status: 400, data: { fehler: 'E-Mail oder Passwort ist falsch.' } });
				expect(cookies.gesetzt).toHaveLength(0);
				expect(await vorsitzungen(chefOhne)).toHaveLength(0);
			} finally {
				await root`update app.betriebe set abo_status = 'aktiv' where id = ${betriebA}`;
			}
		});
	});

	describe('Vor-Sitzung ist keine Sitzung', () => {
		it('als Sitzungs-Cookie verwendet: weder pruefeSitzung noch hooks noch sitzung_pruefen akzeptieren sie', async () => {
			const cookies = fakeCookies();
			await anmelden(cookies, 'monteur-mit@beispiel.test');
			const token = cookies.gesetzt[0].wert;
			expect(await pruefeSitzung(token)).toBeNull();
			const zeilen = await systemAbfrage((sql) => sql`select * from app.sitzung_pruefen(${sha256(token)}::bytea)`);
			expect(zeilen).toHaveLength(0);
			const c2 = fakeCookies({ [COOKIE_NAME]: token });
			const event = {
				cookies: c2,
				locals: {} as { nutzer?: unknown },
				url: new URL('http://localhost/'),
				request: new Request('http://localhost/')
			};
			await handle({ event: event as never, resolve: async () => new Response('ok') });
			expect(event.locals.nutzer).toBeNull();
		});

		it('hooks lesen das Vor-Sitzungs-Cookie nicht', async () => {
			const cookies = fakeCookies();
			await anmelden(cookies, 'monteur-mit@beispiel.test');
			const c2 = fakeCookies({ [VORSITZUNG_COOKIE]: cookies.gesetzt[0].wert });
			const event = {
				cookies: c2,
				locals: {} as { nutzer?: unknown },
				url: new URL('http://localhost/'),
				request: new Request('http://localhost/')
			};
			await handle({ event: event as never, resolve: async () => new Response('ok') });
			expect(event.locals.nutzer).toBeNull();
		});
	});

	describe('Code-Seite (/anmelden/zweiter-faktor)', () => {
		async function mitVorsitzung(email: string) {
			const cookies = fakeCookies();
			await anmelden(cookies, email);
			return cookies;
		}

		it('load: ohne Vor-Sitzung → zur Anmeldung; abgelaufen → zur Anmeldung', async () => {
			expect((await ausfuehren(() => codeLoad(seitenEvent(fakeCookies())))).umleitung).toEqual({
				status: 303, location: '/anmelden?hinweis=abgelaufen'
			});
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			await root`update app.sitzungen set laeuft_ab = now() - interval '1 second' where benutzer_id = ${monteurMit}`;
			expect((await ausfuehren(() => codeLoad(seitenEvent(cookies)))).umleitung?.location).toMatch(/^\/anmelden/);
		});

		it('load: Vor-Sitzung eines Kontos ohne aktive 2FA → zur Einrichtung', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			expect((await ausfuehren(() => codeLoad(seitenEvent(cookies)))).umleitung).toEqual({
				status: 303, location: '/konto/zwei-faktor'
			});
		});

		it('load: gültige Vor-Sitzung → keine Weiterleitung', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const r = await ausfuehren(() => codeLoad(seitenEvent(cookies)));
			expect(r.umleitung).toBeNull();
		});

		it('gültiger Code → volle Sitzung, Vor-Sitzung weg, Cookies getauscht', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const vorToken = cookies.gesetzt[0].wert;
			const { umleitung } = await ausfuehren(() =>
				codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) }))
			);
			expect(umleitung).toEqual({ status: 303, location: '/' });
			const voll = cookies.gesetzt.find((c) => c.name === COOKIE_NAME);
			expect(voll).toBeDefined();
			expect(voll!.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
			expect((await pruefeSitzung(voll!.wert))?.id).toBe(monteurMit);
			expect(voll!.wert).not.toBe(vorToken);
			expect(cookies.geloescht).toContain(VORSITZUNG_COOKIE);
			expect(await vorsitzungen(monteurMit)).toHaveLength(0);
			expect(await pruefeSitzung(vorToken)).toBeNull();
		});

		it('falscher Code → 400, keine Sitzung, Vor-Sitzung bleibt', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const richtig = code(geheimnisMonteurMit);
			const falsch = richtig === '000000' ? '000001' : '000000';
			const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: falsch })));
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis).toMatchObject({ status: 400 });
			expect(cookies.gesetzt.map((c) => c.name)).toEqual([VORSITZUNG_COOKIE]);
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
			expect(await vorsitzungen(monteurMit)).toHaveLength(1);
		});

		it('fehlendes Feld / Müll → 400 ohne Sitzung', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			for (const felder of [{}, { code: '' }, { code: 'abc' }, { code: '1'.repeat(500) }] as Record<string, string>[]) {
				const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, felder)));
				expect(r.ergebnis).toMatchObject({ status: 400 });
			}
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('derselbe Code kann nicht zweimal verwendet werden (auch nicht mit neuer Vor-Sitzung)', async () => {
			const c1 = await mitVorsitzung('monteur-mit@beispiel.test');
			const jetzt = Date.now();
			const einmal = code(geheimnisMonteurMit, jetzt);
			expect((await ausfuehren(() => codeAktion.default(formEvent(c1, { code: einmal })))).umleitung?.location).toBe('/');
			await root`delete from app.sitzungen`;
			const c2 = await mitVorsitzung('monteur-mit@beispiel.test');
			const r = await ausfuehren(() => codeAktion.default(formEvent(c2, { code: einmal })));
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis).toMatchObject({ status: 400 });
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('ein Code eines früheren Zeitschritts als der zuletzt benutzte wird abgelehnt, ein späterer akzeptiert', async () => {
			const c1 = await mitVorsitzung('monteur-mit@beispiel.test');
			const jetzt = Date.now();
			// zuerst der Code des nächsten Fensters (noch im ±1-Fenster)
			const spaeter = code(geheimnisMonteurMit, jetzt + SCHRITT_MS);
			expect((await ausfuehren(() => codeAktion.default(formEvent(c1, { code: spaeter })))).umleitung?.location).toBe('/');
			await root`delete from app.sitzungen`;
			const c2 = await mitVorsitzung('monteur-mit@beispiel.test');
			const frueher = code(geheimnisMonteurMit, jetzt);
			const r = await ausfuehren(() => codeAktion.default(formEvent(c2, { code: frueher })));
			expect(r.ergebnis).toMatchObject({ status: 400 });
			expect(await vollSitzungen(monteurMit)).toHaveLength(0); // die erste Sitzung wurde oben gelöscht, keine neue
		});

		it('gleichzeitige Eingabe desselben Codes in zwei Vor-Sitzungen: höchstens eine gewinnt', async () => {
			const c1 = await mitVorsitzung('monteur-mit@beispiel.test');
			const c2 = await mitVorsitzung('monteur-mit@beispiel.test');
			const einmal = code(geheimnisMonteurMit);
			const [a, b] = await Promise.all([
				ausfuehren(() => codeAktion.default(formEvent(c1, { code: einmal }))),
				ausfuehren(() => codeAktion.default(formEvent(c2, { code: einmal })))
			]);
			const erfolge = [a, b].filter((x) => x.umleitung?.location === '/');
			expect(erfolge).toHaveLength(1);
			expect(await vollSitzungen(monteurMit)).toHaveLength(1);
		});

		it('5 falsche Codes → Vor-Sitzung gelöscht, zurück zur Anmeldung; richtiger Code hilft dann nicht mehr', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const falsch = code(geheimnisMonteurMit) === '123456' ? '654321' : '123456';
			for (let i = 1; i <= 4; i++) {
				const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: falsch })));
				expect(r.ergebnis, `Versuch ${i}`).toMatchObject({ status: 400 });
			}
			const fuenfter = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: falsch })));
			expect(fuenfter.umleitung?.status).toBe(303);
			expect(fuenfter.umleitung?.location).toMatch(/^\/anmelden/);
			expect(await vorsitzungen(monteurMit)).toHaveLength(0);
			const danach = await ausfuehren(() =>
				codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) }))
			);
			expect(danach.umleitung?.location).toMatch(/^\/anmelden/);
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('Fehlversuche zählen je Benutzer, nicht je Vor-Sitzung: neue Anmeldungen setzen den Zähler nicht zurück', async () => {
			const falsch = code(geheimnisMonteurMit) === '123456' ? '654321' : '123456';
			let gesperrt = false;
			for (let runde = 0; runde < 4 && !gesperrt; runde++) {
				const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
				for (let i = 0; i < 2; i++) {
					await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: falsch })));
				}
				const [{ n }] = await root`select totp_fehlversuche as n from app.benutzer where id = ${monteurMit}`;
				gesperrt = n === 0; // nach dem 5. Fehlversuch zurückgesetzt und gesperrt
			}
			const [b] = await root`select totp_gesperrt_bis from app.benutzer where id = ${monteurMit}`;
			expect(b.totp_gesperrt_bis).not.toBeNull();
			// Passwort stimmt, aber Konto ist gesperrt: keine neue Vor-Sitzung
			const cookies = fakeCookies();
			const r = await anmelden(cookies, 'monteur-mit@beispiel.test');
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis).toMatchObject({ status: 429 });
			expect(cookies.gesetzt).toHaveLength(0);
			expect(await vorsitzungen(monteurMit)).toHaveLength(0);
		});

		it('nach Ablauf der Sperre geht die Anmeldung wieder; erfolgreicher Code setzt die Fehlversuche zurück', async () => {
			await root`update app.benutzer set totp_gesperrt_bis = now() - interval '1 second', totp_fehlversuche = 3 where id = ${monteurMit}`;
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) })));
			expect(r.umleitung?.location).toBe('/');
			const [b] = await root`select totp_fehlversuche, totp_gesperrt_bis from app.benutzer where id = ${monteurMit}`;
			expect(b.totp_fehlversuche).toBe(0);
			expect(b.totp_gesperrt_bis).toBeNull();
		});

		it('Sperre verdoppelt sich bei jeder weiteren Sperre (15 Min., 30, 60, …, höchstens 24 Std.); Erfolg setzt zurück', async () => {
			const falsch = code(geheimnisMonteurMit) === '123456' ? '654321' : '123456';
			const sperrMinuten = async () => {
				const [b] = await root`
					select extract(epoch from (totp_gesperrt_bis - now())) / 60 as min, totp_sperr_stufe as stufe
					from app.benutzer where id = ${monteurMit}`;
				return { min: Number(b.min), stufe: b.stufe as number };
			};
			const sperreAusloesen = async () => {
				const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
				for (let i = 0; i < 5; i++) await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: falsch })));
			};
			for (const erwartet of [15, 30, 60, 120]) {
				await sperreAusloesen();
				const { min, stufe } = await sperrMinuten();
				expect(min, `Stufe ${stufe}`).toBeGreaterThan(erwartet - 1);
				expect(min).toBeLessThanOrEqual(erwartet);
				// Sperre läuft ab, Zähler der Fehlversuche ist 0, Stufe bleibt (aufeinanderfolgende Sperren)
				await root`update app.benutzer set totp_gesperrt_bis = now() - interval '1 second' where id = ${monteurMit}`;
			}
			// Obergrenze 24 Stunden
			await root`update app.benutzer set totp_sperr_stufe = 15 where id = ${monteurMit}`;
			await sperreAusloesen();
			const { min } = await sperrMinuten();
			expect(min).toBeGreaterThan(24 * 60 - 1);
			expect(min).toBeLessThanOrEqual(24 * 60);
			// Erfolgreicher Code setzt die Stufe zurück
			await root`update app.benutzer set totp_gesperrt_bis = now() - interval '1 second' where id = ${monteurMit}`;
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			const ok = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) })));
			expect(ok.umleitung).toEqual({ status: 303, location: '/' });
			const [b] = await root`select totp_sperr_stufe, totp_gesperrt_bis from app.benutzer where id = ${monteurMit}`;
			expect(b.totp_sperr_stufe).toBe(0);
			expect(b.totp_gesperrt_bis).toBeNull();
		});

		it('gesperrte Konten: auch ein bereits vorhandene Vor-Sitzung nimmt keinen Code mehr an', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			await root`update app.benutzer set totp_gesperrt_bis = now() + interval '10 minutes' where id = ${monteurMit}`;
			const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) })));
			expect(r.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=gesperrt' });
			expect(r.ergebnis).toBeNull();
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('abgelaufene Vor-Sitzung nimmt keinen Code mehr an', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			await root`update app.sitzungen set laeuft_ab = now() - interval '1 second' where benutzer_id = ${monteurMit}`;
			const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) })));
			expect(r.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=abgelaufen' });
			expect(await vollSitzungen(monteurMit)).toHaveLength(0);
		});

		it('Betrieb wird zwischen Passwort und Code gesperrt: keine volle Sitzung', async () => {
			const cookies = await mitVorsitzung('monteur-mit@beispiel.test');
			await root`update app.betriebe set abo_status = 'gesperrt' where id = ${betriebA}`;
			try {
				const r = await ausfuehren(() => codeAktion.default(formEvent(cookies, { code: code(geheimnisMonteurMit) })));
				expect(r.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=abgelaufen' });
				expect(await vollSitzungen(monteurMit)).toHaveLength(0);
			} finally {
				await root`update app.betriebe set abo_status = 'aktiv' where id = ${betriebA}`;
			}
		});

		it('Vor-Sitzung des Benutzers A kann den zweiten Faktor von Benutzer B nicht abschließen', async () => {
			// A hat eine gültige Vor-Sitzung. Selbst mit dem richtigen Code von B (den A hier "kennt") und mit
			// allen Mitteln, die Funktion mit dem Hash von A zu rufen, entsteht nie eine Sitzung für B.
			const cookiesA = await mitVorsitzung('monteur-mit@beispiel.test');
			const tokenA = cookiesA.gesetzt[0].wert;
			const r = await ausfuehren(() => codeAktion.default(formEvent(cookiesA, { code: code(geheimnisChefMit) })));
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis).toMatchObject({ status: 400 });
			const schritt = Math.floor(Date.now() / SCHRITT_MS);
			const neu = sha256('neu-fuer-b');
			const [z] = await systemAbfrage(
				(sql) => sql`select app.zweiten_faktor_abschliessen(${sha256(tokenA)}::bytea, ${schritt}::bigint, ${neu}::bytea, now() + interval '1 day') as ok`
			);
			// Der Schritt ist gültig und neu, die Funktion löst die Sitzung aber nur für den Benutzer von A ein
			expect(z.ok).toBe(true);
			const neue = await root`select benutzer_id from app.sitzungen where token_hash = ${neu}`;
			expect(neue).toHaveLength(1);
			expect(neue[0].benutzer_id).toBe(monteurMit);
			expect(await vollSitzungen(chefMit)).toHaveLength(0);
			const [b] = await root`select totp_letzter_schritt from app.benutzer where id = ${chefMit}`;
			expect(b.totp_letzter_schritt).toBeNull();
		});
	});

	describe('Einrichtung (/konto/zwei-faktor)', () => {
		async function mitVorsitzung(email: string) {
			const cookies = fakeCookies();
			await anmelden(cookies, email);
			return cookies;
		}
		type EinrichtungsDaten = { qr: string; geheimnis: string };
		const lade = async (cookies: Cookies) => (await einrichtungLoad(seitenEvent(cookies))) as EinrichtungsDaten;

		it('load: ohne Vor-Sitzung → zur Anmeldung', async () => {
			expect((await ausfuehren(() => einrichtungLoad(seitenEvent(fakeCookies())))).umleitung).toEqual({
				status: 303, location: '/anmelden?hinweis=abgelaufen'
			});
		});

		it('load: zeigt QR-Code (PNG-Data-URL) und Geheimnis als Text; Geheimnis bleibt bei Neuladen gleich', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const d = await lade(cookies);
			expect(d.qr).toMatch(/^data:image\/png;base64,/);
			const roh = d.geheimnis.replace(/\s/g, '');
			expect(roh).toMatch(/^[A-Z2-7]{32}$/);
			// Der Entwurf steht nur an der Vor-Sitzung, nie am Benutzer
			const [b] = await root`select totp_geheim, totp_aktiv from app.benutzer where id = ${chefOhne}`;
			expect(b.totp_geheim).toBeNull();
			expect(b.totp_aktiv).toBe(false);
			const [v] = await root`select totp_entwurf from app.sitzungen where token_hash = ${sha256(cookies.gesetzt[0].wert)}`;
			expect(v.totp_entwurf).toBe(roh);
			expect((await lade(cookies)).geheimnis).toBe(d.geheimnis);
		});

		it('load: Antwort mit Geheimnis und QR-Code wird nicht zwischengespeichert (Cache-Control: no-store)', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const kopf: Record<string, string> = {};
			await einrichtungLoad(seitenEvent(cookies, null, kopf));
			expect(kopf['cache-control']).toBe('no-store');
		});

		it('Entwurf gehört nur zu seiner Vor-Sitzung: eine zweite Vor-Sitzung desselben Kontos sieht ihn nicht', async () => {
			const a = await mitVorsitzung('chef-ohne@beispiel.test');
			const da = (await lade(a)).geheimnis.replace(/\s/g, '');
			const b = await mitVorsitzung('chef-ohne@beispiel.test');
			const db_ = (await lade(b)).geheimnis.replace(/\s/g, '');
			expect(db_).not.toBe(da);
			// ein Code zum Entwurf von A reicht in der Vor-Sitzung B nicht (und umgekehrt)
			const rb = await ausfuehren(() => einrichtungAktion.default(formEvent(b, { code: code(da) })));
			expect(rb.ergebnis).toMatchObject({ status: 400 });
			const [u] = await root`select totp_aktiv, totp_geheim from app.benutzer where id = ${chefOhne}`;
			expect(u.totp_aktiv).toBe(false);
			expect(u.totp_geheim).toBeNull();
			// Schließt der echte Chef (B) die Einrichtung ab, ist A damit hinfällig
			const ok = await ausfuehren(() => einrichtungAktion.default(formEvent(b, { code: code(db_) })));
			expect(ok.umleitung).toEqual({ status: 303, location: '/' });
			const [n] = await root`select totp_geheim from app.benutzer where id = ${chefOhne}`;
			expect(n.totp_geheim).toBe(db_);
			const ra = await ausfuehren(() => einrichtungAktion.default(formEvent(a, { code: code(da, Date.now() + SCHRITT_MS) })));
			expect(ra.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=abgelaufen' });
			const [n2] = await root`select totp_geheim from app.benutzer where id = ${chefOhne}`;
			expect(n2.totp_geheim).toBe(db_);
		});

		it('Entwurf einer abgelaufenen Vor-Sitzung kann nicht aktiviert werden', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const roh = (await lade(cookies)).geheimnis.replace(/\s/g, '');
			const token = cookies.gesetzt[0].wert;
			await root`update app.sitzungen set laeuft_ab = now() - interval '1 second' where benutzer_id = ${chefOhne}`;
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: code(roh) })));
			expect(r.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=abgelaufen' });
			// auch direkt über die Funktion
			const neu = sha256('neu-abgelaufen');
			const [z] = await systemAbfrage(
				(sql) => sql`select app.zweiten_faktor_abschliessen(${sha256(token)}::bytea, ${Math.floor(Date.now() / SCHRITT_MS)}::bigint, ${neu}::bytea, now() + interval '1 day') as ok`
			);
			expect(z.ok).toBe(false);
			expect(await root`select 1 from app.sitzungen where token_hash = ${neu}`).toHaveLength(0);
			const [u] = await root`select totp_aktiv, totp_geheim from app.benutzer where id = ${chefOhne}`;
			expect(u.totp_aktiv).toBe(false);
			expect(u.totp_geheim).toBeNull();
		});

		it('Einrichtung abschließen: richtiger Code → 2FA aktiv, volle Sitzung, Vor-Sitzung weg', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const d = await lade(cookies);
			const roh = d.geheimnis.replace(/\s/g, '');
			const vorToken = cookies.gesetzt[0].wert;
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: code(roh) })));
			expect(r.umleitung).toEqual({ status: 303, location: '/' });
			const [b] = await root`select totp_aktiv, totp_geheim from app.benutzer where id = ${chefOhne}`;
			expect(b.totp_aktiv).toBe(true);
			expect(b.totp_geheim).toBe(roh); // erst jetzt wird der Entwurf zum Geheimnis des Benutzers
			const voll = cookies.gesetzt.find((c) => c.name === COOKIE_NAME);
			expect((await pruefeSitzung(voll!.wert))?.id).toBe(chefOhne);
			// R13: die nach dem Code entstandene Sitzung trägt das Kennzeichen (sonst wiese sitzung_pruefen den Chef ab)
			const [s] = await root`select mit_zweitem_faktor from app.sitzungen where token_hash = ${sha256(voll!.wert)}`;
			expect(s.mit_zweitem_faktor).toBe(true);
			expect(await pruefeSitzung(vorToken)).toBeNull();
			expect(await vorsitzungen(chefOhne)).toHaveLength(0);
			expect(cookies.geloescht).toContain(VORSITZUNG_COOKIE);
		});

		it('Einrichtung mit falschem Code: 2FA bleibt inaktiv, keine Sitzung', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const d = await lade(cookies);
			const roh = d.geheimnis.replace(/\s/g, '');
			const falsch = code(roh) === '123456' ? '654321' : '123456';
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: falsch })));
			expect(r.ergebnis).toMatchObject({ status: 400 });
			const [b] = await root`select totp_aktiv from app.benutzer where id = ${chefOhne}`;
			expect(b.totp_aktiv).toBe(false);
			expect(await vollSitzungen(chefOhne)).toHaveLength(0);
		});

		it('Einrichtung ohne vorher geladene Seite (kein Geheimnis gespeichert) → kein Erfolg', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: '123456' })));
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis).toMatchObject({ status: 400 });
			const [b] = await root`select totp_aktiv from app.benutzer where id = ${chefOhne}`;
			expect(b.totp_aktiv).toBe(false);
		});

		it('5 falsche Codes bei der Einrichtung → Vor-Sitzung gelöscht', async () => {
			const cookies = await mitVorsitzung('chef-ohne@beispiel.test');
			const d = await lade(cookies);
			const roh = d.geheimnis.replace(/\s/g, '');
			const falsch = code(roh) === '123456' ? '654321' : '123456';
			for (let i = 0; i < 4; i++) await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: falsch })));
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: falsch })));
			expect(r.umleitung?.location).toMatch(/^\/anmelden/);
			expect(await vorsitzungen(chefOhne)).toHaveLength(0);
		});

		it('Konto mit aktiver 2FA: Einrichtungsseite zeigt das Geheimnis nie, sondern leitet zur Code-Seite', async () => {
			const cookies = await mitVorsitzung('chef-mit@beispiel.test');
			const r = await ausfuehren(() => einrichtungLoad(seitenEvent(cookies)));
			expect(r.umleitung).toEqual({ status: 303, location: '/anmelden/zweiter-faktor' });
			const [b] = await root`select totp_geheim from app.benutzer where id = ${chefMit}`;
			expect(b.totp_geheim).toBe(geheimnisChefMit); // nicht überschrieben
		});

		it('Konto mit aktiver 2FA: Einrichtungsaktion kann das Geheimnis nicht ersetzen', async () => {
			const cookies = await mitVorsitzung('chef-mit@beispiel.test');
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: code(geheimnisChefMit) })));
			expect(r.umleitung?.location).not.toBe('/');
			expect(await vollSitzungen(chefMit)).toHaveLength(0);
		});

		it('angemeldete Nutzer werden von der Einrichtungs- und der Code-Seite weggeleitet', async () => {
			expect((await ausfuehren(() => einrichtungLoad(seitenEvent(fakeCookies(), { id: 'x' })))).umleitung?.status).toBe(303);
			expect((await ausfuehren(() => codeLoad(seitenEvent(fakeCookies(), { id: 'x' })))).umleitung?.status).toBe(303);
		});
	});

	describe('SQL-Funktionen und Rechte', () => {
		const FUNKTIONEN = [
			'anmeldung_weiter', 'vorsitzung_daten', 'totp_geheimnis_vorbereiten', 'vorsitzung_fehlversuch',
			'zweiten_faktor_abschliessen'
		];

		it('Funktionen: Eigentümer crm, SECURITY DEFINER, fester search_path, nur crm_auth darf ausführen', async () => {
			const f = await root`
				select p.proname, pg_get_userbyid(p.proowner) as eigentuemer, p.prosecdef, p.proconfig,
					has_function_privilege('crm_auth', p.oid, 'execute') as auth_darf,
					has_function_privilege('crm_app', p.oid, 'execute') as app_darf,
					has_function_privilege('crm_admin', p.oid, 'execute') as admin_darf,
					has_function_privilege('public', p.oid, 'execute') as public_darf
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'app' and p.proname = any(${[...FUNKTIONEN, 'zweiter_faktor_noetig']})`;
			expect(f.map((x) => x.proname).sort()).toEqual([...FUNKTIONEN, 'zweiter_faktor_noetig'].sort());
			for (const x of f) {
				expect(x.eigentuemer, x.proname).toBe('crm');
				expect(x.prosecdef, x.proname).toBe(true);
				expect(String(x.proconfig), x.proname).toMatch(/search_path=app, pg_temp/);
				expect(x.auth_darf, x.proname).toBe(x.proname !== 'zweiter_faktor_noetig');
				expect(x.app_darf, x.proname).toBe(false);
				expect(x.admin_darf, x.proname).toBe(false);
				expect(x.public_darf, x.proname).toBe(false);
			}
		});

		it('crm_app kann die 2FA-Funktionen nicht aufrufen', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				const h = sha256('x');
				const aufrufe = [
					() => app`select app.anmeldung_weiter(${chefOhne}::uuid, ${h}::bytea, now(), ${sha256('y')}::bytea)`,
					() => app`select * from app.vorsitzung_daten(${h}::bytea)`,
					() => app`select app.totp_geheimnis_vorbereiten(${h}::bytea, 'AAAA')`,
					() => app`select app.vorsitzung_fehlversuch(${h}::bytea)`,
					() => app`select app.zweiten_faktor_abschliessen(${h}::bytea, 1, ${sha256('z')}::bytea, now())`,
					() => app`select app.zweiter_faktor_noetig(${chefOhne}::uuid)`
				];
				for (const aufruf of aufrufe) await expect(aufruf()).rejects.toThrow(/permission denied/);
			} finally {
				await app.end();
			}
		});

		it('crm_app kann totp_geheim, totp_aktiv und die übrigen 2FA-Spalten weder lesen noch ändern', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			const alsApp = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
				app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebA}, true)`;
					return fn(tx);
				}) as Promise<T>;
			try {
				for (const spalte of ['totp_geheim', 'totp_aktiv', 'totp_letzter_schritt', 'totp_fehlversuche', 'totp_gesperrt_bis', 'totp_sperr_stufe']) {
					await expect(alsApp((tx) => tx.unsafe(`select ${spalte} from app.benutzer`)), `select ${spalte}`)
						.rejects.toThrow(/permission denied/);
				}
				await expect(alsApp((tx) => tx`update app.benutzer set totp_aktiv = false where id = ${chefMit}`))
					.rejects.toThrow(/permission denied/);
				await expect(alsApp((tx) => tx`update app.benutzer set totp_geheim = 'AAAA' where id = ${chefMit}`))
					.rejects.toThrow(/permission denied/);
				await expect(alsApp((tx) => tx`update app.benutzer set totp_gesperrt_bis = null where id = ${chefMit}`))
					.rejects.toThrow(/permission denied/);
				await expect(alsApp((tx) => tx`select * from app.benutzer`)).rejects.toThrow(/permission denied/);
				// übrige Spalten bleiben nutzbar
				const [z] = await alsApp((tx) => tx`select id, email, name, aktiv from app.benutzer where id = ${chefMit}`);
				expect(z.id).toBe(chefMit);
				const r = await alsApp((tx) => tx`update app.benutzer set name = ${'chef-mit@beispiel.test'} where id = ${chefMit}`);
				expect(r.count).toBe(1);
			} finally {
				await app.end();
			}
			const [b] = await root`select totp_aktiv, totp_geheim from app.benutzer where id = ${chefMit}`;
			expect(b.totp_aktiv).toBe(true);
			expect(b.totp_geheim).toBe(geheimnisChefMit);
		});

		it('sitzung_anlegen legt keine Vor-Sitzung an und verweigert 2FA-pflichtige Konten', async () => {
			const h = sha256('direkt');
			const [z] = await systemAbfrage(
				(sql) => sql`select app.sitzung_anlegen(${chefOhne}::uuid, ${h}::bytea, now() + interval '1 day') as ok`
			);
			expect(z.ok).toBe(false);
			expect(await root`select 1 from app.sitzungen where token_hash = ${h}`).toHaveLength(0);
		});

		it('zweiten_faktor_abschliessen mit unbekanntem oder abgelaufenem Hash → false, keine Sitzung', async () => {
			const neu = sha256('neu-1');
			const [z] = await systemAbfrage(
				(sql) => sql`select app.zweiten_faktor_abschliessen(${sha256('unbekannt')}::bytea, 1, ${neu}::bytea, now() + interval '1 day') as ok`
			);
			expect(z.ok).toBe(false);
			expect(await root`select 1 from app.sitzungen where token_hash = ${neu}`).toHaveLength(0);
		});

		it('eine volle Sitzung ist keine Vor-Sitzung: vorsitzung_daten / abschliessen lehnen sie ab', async () => {
			const token = await neueSitzung(monteur);
			const daten = await systemAbfrage((sql) => sql`select * from app.vorsitzung_daten(${sha256(token)}::bytea)`);
			expect(daten).toHaveLength(0);
			const neu = sha256('neu-2');
			const [z] = await systemAbfrage(
				(sql) => sql`select app.zweiten_faktor_abschliessen(${sha256(token)}::bytea, 99999999, ${neu}::bytea, now() + interval '1 day') as ok`
			);
			expect(z.ok).toBe(false);
			expect(await root`select 1 from app.sitzungen where token_hash = ${neu}`).toHaveLength(0);
		});

		it('Zeitschritt: die Datenbank akzeptiert nur Schritte nahe ihrer Uhr (±1); abgelehnte ändern nichts', async () => {
			await systemAbfrage(
				(sql) => sql`select app.anmeldung_weiter(${monteurMit}::uuid, ${sha256('v-s')}::bytea, now() + interval '1 day', ${sha256('n-s')}::bytea)`
			);
			const jetzt = Math.floor(Date.now() / SCHRITT_MS);
			const neu = sha256('neu-schritt');
			const versuch = async (schritt: number) =>
				(await systemAbfrage(
					(sql) => sql`select app.zweiten_faktor_abschliessen(${sha256('n-s')}::bytea, ${schritt}::bigint, ${neu}::bytea, now() + interval '1 day') as ok`
				))[0].ok;
			for (const schritt of [jetzt + 1000, jetzt + 3, jetzt - 3, 1]) {
				expect(await versuch(schritt), String(schritt - jetzt)).toBe(false);
			}
			expect(await root`select 1 from app.sitzungen where token_hash = ${neu}`).toHaveLength(0);
			const [b] = await root`select totp_letzter_schritt from app.benutzer where id = ${monteurMit}`;
			expect(b.totp_letzter_schritt).toBeNull();
			expect(await vorsitzungen(monteurMit)).toHaveLength(1); // Vor-Sitzung unverändert
			expect(await versuch(jetzt + 1)).toBe(true);
			const [c] = await root`select totp_letzter_schritt from app.benutzer where id = ${monteurMit}`;
			expect(Number(c.totp_letzter_schritt)).toBe(jetzt + 1);
		});

		it('anmeldung_weiter: Entscheidung liegt in der Datenbank (sitzung / einrichten / code / verweigert)', async () => {
			const erwartet: [string, string][] = [
				[monteur, 'sitzung'], [chefOhne, 'einrichten'], [adminOhne, 'einrichten'],
				[chefMit, 'code'], [monteurMit, 'code']
			];
			for (const [benutzer, art] of erwartet) {
				await root`delete from app.sitzungen`;
				const [z] = await systemAbfrage(
					(sql) => sql`select app.anmeldung_weiter(${benutzer}::uuid, ${sha256('v' + benutzer)}::bytea, now() + interval '1 day', ${sha256('n' + benutzer)}::bytea) as art`
				);
				expect(z.art, benutzer).toBe(art);
			}
		});

		it('Vor-Sitzungen pro Benutzer sind begrenzt', async () => {
			for (let i = 0; i < 12; i++) {
				await systemAbfrage(
					(sql) => sql`select app.anmeldung_weiter(${chefOhne}::uuid, ${sha256('vv' + i)}::bytea, now() + interval '1 day', ${sha256('nn' + i)}::bytea)`
				);
			}
			const n = await vorsitzungen(chefOhne);
			expect(n.length).toBeLessThanOrEqual(5);
			expect(n.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Geheimnisse in Protokollen und Fehlern', () => {
		it('Fehlermeldungen an den Browser enthalten weder Geheimnis noch Code', async () => {
			const cookies = fakeCookies();
			await anmelden(cookies, 'chef-ohne@beispiel.test');
			const d = (await einrichtungLoad(seitenEvent(cookies))) as { geheimnis: string };
			const roh = d.geheimnis.replace(/\s/g, '');
			const r = await ausfuehren(() => einrichtungAktion.default(formEvent(cookies, { code: '999999' })));
			const text = JSON.stringify(r);
			expect(text).not.toContain(roh);
			expect(text).not.toContain('999999');
		});
	});
});
