import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitAdmin, mitBetrieb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';

const BETRIEB_A = '11111111-1111-4111-8111-111111111111';
const BENUTZER_A = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

describe('DB-Zugriffsschicht mit Mandantenkontext', () => {
	let db: TestDb;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
	});

	afterAll(async () => {
		await schliesseDb();
	});

	it('mitBetrieb setzt Kontext', async () => {
		const [zeile] = await mitBetrieb({ betriebId: BETRIEB_A, benutzerId: BENUTZER_A }, (sql) =>
			sql`select current_setting('app.betrieb_id') as betrieb, current_setting('app.benutzer_id') as benutzer`
		);
		expect(zeile.betrieb).toBe(BETRIEB_A);
		expect(zeile.benutzer).toBe(BENUTZER_A);
	});

	it('mitBetrieb läuft als crm_app', async () => {
		const [zeile] = await mitBetrieb(
			{ betriebId: BETRIEB_A, benutzerId: BENUTZER_A },
			(sql) => sql`select current_user as rolle`
		);
		expect(zeile.rolle).toBe('crm_app');
	});

	it('mitAdmin setzt app.admin_id und läuft als crm_admin', async () => {
		const [zeile] = await mitAdmin(
			ADMIN,
			(sql) => sql`select current_setting('app.admin_id') as admin, current_user as rolle`
		);
		expect(zeile.admin).toBe(ADMIN);
		expect(zeile.rolle).toBe('crm_admin');
	});

	it('Kontext leckt nicht zwischen Transaktionen', async () => {
		await mitBetrieb({ betriebId: BETRIEB_A, benutzerId: BENUTZER_A }, (sql) => sql`select 1`);
		await mitAdmin(ADMIN, (sql) => sql`select 1`);
		const [zeile] = await systemAbfrage(
			(sql) => sql`select
				nullif(current_setting('app.betrieb_id', true), '') as betrieb,
				nullif(current_setting('app.benutzer_id', true), '') as benutzer,
				nullif(current_setting('app.admin_id', true), '') as admin`
		);
		expect(zeile.betrieb).toBeNull();
		expect(zeile.benutzer).toBeNull();
		expect(zeile.admin).toBeNull();
	});

	it('systemAbfrage läuft als crm_auth ohne Kontext', async () => {
		const [zeile] = await systemAbfrage((sql) => sql`select current_user as rolle`);
		expect(zeile.rolle).toBe('crm_auth');
	});

	it('Fehler in fn → Rollback', async () => {
		const root = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
		try {
			const [tarif] = await root`
				insert into app.tarife (schluessel, name) values ('rollback-test', 'Rollback') returning id`;
			const [betrieb] = await root`
				insert into app.betriebe (name, tarif_id, abo_status)
				values ('Rollback GmbH', ${tarif.id}, 'aktiv') returning id`;
			const kontext = { betriebId: betrieb.id as string, benutzerId: BENUTZER_A };

			await expect(
				mitBetrieb(kontext, async (sql) => {
					await sql`insert into app.rollen (betrieb_id, name, rechte)
						values (${kontext.betriebId}, 'Wird zurückgerollt', '{}')`;
					throw new Error('absichtlicher Fehler');
				})
			).rejects.toThrow('absichtlicher Fehler');

			const [{ anzahl }] = await root`
				select count(*)::int as anzahl from app.rollen where name = 'Wird zurückgerollt'`;
			expect(anzahl).toBe(0);
		} finally {
			await root.end();
		}
	});

	it('leere Kennungen werden abgelehnt', async () => {
		await expect(
			mitBetrieb({ betriebId: '', benutzerId: BENUTZER_A }, (sql) => sql`select 1`)
		).rejects.toThrow();
		await expect(mitAdmin('', (sql) => sql`select 1`)).rejects.toThrow();
	});
});
