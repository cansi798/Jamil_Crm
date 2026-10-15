import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { frischeTestDb, type TestDb } from './setup';

describe('Migrationen und DB-Rollen', () => {
	let db: TestDb;

	beforeAll(async () => {
		db = await frischeTestDb();
	});

	it('migrate ist idempotent: weitere Läufe wenden nichts mehr an', async () => {
		expect(await migrate(db.urlSuper)).toEqual([]);
		expect(await migrate(db.urlSuper)).toEqual([]);
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

	it('crm_app und crm_admin sind weder Superuser noch umgehen sie RLS', async () => {
		const sql = postgres(db.urlSuper, { max: 1 });
		try {
			const zeilen = await sql`
				select rolname, rolsuper, rolbypassrls, rolcanlogin
				from pg_roles where rolname in ('crm_app', 'crm_admin') order by rolname`;
			expect(zeilen).toHaveLength(2);
			for (const z of zeilen) {
				expect(z.rolsuper).toBe(false);
				expect(z.rolbypassrls).toBe(false);
				expect(z.rolcanlogin).toBe(true);
			}
		} finally {
			await sql.end();
		}
	});

	it('crm_app und crm_admin können sich mit ihren Passwörtern anmelden', async () => {
		for (const [url, erwartet] of [
			[db.urlApp, 'crm_app'],
			[db.urlAdmin, 'crm_admin']
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
