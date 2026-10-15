import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { frischeTestDb, leereDb, type TestDb } from './setup';

describe('Migrationen und DB-Rollen', () => {
	let db: TestDb;

	beforeAll(async () => {
		db = await frischeTestDb();
	});

	it('migrate wendet auf leerer DB die Dateien an und ist danach idempotent', async () => {
		const url = await leereDb('crm_test_migrate');
		const angewendet = await migrate(url);
		expect(angewendet[0]).toBe('001_rollen.sql');
		expect(angewendet).toContain('002_kern.sql');
		expect(angewendet).toEqual([...angewendet].sort());
		expect(await migrate(url)).toEqual([]);
		expect(await migrate(url)).toEqual([]);
	});

	it('migrate ist auf der frischen Test-DB bereits durch (keine weiteren Anwendungen)', async () => {
		expect(await migrate(db.urlSuper)).toEqual([]);
	});

	it('jede Datei läuft in einer eigenen Transaktion: Fehler rollt nur die fehlerhafte Datei zurück', async () => {
		const url = await leereDb('crm_test_migrate');
		const verzeichnis = mkdtempSync(join(tmpdir(), 'crm-migrationen-'));
		try {
			writeFileSync(join(verzeichnis, '001_gut.sql'), 'create table gut_tabelle (id int);');
			writeFileSync(
				join(verzeichnis, '002_schlecht.sql'),
				'create table halb_tabelle (id int); select 1 / 0;'
			);
			await expect(migrate(url, { verzeichnis })).rejects.toThrow(/division by zero/);

			const sql = postgres(url, { max: 1 });
			try {
				const namen = await sql`select name from schema_migrationen order by name`;
				expect(namen.map((z) => z.name)).toEqual(['001_gut.sql']);
				const [z] = await sql`
					select to_regclass('gut_tabelle') as gut, to_regclass('halb_tabelle') as halb`;
				expect(z.gut).not.toBeNull();
				expect(z.halb).toBeNull();
			} finally {
				await sql.end();
			}
		} finally {
			rmSync(verzeichnis, { recursive: true, force: true });
		}
	});

	it('merkt sich angewendete Migrationen in schema_migrationen', async () => {
		const sql = postgres(db.urlSuper, { max: 1 });
		try {
			const zeilen = await sql`select name from schema_migrationen order by name`;
			expect(zeilen.map((z) => z.name)).toContain('001_rollen.sql');
		} finally {
			await sql.end();
		}
	});

	it('crm_app, crm_admin und crm_auth sind weder Superuser noch umgehen sie RLS', async () => {
		const sql = postgres(db.urlSuper, { max: 1 });
		try {
			const zeilen = await sql`
				select rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
				from pg_roles where rolname in ('crm_app', 'crm_admin', 'crm_auth') order by rolname`;
			expect(zeilen).toHaveLength(3);
			for (const z of zeilen) {
				expect(z.rolsuper).toBe(false);
				expect(z.rolbypassrls).toBe(false);
				expect(z.rolcanlogin).toBe(true);
				expect(z.rolcreatedb).toBe(false);
				expect(z.rolcreaterole).toBe(false);
			}
		} finally {
			await sql.end();
		}
	});

	it('crm_app, crm_admin und crm_auth können sich mit ihren Passwörtern anmelden', async () => {
		for (const [url, erwartet] of [
			[db.urlApp, 'crm_app'],
			[db.urlAdmin, 'crm_admin'],
			[db.urlAuth, 'crm_auth']
		] as const) {
			const sql = postgres(url, { max: 1 });
			try {
				const [z] = await sql`select current_user as benutzer`;
				expect(z.benutzer).toBe(erwartet);
			} finally {
				await sql.end();
			}
		}
	});

	it('crm_auth hat nur USAGE auf Schema app und keinerlei Tabellenrechte', async () => {
		const sql = postgres(db.urlSuper, { max: 1 });
		try {
			const [s] = await sql`
				select has_schema_privilege('crm_auth', 'app', 'usage') as nutzbar,
					has_schema_privilege('crm_auth', 'app', 'create') as anlegen`;
			expect(s).toEqual({ nutzbar: true, anlegen: false });
			const tabellen = await sql`
				select c.relname,
					has_table_privilege('crm_auth', c.oid, 'select, insert, update, delete, truncate, references, trigger') as irgendeins
				from pg_class c join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'app' and c.relkind = 'r'`;
			expect(tabellen.length).toBeGreaterThan(0);
			for (const t of tabellen) expect(t.irgendeins, t.relname).toBe(false);
		} finally {
			await sql.end();
		}
	});

	it('Schema app gehört crm und ist für die Rollen nutzbar', async () => {
		const sql = postgres(db.urlSuper, { max: 1 });
		try {
			const [z] = await sql`
				select pg_get_userbyid(nspowner) as eigentuemer,
					has_schema_privilege('crm_app', 'app', 'usage') as app_nutzbar,
					has_schema_privilege('crm_admin', 'app', 'usage') as admin_nutzbar,
					has_schema_privilege('crm_app', 'app', 'create') as app_anlegen
				from pg_namespace where nspname = 'app'`;
			expect(z.eigentuemer).toBe('crm');
			expect(z.app_nutzbar).toBe(true);
			expect(z.admin_nutzbar).toBe(true);
			expect(z.app_anlegen).toBe(false);
		} finally {
			await sql.end();
		}
	});
});
