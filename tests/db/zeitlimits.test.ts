import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { migrate } from '../../scripts/migrate';

describe('Zeitlimits der Anwendungsrollen (009_zeitlimits)', () => {
	let db: TestDb;

	beforeAll(async () => {
		db = await frischeTestDb();
	});

	const zeige = async (url: string) => {
		const sql = postgres(url, { max: 1, onnotice: () => {} });
		try {
			const [s] = await sql`show statement_timeout`;
			const [i] = await sql`show idle_in_transaction_session_timeout`;
			return { statement: s.statement_timeout, idle: i.idle_in_transaction_session_timeout };
		} finally {
			await sql.end();
		}
	};

	it('crm_app, crm_admin und crm_auth haben statement_timeout 30s und idle_in_transaction 60s', async () => {
		for (const url of [db.urlApp, db.urlAdmin, db.urlAuth]) {
			expect(await zeige(url)).toEqual({ statement: '30s', idle: '1min' });
		}
	});

	it('greift wirklich: eine zu lange Abfrage als crm_app wird abgebrochen', async () => {
		const sql = postgres(db.urlApp, { max: 1, onnotice: () => {} });
		try {
			// Sitzungswert kurz senken, damit der Test schnell bleibt – Abbruch-Mechanik ist dieselbe
			await sql`set statement_timeout = '200ms'`;
			await expect(sql`select pg_sleep(2)`).rejects.toThrow(/statement timeout/);
		} finally {
			await sql.end();
		}
	});

	it('Superuser (Migrationen) bleibt ohne Limit; erneutes Migrieren ändert nichts', async () => {
		expect(await zeige(db.urlSuper)).toEqual({ statement: '0', idle: '0' });
		expect(await migrate(db.urlSuper)).toEqual([]);
		const root = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
		try {
			const zeilen = await root`
				select r.rolname, s.setconfig
				from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
				where r.rolname in ('crm_app', 'crm_admin', 'crm_auth') and s.setdatabase = 0
				order by r.rolname`;
			expect(zeilen.map((z) => z.rolname)).toEqual(['crm_admin', 'crm_app', 'crm_auth']);
			for (const z of zeilen) {
				expect([...z.setconfig].sort()).toEqual([
					'idle_in_transaction_session_timeout=60s',
					'statement_timeout=30s'
				]);
			}
		} finally {
			await root.end();
		}
	});
});
