import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

describe('Kernschema und Mandantentrennung (RLS)', () => {
	let db: TestDb;
	let root: Sql;
	let app: Sql;
	let admin: Sql;
	let tarifId: string;
	let betriebA: string;
	let betriebB: string;
	let rolleA: string;
	let rolleB: string;
	let benutzerA: string;
	let benutzerB: string;
	let benutzerOhneBetrieb: string;

	/** Führt `fn` als crm_app in einer Transaktion mit gesetztem Betriebskontext aus (null = kein Kontext). */
	async function alsApp<T>(betriebId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
		return (await app.begin(async (tx) => {
			if (betriebId !== null) await tx`select set_config('app.betrieb_id', ${betriebId}, true)`;
			return fn(tx);
		})) as T;
	}

	beforeAll(async () => {
		db = await frischeTestDb();
		root = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
		app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
		admin = postgres(db.urlAdmin, { max: 1, onnotice: () => {} });

		const [tarif] = await root`
			insert into app.tarife (schluessel, name) values ('basis', 'Basis') returning id`;
		tarifId = tarif.id;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status)
			values ('Betrieb A', ${tarif.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status)
			values ('Betrieb B', ${tarif.id}, 'aktiv') returning id`;
		[{ id: rolleA }] = await root`
			insert into app.rollen (betrieb_id, name, rechte)
			values (${betriebA}, 'Chef A', ${['kunden']}) returning id`;
		[{ id: rolleB }] = await root`
			insert into app.rollen (betrieb_id, name, rechte)
			values (${betriebB}, 'Chef B', ${['kunden']}) returning id`;
		[{ id: benutzerA }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betriebA}, 'a@example.test', 'Anna A', 'hash', ${rolleA}) returning id`;
		[{ id: benutzerB }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${betriebB}, 'b@example.test', 'Bernd B', 'hash', ${rolleB}) returning id`;
		[{ id: benutzerOhneBetrieb }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash)
			values (null, 'admin@example.test', 'Plattform Admin', 'hash') returning id`;
		await root`insert into app.plattform_admins (benutzer_id) values (${benutzerOhneBetrieb})`;
		await root`
			insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab)
			values (${Buffer.from('token-a')}, ${benutzerA}, now() + interval '1 hour')`;
	});

	afterAll(async () => {
		await Promise.all([root?.end(), app?.end(), admin?.end()]);
	});

	describe('Tabelle rollen', () => {
		it('ohne Kontext → 0 Zeilen in rollen', async () => {
			const zeilen = await alsApp(null, (tx) => tx`select id from app.rollen`);
			expect(zeilen).toHaveLength(0);
		});

		it('leerer Kontext (Leerstring) → 0 Zeilen in rollen', async () => {
			const zeilen = await alsApp('', (tx) => tx`select id from app.rollen`);
			expect(zeilen).toHaveLength(0);
		});

		it('Kontext A sieht nur Rollen von A', async () => {
			const zeilen = await alsApp(betriebA, (tx) => tx`select id, betrieb_id from app.rollen`);
			expect(zeilen.map((z) => z.id)).toEqual([rolleA]);
			expect(zeilen.every((z) => z.betrieb_id === betriebA)).toBe(true);
		});

		it('Kontext B sieht nur Rollen von B', async () => {
			const zeilen = await alsApp(betriebB, (tx) => tx`select id from app.rollen`);
			expect(zeilen.map((z) => z.id)).toEqual([rolleB]);
		});

		it('INSERT mit betrieb_id B im Kontext A → Fehler (RLS)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`insert into app.rollen (betrieb_id, name, rechte)
						values (${betriebB}, 'Eingeschmuggelt', ${['kunden']})`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('INSERT ohne Kontext → Fehler (RLS)', async () => {
			await expect(
				alsApp(
					null,
					(tx) => tx`insert into app.rollen (betrieb_id, name, rechte)
						values (${betriebA}, 'Ohne Kontext', ${['kunden']})`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('INSERT mit eigenem Betrieb im Kontext A gelingt', async () => {
			const zeilen = await alsApp(
				betriebA,
				(tx) => tx`insert into app.rollen (betrieb_id, name, rechte)
					values (${betriebA}, 'Mitarbeiter A', ${['kunden']}) returning id`
			);
			expect(zeilen).toHaveLength(1);
			await root`delete from app.rollen where id = ${zeilen[0].id}`;
		});

		it('UPDATE einer B-Rolle im Kontext A → 0 betroffene Zeilen', async () => {
			const r = await alsApp(
				betriebA,
				(tx) => tx`update app.rollen set name = 'Gekapert' where id = ${rolleB}`
			);
			expect(r.count).toBe(0);
			const [z] = await root`select name from app.rollen where id = ${rolleB}`;
			expect(z.name).toBe('Chef B');
		});

		it('UPDATE der eigenen Rolle auf fremden Betrieb → Fehler (RLS, WITH CHECK)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`update app.rollen set betrieb_id = ${betriebB} where id = ${rolleA}`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('DELETE einer B-Rolle im Kontext A → 0 betroffene Zeilen', async () => {
			const r = await alsApp(betriebA, (tx) => tx`delete from app.rollen where id = ${rolleB}`);
			expect(r.count).toBe(0);
			const [z] = await root`select count(*)::int as n from app.rollen where id = ${rolleB}`;
			expect(z.n).toBe(1);
		});
	});

	describe('Tabelle benutzer', () => {
		it('ohne Kontext → 0 Zeilen', async () => {
			const zeilen = await alsApp(null, (tx) => tx`select id from app.benutzer`);
			expect(zeilen).toHaveLength(0);
		});

		it('Kontext A sieht nur Benutzer von A, nie Benutzer ohne Betrieb', async () => {
			const zeilen = await alsApp(betriebA, (tx) => tx`select id from app.benutzer`);
			expect(zeilen.map((z) => z.id)).toEqual([benutzerA]);
		});

		it('Benutzer ohne Betrieb (NULL) ist für crm_app nie sichtbar, auch nicht per Leerkontext', async () => {
			for (const kontext of [null, '', betriebA, betriebB]) {
				const zeilen = await alsApp(
					kontext,
					(tx) => tx`select id from app.benutzer where id = ${benutzerOhneBetrieb}`
				);
				expect(zeilen).toHaveLength(0);
			}
		});

		it('INSERT eines Benutzers ohne Betrieb (NULL) durch crm_app → Fehler (RLS)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`insert into app.benutzer (betrieb_id, email, name, passwort_hash)
						values (null, 'x@example.test', 'X', 'hash')`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('INSERT mit betrieb_id B im Kontext A → Fehler (RLS)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`insert into app.benutzer (betrieb_id, email, name, passwort_hash)
						values (${betriebB}, 'y@example.test', 'Y', 'hash')`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('UPDATE eines B-Benutzers im Kontext A → 0 betroffene Zeilen', async () => {
			const r = await alsApp(
				betriebA,
				(tx) => tx`update app.benutzer set name = 'Gekapert' where id = ${benutzerB}`
			);
			expect(r.count).toBe(0);
		});

		it('UPDATE des eigenen Benutzers auf fremden Betrieb → Fehler (RLS, WITH CHECK)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`update app.benutzer set betrieb_id = ${betriebB} where id = ${benutzerA}`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('DELETE eines B-Benutzers im Kontext A → 0 betroffene Zeilen', async () => {
			const r = await alsApp(betriebA, (tx) => tx`delete from app.benutzer where id = ${benutzerB}`);
			expect(r.count).toBe(0);
		});

		it('INSERT eines A-Benutzers mit rolle_id einer B-Rolle → Fehler (Fremdschlüssel)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
						values (${betriebA}, 'z@example.test', 'Z', 'hash', ${rolleB})`
				)
			).rejects.toThrow(/foreign key|violates/i);
		});

		it('UPDATE eines A-Benutzers auf rolle_id einer B-Rolle → Fehler (Fremdschlüssel)', async () => {
			await expect(
				alsApp(
					betriebA,
					(tx) => tx`update app.benutzer set rolle_id = ${rolleB} where id = ${benutzerA}`
				)
			).rejects.toThrow(/foreign key|violates/i);
			const [z] = await root`select rolle_id from app.benutzer where id = ${benutzerA}`;
			expect(z.rolle_id).toBe(rolleA);
		});

		it('rolle_id einer Rolle des eigenen Betriebs funktioniert weiterhin', async () => {
			const [neu] = await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Zweite A', ${['kunden']}) returning id`;
			const r = await alsApp(
				betriebA,
				(tx) => tx`update app.benutzer set rolle_id = ${neu.id} where id = ${benutzerA}`
			);
			expect(r.count).toBe(1);
			await root`update app.benutzer set rolle_id = ${rolleA} where id = ${benutzerA}`;
			await root`delete from app.rollen where id = ${neu.id}`;
		});

		it('Benutzer ohne Betrieb darf keine rolle_id haben (CHECK)', async () => {
			await expect(
				root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
					values (null, 'n@example.test', 'N', 'hash', ${rolleA})`
			).rejects.toThrow(/check/i);
		});

		it('E-Mail ist ohne Beachtung der Groß-/Kleinschreibung eindeutig (citext)', async () => {
			await expect(
				root`insert into app.benutzer (betrieb_id, email, name, passwort_hash)
					values (${betriebA}, 'A@EXAMPLE.TEST', 'Doppelt', 'hash')`
			).rejects.toThrow(/unique|duplicate/i);
		});
	});

	describe('Tabelle betriebe', () => {
		it('crm_app liest im Kontext A nur die eigene Zeile', async () => {
			const zeilen = await alsApp(betriebA, (tx) => tx`select id from app.betriebe`);
			expect(zeilen.map((z) => z.id)).toEqual([betriebA]);
		});

		it('ohne Kontext → 0 Zeilen', async () => {
			const zeilen = await alsApp(null, (tx) => tx`select id from app.betriebe`);
			expect(zeilen).toHaveLength(0);
		});

		it('crm_app darf betriebe nicht ändern, einfügen oder löschen (permission denied)', async () => {
			await expect(
				alsApp(betriebA, (tx) => tx`update app.betriebe set name = 'X' where id = ${betriebA}`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`insert into app.betriebe (name, tarif_id) values ('Neu', ${tarifId})`)
			).rejects.toThrow(/permission denied/);
			await expect(alsApp(betriebA, (tx) => tx`delete from app.betriebe`)).rejects.toThrow(
				/permission denied/
			);
		});
	});

	describe('Tabelle tarife', () => {
		it('ist für crm_app lesbar, aber nicht änderbar', async () => {
			const zeilen = await alsApp(null, (tx) => tx`select schluessel from app.tarife`);
			expect(zeilen.map((z) => z.schluessel)).toEqual(['basis']);
			await expect(
				alsApp(betriebA, (tx) => tx`update app.tarife set name = 'X'`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`insert into app.tarife (schluessel, name) values ('x', 'X')`)
			).rejects.toThrow(/permission denied/);
		});
	});

	describe('Tabellen ohne direkten Zugriff', () => {
		it('crm_app SELECT auf sitzungen → permission denied', async () => {
			await expect(alsApp(betriebA, (tx) => tx`select * from app.sitzungen`)).rejects.toThrow(
				/permission denied/
			);
		});

		it('crm_app hat auf sitzungen und plattform_admins keinerlei Zugriff', async () => {
			for (const tabelle of ['sitzungen', 'plattform_admins']) {
				await expect(
					alsApp(betriebA, (tx) => tx.unsafe(`select * from app.${tabelle}`))
				).rejects.toThrow(/permission denied/);
				await expect(
					alsApp(betriebA, (tx) => tx.unsafe(`delete from app.${tabelle}`))
				).rejects.toThrow(/permission denied/);
			}
		});

		it('crm_admin hat auf keiner Kerntabelle direkte Rechte', async () => {
			const tabellen = ['tarife', 'betriebe', 'rollen', 'benutzer', 'plattform_admins', 'sitzungen'];
			for (const tabelle of tabellen) {
				const [z] = await root`
					select
						has_table_privilege('crm_admin', ${'app.' + tabelle}, 'select') as sel,
						has_table_privilege('crm_admin', ${'app.' + tabelle}, 'insert') as ins,
						has_table_privilege('crm_admin', ${'app.' + tabelle}, 'update') as upd,
						has_table_privilege('crm_admin', ${'app.' + tabelle}, 'delete') as del`;
				expect(z, tabelle).toEqual({ sel: false, ins: false, upd: false, del: false });
			}
			await expect(admin`select * from app.betriebe`).rejects.toThrow(/permission denied/);
		});
	});

	describe('Konfiguration', () => {
		it('RLS ist auf rollen, benutzer und betriebe aktiv und erzwungen (FORCE)', async () => {
			const zeilen = await root`
				select c.relname, c.relrowsecurity, c.relforcerowsecurity
				from pg_class c join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'app' and c.relname in ('rollen', 'benutzer', 'betriebe')
				order by c.relname`;
			expect(zeilen).toHaveLength(3);
			for (const z of zeilen) {
				expect(z.relrowsecurity, z.relname).toBe(true);
				expect(z.relforcerowsecurity, z.relname).toBe(true);
			}
		});

		it('abo_status akzeptiert nur die erlaubten Werte', async () => {
			await expect(
				root`insert into app.betriebe (name, tarif_id, abo_status) values ('Kaputt', ${tarifId}, 'unbekannt')`
			).rejects.toThrow(/check/i);
			for (const status of ['test', 'aktiv', 'ueberfaellig', 'gekuendigt', 'gesperrt']) {
				const [z] = await root`
					insert into app.betriebe (name, tarif_id, abo_status)
					values (${'S-' + status}, ${tarifId}, ${status}) returning id`;
				await root`delete from app.betriebe where id = ${z.id}`;
			}
		});
	});
});
