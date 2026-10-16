import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { frischeTestDb, type TestDb } from './setup';
import { leseZugangsdaten, pruefeSandbox, seedDev } from '../../scripts/seed-dev';
import { spawnSync } from 'node:child_process';
import { pruefePasswort } from '../../src/lib/server/auth/passwort';

const EMAILS = ['chef@bauwelt.test', 'buero@bauwelt.test', 'monteur@bauwelt.test', 'admin@crm.test'];

describe('seed-dev', () => {
	let db: TestDb;
	let sql: postgres.Sql;
	let ordner: string;
	let datei: string;

	beforeAll(async () => {
		db = await frischeTestDb();
		sql = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
		ordner = mkdtempSync(join(tmpdir(), 'seed-'));
		datei = join(ordner, '.zugangsdaten-dev');
	});

	afterAll(async () => {
		await sql.end();
		rmSync(ordner, { recursive: true, force: true });
	});

	const zaehle = async () => {
		const [z] = await sql`
			select
				(select count(*)::int from app.betriebe where name = 'Bauwelt') as betriebe,
				(select count(*)::int from app.rollen) as rollen,
				(select count(*)::int from app.benutzer) as benutzer,
				(select count(*)::int from app.plattform_admins) as admins,
				(select count(*)::int from app.kunden) as kunden`;
		return z;
	};

	it('legt Betrieb, Rollen, Benutzer, Admin und 5 Kunden an – zweimal ausgeführt ohne Duplikate', async () => {
		const ausgabe: string[] = [];
		const log = vi.spyOn(console, 'log').mockImplementation((...a) => void ausgabe.push(a.join(' ')));
		try {
			await seedDev(db.urlSuper, { datei });
			const erst = await zaehle();
			const daten1 = leseZugangsdaten(datei);
			await seedDev(db.urlSuper, { datei });
			const zweit = await zaehle();
			const daten2 = leseZugangsdaten(datei);

			expect(erst).toEqual({ betriebe: 1, rollen: 3, benutzer: 4, admins: 1, kunden: 5 });
			expect(zweit).toEqual(erst);
			// Passwörter bleiben beim zweiten Lauf gleich (sonst wären die notierten Zugangsdaten wertlos)
			for (const e of EMAILS) {
				expect(daten1.get(e)).toMatch(/^\S{16,}$/);
				expect(daten2.get(e)).toBe(daten1.get(e));
			}
			// Passwörter tauchen nie in der Ausgabe auf
			const alles = ausgabe.join('\n');
			for (const e of EMAILS) expect(alles).not.toContain(daten1.get(e)!);
		} finally {
			log.mockRestore();
		}
	});

	it('Zugangsdatei hat Modus 600', () => {
		expect(statSync(datei).mode & 0o777).toBe(0o600);
		expect(readFileSync(datei, 'utf8')).toContain('buero@bauwelt.test');
	});

	it('Hashes passen zu den notierten Passwörtern (Argon2id), Rollen stimmen', async () => {
		const daten = leseZugangsdaten(datei);
		const zeilen = await sql`
			select b.email::text as email, b.passwort_hash, b.betrieb_id, r.vorlage
			from app.benutzer b left join app.rollen r on r.id = b.rolle_id`;
		expect(zeilen).toHaveLength(4);
		for (const z of zeilen) {
			expect(z.passwort_hash).toMatch(/^\$argon2id\$/);
			expect(await pruefePasswort(z.passwort_hash, daten.get(z.email)!)).toBe(true);
		}
		const vorlage = Object.fromEntries(zeilen.map((z) => [z.email, z.vorlage]));
		expect(vorlage).toEqual({
			'chef@bauwelt.test': 'chef',
			'buero@bauwelt.test': 'buero',
			'monteur@bauwelt.test': 'monteur',
			'admin@crm.test': null
		});
		const [admin] = await sql`
			select b.betrieb_id, b.totp_aktiv, b.totp_geheim
			from app.benutzer b join app.plattform_admins p on p.benutzer_id = b.id`;
		expect(admin.betrieb_id).toBeNull();
		// Der Admin braucht bei jeder Anmeldung einen Code; das Geheimnis steht nur in der Zugangsdatei.
		expect(admin.totp_aktiv).toBe(true);
		expect(daten.get('totp:admin@crm.test')).toBe(admin.totp_geheim);
	});

	it('passt ein Hash nicht mehr zum notierten Passwort, setzt der Seed ihn zurück (Datei bleibt gültig)', async () => {
		const vorher = leseZugangsdaten(datei).get('buero@bauwelt.test')!;
		await sql`update app.benutzer set passwort_hash = 'kaputt' where email = 'buero@bauwelt.test'`;
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			await seedDev(db.urlSuper, { datei });
		} finally {
			log.mockRestore();
		}
		expect(leseZugangsdaten(datei).get('buero@bauwelt.test')).toBe(vorher);
		const [z] = await sql`select passwort_hash from app.benutzer where email = 'buero@bauwelt.test'`;
		expect(await pruefePasswort(z.passwort_hash, vorher)).toBe(true);
	});

	it('Betrieb „Bauwelt“ hat Tarif test und Status test; Kunden mit Umlauten', async () => {
		const [b] = await sql`
			select b.abo_status, t.schluessel from app.betriebe b join app.tarife t on t.id = b.tarif_id
			where b.name = 'Bauwelt'`;
		expect(b).toEqual({ abo_status: 'test', schluessel: 'test' });
		const kunden = await sql`select coalesce(firma, nachname) as name from app.kunden`;
		expect(kunden.some((k) => /[äöüÄÖÜß]/.test(k.name))).toBe(true);
	});

	describe('läuft nur in der Entwicklungs-Sandbox', () => {
		it('pruefeSandbox: NODE_ENV=production oder fremde Datenbank → Meldung, sonst null', () => {
			expect(pruefeSandbox({ PGDATABASE: 'crm' }, [])).toBeNull();
			expect(pruefeSandbox({ PGDATABASE: 'crm', NODE_ENV: 'production' }, [])).toMatch(/NODE_ENV=production/);
			expect(pruefeSandbox({ PGDATABASE: 'crm_prod' }, [])).toMatch(/Datenbank „crm_prod“/);
			expect(pruefeSandbox({}, [])).toMatch(/Datenbank/);
			// ausdrücklich erlaubt
			expect(pruefeSandbox({ PGDATABASE: 'crm_demo' }, ['--erlaube-db=crm_demo'])).toBeNull();
			expect(pruefeSandbox({ PGDATABASE: 'crm_demo' }, ['--erlaube-db=andere'])).toMatch(/crm_demo/);
			// production bleibt auch mit Flag verboten
			expect(
				pruefeSandbox({ PGDATABASE: 'crm_demo', NODE_ENV: 'production' }, ['--erlaube-db=crm_demo'])
			).toMatch(/NODE_ENV=production/);
		});

		it('Skript bricht mit Meldung und Exit-Code ≠ 0 ab, ohne etwas zu schreiben', () => {
			for (const env of [{ NODE_ENV: 'production' }, { PGDATABASE: 'crm_test' }]) {
				const r = spawnSync('npx', ['tsx', 'scripts/seed-dev.ts'], {
					env: { ...process.env, ...env },
					encoding: 'utf8'
				});
				expect(r.status, JSON.stringify(env)).not.toBe(0);
				expect(r.stderr).toMatch(/Abbruch/);
				expect(r.stdout).not.toMatch(/Entwicklungsdaten bereit/);
			}
		}, 60_000);
	});
});
