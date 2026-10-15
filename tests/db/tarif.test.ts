import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { alsAntwort, ApiFehler } from '../../src/lib/server/fehler';
import { darf, hatModul, listeTarife, MODULE, pruefeGrenze, pruefeModul } from '../../src/lib/server/tarif';
import { hashe, COOKIE_NAME } from '../../src/lib/server/auth/sitzung';
import { handle } from '../../src/hooks.server';
import { GET as rollenGet, POST as rollenPost } from '../../src/routes/api/rollen/+server';
import { PUT as rollenPut, DELETE as rollenDelete } from '../../src/routes/api/rollen/[id]/+server';
import { POST as abmelden } from '../../src/routes/api/abmelden/+server';
import { actions as rollenAktionen } from '../../src/routes/(app)/einstellungen/rollen/+page.server';

const SEED_SQL = new URL('../../db/migrations/004_tarife_seed.sql', import.meta.url);

const nutzerVon = (id: string, betriebId: string | null, rechte: string[]): Nutzer => ({
	id,
	betriebId,
	istAdmin: false,
	rechte,
	betriebStatus: 'aktiv'
});

describe('Tarife und Freischaltungen', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let basisId: string, premiumId: string;
	let betriebBasis: string, betriebPremium: string;
	let benutzerBasis: string;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const tarife = await root`select id, schluessel from app.tarife`;
		basisId = tarife.find((t) => t.schluessel === 'basis')!.id;
		premiumId = tarife.find((t) => t.schluessel === 'premium')!.id;
		[{ id: betriebBasis }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Basis GmbH', ${basisId}, 'aktiv') returning id`;
		[{ id: betriebPremium }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Premium GmbH', ${premiumId}, 'aktiv') returning id`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	/** Räumt Benutzer, Rollen und Sitzungen weg; legt je einen Benutzer für den Basis-Betrieb an. */
	beforeEach(async () => {
		await root`delete from app.sitzungen`;
		await root`delete from app.benutzer`;
		await root`delete from app.rollen`;
		await root`update app.betriebe set abo_status = 'aktiv', abo_ende = null`;
		benutzerBasis = (
			await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash)
				values (${betriebBasis}, ${'b1@beispiel.test'}, 'B1', 'x') returning id`
		)[0].id;
	});

	describe('Seed 004_tarife_seed.sql', () => {
		it('legt test, basis, profi und premium mit den vereinbarten Modulen und Grenzen an', async () => {
			const z = await root`select schluessel, module, grenzen from app.tarife order by schluessel`;
			const nach = Object.fromEntries(z.map((t) => [t.schluessel, t]));
			expect(Object.keys(nach).sort()).toEqual(['basis', 'premium', 'profi', 'test']);
			const basis = ['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote'];
			const profi = [...basis, 'ki_angebote', 'sprache', 'zeiterfassung', 'protokolle'];
			expect([...nach.basis.module].sort()).toEqual([...basis].sort());
			expect([...nach.profi.module].sort()).toEqual([...profi].sort());
			expect([...nach.premium.module].sort()).toEqual([...MODULE].sort());
			expect([...nach.test.module].sort()).toEqual([...MODULE].sort());
			expect(nach.test.grenzen).toEqual({ benutzer: 50, ki_pro_monat: 2000 });
			expect(nach.basis.grenzen).toEqual({ benutzer: 3, ki_pro_monat: 0 });
			expect(nach.profi.grenzen).toEqual({ benutzer: 10, ki_pro_monat: 300 });
			expect(nach.premium.grenzen).toEqual({ benutzer: 30, ki_pro_monat: 1500 });
		});

		it('MODULE nennt genau die zwölf Module', () => {
			expect([...MODULE]).toEqual([
				'kunden', 'auftraege', 'plantafel', 'katalog', 'angebote', 'ki_angebote',
				'sprache', 'zeiterfassung', 'protokolle', 'kundenportal', 'lexware', 'nextcloud'
			]);
		});

		it('ist idempotent: nochmaliges Ausführen ändert nichts und überschreibt Abweichungen nur je Schlüssel', async () => {
			const vorher = await root`select id, schluessel, name, module, grenzen from app.tarife order by schluessel`;
			await root.unsafe(readFileSync(SEED_SQL, 'utf8'));
			const nachher = await root`select id, schluessel, name, module, grenzen from app.tarife order by schluessel`;
			expect(nachher).toEqual(vorher);
		});
	});

	describe('hatModul / pruefeModul', () => {
		it('Betrieb mit basis → pruefeModul("sprache") wirft 402 mit tarifMit [profi, premium, test]', async () => {
			const locals = { nutzer: nutzerVon(benutzerBasis, betriebBasis, ['kunden.lesen']) };
			const fehler = await pruefeModul(locals, 'sprache').then(
				() => null,
				(e) => e
			);
			expect(fehler).toBeInstanceOf(ApiFehler);
			expect(fehler.status).toBe(402);
			expect(fehler.message).toBe('Im aktuellen Tarif nicht enthalten');
			expect(fehler.extra).toEqual({ tarifMit: ['profi', 'premium', 'test'] });
			const antwort = alsAntwort(fehler);
			expect(antwort.status).toBe(402);
			expect(await antwort.json()).toEqual({
				fehler: 'Im aktuellen Tarif nicht enthalten',
				tarifMit: ['profi', 'premium', 'test']
			});
		});

		it('enthaltenes Modul → kein Fehler; hatModul liefert true/false je Betrieb', async () => {
			const locals = { nutzer: nutzerVon(benutzerBasis, betriebBasis, []) };
			await expect(pruefeModul(locals, 'kunden')).resolves.toBeUndefined();
			expect(await hatModul(betriebBasis, 'kunden')).toBe(true);
			expect(await hatModul(betriebBasis, 'sprache')).toBe(false);
			expect(await hatModul(betriebPremium, 'sprache')).toBe(true);
			expect(await hatModul(betriebPremium, 'lexware')).toBe(true);
		});

		it('ohne Anmeldung 401, Plattform-Admin ohne Betrieb 403; unbekanntes Modul ist ein Programmierfehler', async () => {
			await expect(pruefeModul({ nutzer: null }, 'kunden')).rejects.toMatchObject({ status: 401 });
			await expect(
				pruefeModul({ nutzer: nutzerVon('a', null, []) }, 'kunden')
			).rejects.toMatchObject({ status: 403 });
			await expect(hatModul(betriebBasis, 'gibtsnicht' as never)).rejects.toThrow(/Unbekanntes Modul/);
		});

		it('liest den Tarif des Betriebs aus dem Nutzerkontext, nie den eines anderen Betriebs', async () => {
			// Nutzer von Premium (Tarif mit "sprache") behauptet nichts über Basis: die Prüfung gilt nur für seinen Betrieb.
			const premiumNutzer = { nutzer: nutzerVon('p', betriebPremium, []) };
			await expect(pruefeModul(premiumNutzer, 'sprache')).resolves.toBeUndefined();
			const basisNutzer = { nutzer: nutzerVon(benutzerBasis, betriebBasis, []) };
			await expect(pruefeModul(basisNutzer, 'sprache')).rejects.toMatchObject({ status: 402 });
		});

		it('listeTarife liefert alle Tarife mit Schlüssel, Name und Modulen', async () => {
			const liste = await listeTarife({ betriebId: betriebBasis, benutzerId: benutzerBasis });
			expect(liste.map((t) => t.schluessel).sort()).toEqual(['basis', 'premium', 'profi', 'test']);
			expect(liste.find((t) => t.schluessel === 'profi')!.module).toContain('sprache');
		});
	});

	describe('pruefeGrenze', () => {
		const benutzerAnlegen = async (betrieb: string, anzahl: number, aktiv = true) => {
			for (let i = 0; i < anzahl; i++) {
				await root`
					insert into app.benutzer (betrieb_id, email, name, passwort_hash, aktiv)
					values (${betrieb}, ${`u${randomBytes(4).toString('hex')}@beispiel.test`}, 'U', 'x', ${aktiv})`;
			}
		};

		it('Benutzergrenze 3 erreicht → 409', async () => {
			await benutzerAnlegen(betriebBasis, 2); // zusammen mit dem Benutzer aus beforeEach: 3
			const fehler = await pruefeGrenze(betriebBasis, 'benutzer').then(
				() => null,
				(e) => e
			);
			expect(fehler).toBeInstanceOf(ApiFehler);
			expect(fehler.status).toBe(409);
			expect(fehler.message).toBe('Benutzergrenze des Tarifs erreicht');
		});

		it('unter der Grenze → ok; deaktivierte Benutzer zählen nicht mit', async () => {
			await expect(pruefeGrenze(betriebBasis, 'benutzer')).resolves.toBeUndefined(); // 1 von 3
			await benutzerAnlegen(betriebBasis, 1); // 2 von 3
			await expect(pruefeGrenze(betriebBasis, 'benutzer')).resolves.toBeUndefined();
			await benutzerAnlegen(betriebBasis, 5, false);
			await expect(pruefeGrenze(betriebBasis, 'benutzer')).resolves.toBeUndefined();
		});

		describe('schlägt geschlossen fehl (Konfigurationsfehler statt „unbegrenzt“)', () => {
			/** Legt einen eigenen Tarif mit den gegebenen Grenzen und einen Betrieb dazu an. */
			const betriebMitGrenzen = async (grenzen: string) => {
				const [t] = await root`
					insert into app.tarife (schluessel, name, grenzen)
					values (${`g${randomBytes(4).toString('hex')}`}, 'G', ${root.json(JSON.parse(grenzen))}) returning id`;
				const [b] = await root`
					insert into app.betriebe (name, tarif_id, abo_status) values ('G GmbH', ${t.id}, 'aktiv') returning id`;
				return b.id as string;
			};
			afterEach(async () => {
				await root`delete from app.benutzer where betrieb_id in (select id from app.betriebe where name = 'G GmbH')`;
				await root`delete from app.betriebe where name = 'G GmbH'`;
				await root`delete from app.tarife where name = 'G'`;
			});

			it('Schlüssel fehlt → Error, kein ApiFehler', async () => {
				const b = await betriebMitGrenzen('{"ki_pro_monat": 5}');
				const e = await pruefeGrenze(b, 'benutzer').then(() => null, (x) => x);
				expect(e).toBeInstanceOf(Error);
				expect(e).not.toBeInstanceOf(ApiFehler);
				expect(e.message).toMatch(/keine gültige Grenze/);
			});

			it('Text "3", negative Zahl, Liste, Objekt → Error', async () => {
				for (const wert of ['"3"', '-1', '[3]', '{"a":1}', 'true']) {
					const b = await betriebMitGrenzen(`{"benutzer": ${wert}}`);
					const e = await pruefeGrenze(b, 'benutzer').then(() => null, (x) => x);
					expect(e, wert).toBeInstanceOf(Error);
					expect(e, wert).not.toBeInstanceOf(ApiFehler);
				}
			});

			it('Betrieb existiert nicht → Error', async () => {
				const e = await pruefeGrenze('11111111-1111-4111-8111-111111111111', 'benutzer').then(
					() => null,
					(x) => x
				);
				expect(e).toBeInstanceOf(Error);
				expect(e).not.toBeInstanceOf(ApiFehler);
				expect(e.message).toMatch(/nicht gefunden/);
			});

			it('ausdrücklich null = unbegrenzt → erlaubt; Zahl 0 sperrt sofort', async () => {
				const frei = await betriebMitGrenzen('{"benutzer": null}');
				await benutzerAnlegen(frei, 5);
				await expect(pruefeGrenze(frei, 'benutzer')).resolves.toBeUndefined();
				const null_ = await betriebMitGrenzen('{"benutzer": 0}');
				await expect(pruefeGrenze(null_, 'benutzer')).rejects.toMatchObject({ status: 409 });
			});
		});

		it('zählt nur den eigenen Betrieb', async () => {
			await benutzerAnlegen(betriebPremium, 3);
			await expect(pruefeGrenze(betriebBasis, 'benutzer')).resolves.toBeUndefined();
			await expect(pruefeGrenze(betriebPremium, 'benutzer')).resolves.toBeUndefined(); // 3 von 30
		});

		it('innerhalb der Transaktion des Aufrufers: gleichzeitige Prüfungen werden hintereinander gestellt', async () => {
			await benutzerAnlegen(betriebBasis, 1); // 2 von 3 → genau ein weiterer Benutzer ist erlaubt
			const { mitBetrieb } = await import('../../src/lib/server/db');
			const k = { betriebId: betriebBasis, benutzerId: benutzerBasis };
			const [rolle] = await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betriebBasis}, 'R', ${['kunden.lesen']}) returning id`;
			// crm_app legt keine Benutzer an (R6, T9); der Platz wird wie beim Einladen durch eine offene Einladung belegt.
			const versuch = (n: number) =>
				mitBetrieb(k, async (tx) => {
					await pruefeGrenze(betriebBasis, 'benutzer', tx);
					await new Promise((r) => setTimeout(r, 50));
					await tx`
						insert into app.einladungen (betrieb_id, email, rolle_id, token_hash)
						values (${betriebBasis}, ${`rennen${n}@beispiel.test`}, ${rolle.id}, ${hashe(`rennen${n}`)})`;
				}).then(
					() => 'ok',
					(e) => (e instanceof ApiFehler ? e.status : 'fehler')
				);
			const ergebnisse = await Promise.all([versuch(1), versuch(2)]);
			expect(ergebnisse.sort()).toEqual([409, 'ok']);
		});
	});

	describe('darf', () => {
		it('prüft Recht (403) und Modul (402)', async () => {
			const nur = nutzerVon(benutzerBasis, betriebBasis, ['kunden.lesen']);
			await expect(darf({ nutzer: nur }, 'kunden', 'kunden.lesen')).resolves.toBeUndefined();
			await expect(darf({ nutzer: nur }, 'kunden', 'kunden.bearbeiten')).rejects.toMatchObject({ status: 403 });
			await expect(darf({ nutzer: nur }, 'sprache', 'kunden.lesen')).rejects.toMatchObject({ status: 402 });
			await expect(darf({ nutzer: null }, 'kunden', 'kunden.lesen')).rejects.toMatchObject({ status: 401 });
		});
	});

	describe('Nur-Lesezugriff (zentral in hooks.server.ts)', () => {
		let chefId: string;
		let token: string;

		function fakeCookies(start: Record<string, string>) {
			const speicher = new Map(Object.entries(start));
			return {
				get: (n: string) => speicher.get(n),
				set: (n: string, w: string) => void speicher.set(n, w),
				delete: (n: string) => void speicher.delete(n)
			};
		}

		/** Schickt eine Anfrage durch den Hook; `resolve` ruft den echten Routen-Handler (oder merkt sich nur den Aufruf). */
		async function anfrage(
			methode: string,
			pfad: string,
			opts: { koerper?: unknown; form?: Record<string, string>; route?: (e: any) => unknown } = {}
		) {
			let init: RequestInit = { method: methode };
			if (opts.form) {
				const f = new FormData();
				for (const [k, v] of Object.entries(opts.form)) f.set(k, v);
				init = { method: methode, body: f };
			} else if (opts.koerper !== undefined) {
				init = { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.koerper) };
			}
			const request = new Request(`http://localhost${pfad}`, init);
			const event = {
				request,
				url: new URL(request.url),
				cookies: fakeCookies({ [COOKIE_NAME]: token }),
				locals: {} as { nutzer?: Nutzer | null },
				params: {}
			};
			const resolve = vi.fn(async (e: typeof event) => {
				const r = await opts.route?.(e);
				return r instanceof Response ? r : new Response('ok');
			});
			const antwort = await handle({ event: event as never, resolve: resolve as never });
			const text = await antwort.text();
			let koerper: any = text;
			try {
				koerper = JSON.parse(text);
			} catch {
				/* kein JSON */
			}
			return { status: antwort.status, koerper, aufgerufen: resolve.mock.calls.length > 0 };
		}

		const setzeAbo = (status: string, tage: number | null) =>
			root`
				update app.betriebe
				set abo_status = ${status},
					abo_ende = case when ${tage}::int is null then null
						else (now() at time zone 'Europe/Berlin')::date + ${tage}::int end
				where id = ${betriebBasis}`;
		const anzahlRollen = async () => Number((await root`select count(*)::int as n from app.rollen`)[0].n);

		beforeEach(async () => {
			const [rolle] = await root`
				insert into app.rollen (betrieb_id, name, rechte)
				values (${betriebBasis}, 'Chef', ${['einstellungen']}) returning id`;
			await root`update app.benutzer set rolle_id = ${rolle.id} where id = ${benutzerBasis}`;
			chefId = benutzerBasis;
			token = randomBytes(32).toString('base64url');
			// Direkt eingefügte volle Sitzung (die Vor-Sitzung/2FA-Logik ist hier nicht das Thema; R13: mit Kennzeichen).
			await root`
				insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
				values (${hashe(token)}, ${chefId}, now() + interval '1 day', true)`;
		});

		const rollenAnlegen = (name = 'Neu') =>
			anfrage('POST', '/api/rollen', {
				koerper: { name, rechte: ['kunden.lesen'] },
				route: (e) => rollenPost({ locals: e.locals, request: e.request } as never)
			});

		it('gekuendigt mit abgelaufenem abo_ende → Schreibanfrage 403, Leseanfrage 200', async () => {
			await setzeAbo('gekuendigt', -1);
			const schreiben = await rollenAnlegen();
			expect(schreiben).toMatchObject({ status: 403, koerper: { fehler: 'Nur Lesezugriff' }, aufgerufen: false });
			expect(await anzahlRollen()).toBe(1);
			const lesen = await anfrage('GET', '/api/rollen', {
				route: (e) => rollenGet({ locals: e.locals } as never)
			});
			expect(lesen.status).toBe(200);
			expect(lesen.aufgerufen).toBe(true);
			expect(lesen.koerper).toHaveLength(1);
		});

		it('alle schreibenden Methoden sind gesperrt, HEAD ebenso offen wie GET', async () => {
			await setzeAbo('gekuendigt', -1);
			for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
				const a = await anfrage(m, '/api/rollen/irgendwas', { koerper: { name: 'x' } });
				expect(a, m).toMatchObject({ status: 403, aufgerufen: false });
			}
			expect((await anfrage('HEAD', '/api/rollen')).status).toBe(200);
		});

		it('gekuendigt: am Tag des Ablaufs und davor noch schreibbar, ab dem Tag danach nur lesbar', async () => {
			await setzeAbo('gekuendigt', 0);
			expect((await rollenAnlegen('Heute')).status).toBe(201);
			await setzeAbo('gekuendigt', 30);
			expect((await rollenAnlegen('Später')).status).toBe(201);
			await setzeAbo('gekuendigt', -1);
			expect((await rollenAnlegen('Gestern')).status).toBe(403);
		});

		it('ueberfaellig: bis 14 Tage nach abo_ende Schonfrist, danach nur lesbar', async () => {
			await setzeAbo('ueberfaellig', -14);
			expect((await rollenAnlegen('Schonfrist')).status).toBe(201);
			await setzeAbo('ueberfaellig', -15);
			expect(await rollenAnlegen('Zu spät')).toMatchObject({ status: 403, koerper: { fehler: 'Nur Lesezugriff' } });
			await setzeAbo('ueberfaellig', 5);
			expect((await rollenAnlegen('Noch nicht fällig')).status).toBe(201);
		});

		it('test und aktiv sind nie schreibgeschützt, auch mit altem abo_ende', async () => {
			await setzeAbo('aktiv', -400);
			expect((await rollenAnlegen('A')).status).toBe(201);
			await setzeAbo('test', -400);
			expect((await rollenAnlegen('T')).status).toBe(201);
		});

		it('ohne abo_ende gibt es keinen Schreibschutz (kein Stichtag bekannt)', async () => {
			await setzeAbo('ueberfaellig', null);
			expect((await rollenAnlegen('U')).status).toBe(201);
			await setzeAbo('gekuendigt', null);
			expect((await rollenAnlegen('G')).status).toBe(201);
		});

		it('Formular-Aktionen der Seiten (POST auf (app)-Routen) sind ebenfalls gesperrt', async () => {
			await setzeAbo('gekuendigt', -1);
			const a = await anfrage('POST', '/einstellungen/rollen?/neu', {
				form: { name: 'Per Formular', vorlage: 'buero' },
				route: (e) => rollenAktionen.neu!({ locals: e.locals, request: e.request } as never) as Promise<unknown>
			});
			expect(a).toMatchObject({ status: 403, koerper: { fehler: 'Nur Lesezugriff' }, aufgerufen: false });
			expect(await anzahlRollen()).toBe(1);
			// Gegenprobe: ohne Schreibschutz läuft dieselbe Aktion durch (redirect wirft)
			await setzeAbo('aktiv', null);
			await expect(
				rollenAktionen.neu!({
					locals: { nutzer: nutzerVon(chefId, betriebBasis, ['einstellungen']) },
					request: new Request('http://localhost/einstellungen/rollen?/neu', {
						method: 'POST',
						body: (() => {
							const f = new FormData();
							f.set('name', 'Per Formular');
							f.set('vorlage', 'buero');
							return f;
						})()
					})
				} as never)
			).rejects.toMatchObject({ status: 303 });
		});

		it('Abmelden bleibt immer möglich', async () => {
			await setzeAbo('gekuendigt', -1);
			const a = await anfrage('POST', '/api/abmelden', {
				route: (e) => abmelden({ cookies: e.cookies } as never)
			});
			expect(a.aufgerufen).toBe(true);
			expect(a.status).toBe(303);
		});

		it('die Anmeldeseiten bleiben erreichbar (kein Schreibschutz auf /anmelden)', async () => {
			await setzeAbo('gekuendigt', -1);
			expect((await anfrage('POST', '/anmelden', { form: { email: 'x' } })).aufgerufen).toBe(true);
			expect((await anfrage('POST', '/anmelden/zweiter-faktor', { form: { code: '1' } })).aufgerufen).toBe(true);
		});

		it('ohne Sitzung greift der Schreibschutz nicht (die Route entscheidet über 401)', async () => {
			await setzeAbo('gekuendigt', -1);
			token = randomBytes(32).toString('base64url'); // unbekanntes Token
			const a = await anfrage('POST', '/api/rollen', {
				koerper: { name: 'x' },
				route: (e) => rollenPost({ locals: e.locals, request: e.request } as never)
			});
			expect(a.status).toBe(401);
		});

		it('die Einladungsseite (/einladung/…) bleibt auch im Nur-Lesezugriff erreichbar, andere Seiten nicht', async () => {
			await setzeAbo('gekuendigt', -1);
			const einladung = await anfrage('POST', '/einladung/irgendein-token', { form: { name: 'x' } });
			expect(einladung).toMatchObject({ status: 200, aufgerufen: true });
			const andere = await anfrage('POST', '/einladungen-anders', { form: { name: 'x' } });
			expect(andere).toMatchObject({ status: 403, aufgerufen: false });
			const api = await anfrage('POST', '/api/einladungen', { koerper: { email: 'a@b.test' } });
			expect(api).toMatchObject({ status: 403, aufgerufen: false });
		});

		it('PUT und DELETE auf Rollen laufen bei aktivem Abo durch den Hook', async () => {
			const [r] = await root`select id from app.rollen limit 1`;
			const put = await anfrage('PUT', `/api/rollen/${r.id}`, {
				koerper: { name: 'Umbenannt' },
				route: (e) => rollenPut({ locals: e.locals, params: { id: r.id }, request: e.request } as never)
			});
			expect(put.status).toBe(200);
			await setzeAbo('gekuendigt', -1);
			const del = await anfrage('DELETE', `/api/rollen/${r.id}`, {
				route: (e) => rollenDelete({ locals: e.locals, params: { id: r.id }, request: e.request } as never)
			});
			expect(del.status).toBe(403);
			expect(await anzahlRollen()).toBe(1);
		});
	});
});
