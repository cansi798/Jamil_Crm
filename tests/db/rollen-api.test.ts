import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { GET, POST } from '../../src/routes/api/rollen/+server';
import { DELETE, PUT } from '../../src/routes/api/rollen/[id]/+server';
import { load as listeLoad, actions as listeAktionen } from '../../src/routes/(app)/einstellungen/rollen/+page.server';
import { load as bearbeitenLoad, actions as bearbeitenAktionen } from '../../src/routes/(app)/einstellungen/rollen/[id]/+page.server';

const SCHUTZ = 'Mindestens ein Benutzer muss die Einstellungen verwalten können.';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte, betriebStatus: 'aktiv' };
}

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const anfrage = (methode: string, koerper?: unknown) =>
	new Request('http://localhost/api/rollen', {
		method: methode,
		headers: { 'content-type': 'application/json' },
		body: koerper === undefined ? undefined : typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
	});

describe('Rollen-API', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefRolleA: string, monteurRolleA: string, chefRolleB: string;
	let chefA: Nutzer, monteurA: Nutzer, chefB: Nutzer;
	let chefAId: string, monteurAId: string, chefBId: string;

	const listeA = async () => antwort(await GET({ locals: { nutzer: chefA } } as never));
	const put = (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		(async () => antwort(await PUT({ locals: { nutzer }, params: { id }, request: anfrage('PUT', koerper) } as never)))();
	const del = (nutzer: Nutzer | null, id: string) =>
		(async () => antwort(await DELETE({ locals: { nutzer }, params: { id }, request: anfrage('DELETE') } as never)))();
	const post = (nutzer: Nutzer | null, koerper: unknown) =>
		(async () => antwort(await POST({ locals: { nutzer }, request: anfrage('POST', koerper) } as never)))();
	const rechteDer = async (id: string) =>
		(await root`select rechte from app.rollen where id = ${id}`)[0]?.rechte as string[] | undefined;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const [tarif] = await root`select id from app.tarife where schluessel = 'basis'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${tarif.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${tarif.id}, 'aktiv') returning id`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	/** Setzt vor jedem Test einen bekannten Zustand: A hat Chef (1 Benutzer) und Monteur (1 Benutzer), B nur Chef. */
	beforeEach(async () => {
		await root`delete from app.sitzungen`;
		await root`delete from app.benutzer`;
		await root`delete from app.rollen`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[], vorlage: string | null) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte, vorlage)
				values (${betrieb}, ${name}, ${rechte as string[]}, ${vorlage}) returning id`)[0].id as string;
		chefRolleA = await rolle(betriebA, 'Chef', VORLAGEN.chef, 'chef');
		monteurRolleA = await rolle(betriebA, 'Monteur', VORLAGEN.monteur, 'monteur');
		chefRolleB = await rolle(betriebB, 'Chef', VORLAGEN.chef, 'chef');
		const benutzer = async (betrieb: string, rolle: string, email: string) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betrieb}, ${email}, ${email}, 'x', ${rolle}) returning id`)[0].id as string;
		chefAId = await benutzer(betriebA, chefRolleA, 'chef-a@beispiel.test');
		monteurAId = await benutzer(betriebA, monteurRolleA, 'monteur-a@beispiel.test');
		chefBId = await benutzer(betriebB, chefRolleB, 'chef-b@beispiel.test');
		chefA = nutzerVon(chefAId, betriebA, [...VORLAGEN.chef]);
		monteurA = nutzerVon(monteurAId, betriebA, [...VORLAGEN.monteur]);
		chefB = nutzerVon(chefBId, betriebB, [...VORLAGEN.chef]);
	});

	describe('Berechtigung', () => {
		it('Monteur ruft PUT /api/rollen/x → 403', async () => {
			const a = await put(monteurA, chefRolleA, { name: 'Böse' });
			expect(a).toEqual({ status: 403, koerper: { fehler: 'Keine Berechtigung' } });
			expect((await root`select name from app.rollen where id = ${chefRolleA}`)[0].name).toBe('Chef');
		});

		it('Monteur darf weder lesen, anlegen noch löschen', async () => {
			expect((await antwort(await GET({ locals: { nutzer: monteurA } } as never))).status).toBe(403);
			expect((await post(monteurA, { name: 'X', rechte: [] })).status).toBe(403);
			expect((await del(monteurA, monteurRolleA)).status).toBe(403);
		});

		it('ohne Anmeldung → 401, Plattform-Admin ohne Betrieb → 403', async () => {
			expect((await put(null, chefRolleA, { name: 'X' })).status).toBe(401);
			const admin = nutzerVon('a', null, [], true);
			expect((await put(admin, chefRolleA, { name: 'X' })).status).toBe(403);
		});
	});

	describe('Lesen und Anlegen', () => {
		it('GET liefert nur die Rollen des eigenen Betriebs mit Anzahl der Benutzer', async () => {
			const a = await listeA();
			expect(a.status).toBe(200);
			expect(a.koerper.map((r: any) => r.name).sort()).toEqual(['Chef', 'Monteur']);
			const chef = a.koerper.find((r: any) => r.name === 'Chef');
			expect(chef).toMatchObject({ id: chefRolleA, vorlage: 'chef', benutzer: 1 });
			expect(chef.rechte.sort()).toEqual([...VORLAGEN.chef].sort());
		});

		it('POST mit Vorlage kopiert die Rechte der Vorlage', async () => {
			const a = await post(chefA, { name: 'Büro Nord', vorlage: 'buero' });
			expect(a.status).toBe(201);
			expect(a.koerper).toMatchObject({ name: 'Büro Nord', vorlage: 'buero' });
			expect([...a.koerper.rechte].sort()).toEqual([...VORLAGEN.buero].sort());
			expect((await root`select betrieb_id from app.rollen where id = ${a.koerper.id}`)[0].betrieb_id).toBe(betriebA);
		});

		it('POST ohne Vorlage legt eine Rolle mit den gewählten Rechten an (ohne Duplikate)', async () => {
			const a = await post(chefA, { name: '  Planer ', rechte: ['plantafel.bearbeiten', 'plantafel.bearbeiten', 'kunden.lesen'] });
			expect(a.status).toBe(201);
			expect(a.koerper.name).toBe('Planer');
			expect(a.koerper.vorlage).toBeNull();
			expect([...a.koerper.rechte].sort()).toEqual(['kunden.lesen', 'plantafel.bearbeiten']);
		});

		it('POST: Name fehlt oder zu lang, unbekannte Vorlage, kaputtes JSON → 400', async () => {
			expect((await post(chefA, { rechte: [] })).status).toBe(400);
			expect((await post(chefA, { name: '   ', rechte: [] })).status).toBe(400);
			expect((await post(chefA, { name: 'x'.repeat(61), rechte: [] })).status).toBe(400);
			expect((await post(chefA, { name: 'X', vorlage: 'gott' })).status).toBe(400);
			expect((await post(chefA, '{kaputt')).status).toBe(400);
			expect((await post(chefA, '[]')).status).toBe(400);
		});
	});

	describe('Ändern', () => {
		it('unbekanntes Recht → 400 und nichts wird geändert', async () => {
			const a = await put(chefA, monteurRolleA, { rechte: ['kunden.lesen', 'welt.beherrschen'] });
			expect(a.status).toBe(400);
			expect(a.koerper.fehler).toMatch(/welt\.beherrschen/);
			expect(await rechteDer(monteurRolleA)).toEqual([...VORLAGEN.monteur]);
			expect((await post(chefA, { name: 'X', rechte: ['gibts.nicht'] })).status).toBe(400);
			expect((await put(chefA, monteurRolleA, { rechte: 'kunden.lesen' })).status).toBe(400);
			expect((await put(chefA, monteurRolleA, { rechte: [1] })).status).toBe(400);
			expect((await put(chefA, monteurRolleA, {})).status).toBe(400);
		});

		it('ändert Name und Rechte (preise.sehen für Monteur)', async () => {
			const a = await put(chefA, monteurRolleA, { name: 'Monteur Plus', rechte: [...VORLAGEN.monteur, 'preise.sehen'] });
			expect(a.status).toBe(200);
			expect(a.koerper.name).toBe('Monteur Plus');
			expect(a.koerper.rechte).toContain('preise.sehen');
			expect(await rechteDer(monteurRolleA)).toContain('preise.sehen');
		});

		it('Chef entzieht letzter Chef-Rolle einstellungen → 409 und Rechte bleiben', async () => {
			const ohne = VORLAGEN.chef.filter((r) => r !== 'einstellungen');
			const a = await put(chefA, chefRolleA, { rechte: ohne });
			expect(a).toEqual({ status: 409, koerper: { fehler: SCHUTZ } });
			expect(await rechteDer(chefRolleA)).toContain('einstellungen');
		});

		it('Schutzregel zählt nur aktive Benutzer', async () => {
			await root`update app.benutzer set aktiv = false where id = ${chefAId}`;
			// Monteur-Rolle bekommt einstellungen, ist aber der einzige aktive Verwalter nur, wenn die Chef-Rolle ihn verliert.
			await put(chefB, chefRolleB, { name: 'Chef' }); // anderer Betrieb: unberührt
			const a = await put(nutzerVon(monteurAId, betriebA, ['einstellungen']), monteurRolleA, {
				rechte: [...VORLAGEN.monteur, 'einstellungen']
			});
			expect(a.status).toBe(200);
			// Jetzt ist der Monteur der einzige aktive Verwalter: ihm das Recht zu nehmen ist verboten.
			const b = await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur] });
			expect(b).toEqual({ status: 409, koerper: { fehler: SCHUTZ } });
		});

		it('einstellungen darf wegfallen, wenn ein anderer aktiver Benutzer es über eine andere Rolle behält', async () => {
			await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur, 'einstellungen'] });
			const ohne = VORLAGEN.chef.filter((r) => r !== 'einstellungen');
			const a = await put(chefA, chefRolleA, { rechte: ohne });
			expect(a.status).toBe(200);
			expect(await rechteDer(chefRolleA)).not.toContain('einstellungen');
		});

		it('gleichzeitig zwei Rollen das Recht entziehen: genau eine Änderung gelingt (nie null Verwalter)', async () => {
			await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur, 'einstellungen'] });
			for (let i = 0; i < 5; i++) {
				await root`update app.rollen set rechte = ${[...VORLAGEN.chef]} where id = ${chefRolleA}`;
				await root`update app.rollen set rechte = ${[...VORLAGEN.monteur, 'einstellungen']} where id = ${monteurRolleA}`;
				const ohneChef = VORLAGEN.chef.filter((r) => r !== 'einstellungen');
				const [x, y] = await Promise.all([
					put(chefA, chefRolleA, { rechte: ohneChef }),
					put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur] })
				]);
				expect([x.status, y.status].sort()).toEqual([200, 409]);
				const [{ n }] = await root`
					select count(*)::int as n from app.benutzer b join app.rollen r on r.id = b.rolle_id
					where b.betrieb_id = ${betriebA} and b.aktiv and 'einstellungen' = any (r.rechte)`;
				expect(n).toBeGreaterThan(0);
			}
		});

		it('Rolle eines anderen Betriebs oder unbekannte/ungültige ID → 404', async () => {
			expect((await put(chefA, chefRolleB, { name: 'Gekapert' })).status).toBe(404);
			expect((await root`select name from app.rollen where id = ${chefRolleB}`)[0].name).toBe('Chef');
			expect((await put(chefA, '00000000-0000-4000-8000-000000000000', { name: 'X' })).status).toBe(404);
			expect((await put(chefA, 'kein-uuid', { name: 'X' })).status).toBe(404);
			expect((await del(chefA, chefRolleB)).status).toBe(404);
			expect(await rechteDer(chefRolleB)).toBeDefined();
		});
	});

	describe('Löschen', () => {
		it('Rolle in Benutzung → 409', async () => {
			const a = await del(chefA, monteurRolleA);
			expect(a.status).toBe(409);
			expect(a.koerper.fehler).toMatch(/Benutzer/);
			expect(await rechteDer(monteurRolleA)).toBeDefined();
		});

		it('Rolle in Benutzung durch einen inaktiven Benutzer zählt ebenfalls → 409', async () => {
			await root`update app.benutzer set aktiv = false where id = ${monteurAId}`;
			expect((await del(chefA, monteurRolleA)).status).toBe(409);
		});

		it('unbenutzte Rolle wird gelöscht (204)', async () => {
			const neu = (await post(chefA, { name: 'Praktikant', vorlage: 'monteur' })).koerper.id;
			const a = await del(chefA, neu);
			expect(a).toEqual({ status: 204, koerper: null });
			expect(await rechteDer(neu)).toBeUndefined();
		});
	});

	describe('Sitzungen bei neuem Recht einstellungen (Carry T7)', () => {
		const sitzung = (benutzer: string, kennung: string, offen = false) =>
			root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, zweiter_faktor_offen)
				values (${Buffer.from(kennung)}, ${benutzer}, now() + interval '1 day', ${offen})`;
		const anzahl = async (benutzer: string) =>
			(await root`select count(*)::int as n from app.sitzungen where benutzer_id = ${benutzer}`)[0].n as number;

		it('beendet alle Sitzungen der Benutzer dieser Rolle, nicht die anderer Rollen oder Betriebe', async () => {
			await sitzung(monteurAId, 'm1');
			await sitzung(monteurAId, 'm2', true);
			await sitzung(chefAId, 'c1');
			await sitzung(chefBId, 'cb1');
			const a = await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur, 'einstellungen'] });
			expect(a.status).toBe(200);
			expect(await anzahl(monteurAId)).toBe(0);
			expect(await anzahl(chefAId)).toBe(1);
			expect(await anzahl(chefBId)).toBe(1);
		});

		it('andere Änderungen (Name, anderes Recht, Entzug von einstellungen) lassen Sitzungen bestehen', async () => {
			await sitzung(monteurAId, 'm1');
			await put(chefA, monteurRolleA, { name: 'Neu' });
			await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur, 'preise.sehen'] });
			expect(await anzahl(monteurAId)).toBe(1);
		});

		it('hat die Rolle einstellungen schon, bleiben Sitzungen bestehen', async () => {
			await sitzung(chefAId, 'c1');
			await put(chefA, chefRolleA, { name: 'Chefin' });
			expect(await anzahl(chefAId)).toBe(1);
		});

		it('ohne Erfolg der Änderung (Rollback) bleiben Sitzungen bestehen', async () => {
			await sitzung(monteurAId, 'm1');
			const a = await put(chefA, monteurRolleA, { rechte: [...VORLAGEN.monteur, 'einstellungen', 'unbekannt'] });
			expect(a.status).toBe(400);
			expect(await anzahl(monteurAId)).toBe(1);
		});
	});

	describe('SQL-Funktionen zum Beenden von Sitzungen', () => {
		let app: postgres.Sql, auth: postgres.Sql, admin: postgres.Sql;
		beforeAll(() => {
			app = postgres(db.urlApp, { max: 2, onnotice: () => {} });
			auth = postgres(db.urlAuth, { max: 1, onnotice: () => {} });
			admin = postgres(db.urlAdmin, { max: 1, onnotice: () => {} });
		});
		afterAll(async () => {
			await Promise.all([app.end(), auth.end(), admin.end()]);
		});
		const sitzung = (benutzer: string, kennung: string) =>
			root`insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
				values (${Buffer.from(kennung)}, ${benutzer}, now() + interval '1 day')`;
		const anzahl = async (benutzer: string) =>
			(await root`select count(*)::int as n from app.sitzungen where benutzer_id = ${benutzer}`)[0].n as number;
		const alsBetrieb = <T>(betrieb: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
			app.begin(async (tx) => {
				if (betrieb !== null) await tx`select set_config('app.betrieb_id', ${betrieb}, true)`;
				return fn(tx);
			}) as Promise<T>;

		it('sitzungen_beenden_fuer_rolle löscht im eigenen Betrieb und liefert die Anzahl', async () => {
			await sitzung(monteurAId, 'm1');
			await sitzung(monteurAId, 'm2');
			const [z] = await alsBetrieb(betriebA, (tx) =>
				tx`select app.sitzungen_beenden_fuer_rolle(${monteurRolleA}::uuid) as n`
			);
			expect(z.n).toBe(2);
			expect(await anzahl(monteurAId)).toBe(0);
		});

		it('kann Sitzungen eines anderen Mandanten nicht berühren (Rolle fremd, Kontext fremd, Kontext fehlt)', async () => {
			await sitzung(chefBId, 'cb1');
			// Kontext A, Rolle von B
			let [z] = await alsBetrieb(betriebA, (tx) => tx`select app.sitzungen_beenden_fuer_rolle(${chefRolleB}::uuid) as n`);
			expect(z.n).toBe(0);
			// Kontext B, Rolle von A
			await sitzung(monteurAId, 'm1');
			[z] = await alsBetrieb(betriebB, (tx) => tx`select app.sitzungen_beenden_fuer_rolle(${monteurRolleA}::uuid) as n`);
			expect(z.n).toBe(0);
			// kein Kontext
			[z] = await alsBetrieb(null, (tx) => tx`select app.sitzungen_beenden_fuer_rolle(${chefRolleB}::uuid) as n`);
			expect(z.n).toBe(0);
			// leerer Kontext
			[z] = await app.begin(async (tx) => {
				await tx`select set_config('app.betrieb_id', '', true)`;
				return tx`select app.sitzungen_beenden_fuer_rolle(${chefRolleB}::uuid) as n`;
			});
			expect(z.n).toBe(0);
			expect(await anzahl(chefBId)).toBe(1);
			expect(await anzahl(monteurAId)).toBe(1);
		});

		it('sitzungen_beenden_fuer_benutzer: nur Benutzer des eigenen Betriebs', async () => {
			await sitzung(chefBId, 'cb1');
			await sitzung(monteurAId, 'm1');
			let [z] = await alsBetrieb(betriebA, (tx) => tx`select app.sitzungen_beenden_fuer_benutzer(${chefBId}::uuid) as n`);
			expect(z.n).toBe(0);
			expect(await anzahl(chefBId)).toBe(1);
			[z] = await alsBetrieb(betriebA, (tx) => tx`select app.sitzungen_beenden_fuer_benutzer(${monteurAId}::uuid) as n`);
			expect(z.n).toBe(1);
			expect(await anzahl(monteurAId)).toBe(0);
		});

		it('EXECUTE nur für crm_app (nicht crm_auth, crm_admin, public)', async () => {
			for (const sql of [auth, admin]) {
				await expect(sql`select app.sitzungen_beenden_fuer_rolle(${chefRolleB}::uuid)`).rejects.toThrow(/permission denied/);
				await expect(sql`select app.sitzungen_beenden_fuer_benutzer(${chefBId}::uuid)`).rejects.toThrow(/permission denied/);
			}
			const rechte = await root`
				select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as eigentuemer, p.proconfig,
					has_function_privilege('crm_app', p.oid, 'execute') as app,
					has_function_privilege('crm_auth', p.oid, 'execute') as auth,
					has_function_privilege('crm_admin', p.oid, 'execute') as admin,
					has_function_privilege('public', p.oid, 'execute') as pub
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'app' and p.proname in ('sitzungen_beenden_fuer_rolle', 'sitzungen_beenden_fuer_benutzer')`;
			expect(rechte).toHaveLength(2);
			for (const r of rechte) {
				expect(r).toMatchObject({ prosecdef: true, eigentuemer: 'crm', app: true, auth: false, admin: false, pub: false });
				expect(r.proconfig).toContain('search_path=app, pg_temp');
			}
		});
	});

	describe('Oberfläche', () => {
		it('Liste: ohne Anmeldung Umleitung zur Anmeldung, ohne Recht 403, mit Recht Rollen mit Rechte-Katalog', async () => {
			await expect(listeLoad({ locals: { nutzer: null } } as never)).rejects.toMatchObject({ status: 303, location: '/anmelden' });
			await expect(listeLoad({ locals: { nutzer: monteurA } } as never)).rejects.toMatchObject({ status: 403 });
			const daten = (await listeLoad({ locals: { nutzer: chefA } } as never)) as any;
			expect(daten.rollen.map((r: any) => r.name).sort()).toEqual(['Chef', 'Monteur']);
			expect(daten.vorlagen.map((v: any) => v.schluessel).sort()).toEqual(['buero', 'chef', 'monteur']);
		});

		it('Neue Rolle über das Formular legt an und leitet zur Bearbeitung weiter', async () => {
			const form = new FormData();
			form.set('name', 'Lager');
			form.set('vorlage', 'monteur');
			await expect(
				listeAktionen.neu({ locals: { nutzer: chefA }, request: new Request('http://localhost/', { method: 'POST', body: form }) } as never)
			).rejects.toMatchObject({ status: 303, location: expect.stringMatching(/^\/einstellungen\/rollen\/[0-9a-f-]{36}$/) });
			expect((await root`select rechte from app.rollen where name = 'Lager'`)[0].rechte).toEqual([...VORLAGEN.monteur]);
		});

		it('Neue Rolle ohne Namen: fail(400) mit deutscher Meldung', async () => {
			const form = new FormData();
			form.set('name', '');
			const r = (await listeAktionen.neu({
				locals: { nutzer: chefA },
				request: new Request('http://localhost/', { method: 'POST', body: form })
			} as never)) as any;
			expect(r.status).toBe(400);
			expect(r.data.fehler).toMatch(/Name/);
		});

		it('Bearbeiten: Checkboxen speichern, Schutzregel erscheint als Formularfehler, Löschen leitet zur Liste', async () => {
			const daten = (await bearbeitenLoad({ locals: { nutzer: chefA }, params: { id: monteurRolleA } } as never)) as any;
			expect(daten.rolle.id).toBe(monteurRolleA);
			expect(daten.rechte.map((r: any) => r.schluessel)).toContain('einstellungen');
			await expect(bearbeitenLoad({ locals: { nutzer: chefA }, params: { id: chefRolleB } } as never)).rejects.toMatchObject({ status: 404 });

			const speichern = new FormData();
			speichern.set('name', 'Monteur');
			speichern.append('rechte', 'kunden.lesen');
			speichern.append('rechte', 'preise.sehen');
			const ok = (await bearbeitenAktionen.speichern({
				locals: { nutzer: chefA }, params: { id: monteurRolleA },
				request: new Request('http://localhost/', { method: 'POST', body: speichern })
			} as never)) as any;
			expect(ok.gespeichert).toBe(true);
			expect(await rechteDer(monteurRolleA)).toEqual(['kunden.lesen', 'preise.sehen']);

			const schutz = new FormData();
			schutz.set('name', 'Chef');
			schutz.append('rechte', 'kunden.lesen');
			const fehler = (await bearbeitenAktionen.speichern({
				locals: { nutzer: chefA }, params: { id: chefRolleA },
				request: new Request('http://localhost/', { method: 'POST', body: schutz })
			} as never)) as any;
			expect(fehler.status).toBe(409);
			expect(fehler.data.fehler).toBe(SCHUTZ);

			const inBenutzung = (await bearbeitenAktionen.loeschen({
				locals: { nutzer: chefA }, params: { id: monteurRolleA },
				request: new Request('http://localhost/', { method: 'POST', body: new FormData() })
			} as never)) as any;
			expect(inBenutzung.status).toBe(409);

			const leer = (await post(chefA, { name: 'Leer', rechte: [] })).koerper.id;
			await expect(
				bearbeitenAktionen.loeschen({
					locals: { nutzer: chefA }, params: { id: leer },
					request: new Request('http://localhost/', { method: 'POST', body: new FormData() })
				} as never)
			).rejects.toMatchObject({ status: 303, location: '/einstellungen/rollen' });
		});
	});

	it('mitBetrieb-Kontext bleibt auf den eigenen Betrieb beschränkt (Gegenprobe zur RLS)', async () => {
		const n = await mitBetrieb({ betriebId: betriebA, benutzerId: chefAId }, (tx) => tx`select id from app.rollen`);
		expect(n.map((r) => r.id).sort()).toEqual([chefRolleA, monteurRolleA].sort());
	});
});
