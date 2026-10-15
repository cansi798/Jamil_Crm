import postgres from 'postgres';
import { ladeEnv, migrate } from '../../scripts/migrate';

const TEST_DB = 'crm_test';

export type TestDb = { urlSuper: string; urlApp: string; urlAdmin: string };

function url(benutzer: string, passwort: string, datenbank: string): string {
	const host = process.env.PGHOST ?? 'localhost';
	const port = process.env.PGPORT ?? '5432';
	return `postgres://${encodeURIComponent(benutzer)}:${encodeURIComponent(passwort)}@${host}:${port}/${datenbank}`;
}

function pflicht(name: string): string {
	const wert = process.env[name];
	if (!wert) throw new Error(`Umgebungsvariable ${name} fehlt`);
	return wert;
}

/** Legt die Datenbank `crm_test` neu an, migriert sie und liefert Verbindungs-URLs je Rolle. */
export async function frischeTestDb(): Promise<TestDb> {
	ladeEnv();
	const superBenutzer = process.env.PGUSER ?? 'crm';
	const superPasswort = pflicht('PGPASSWORD');
	const verwaltung = postgres(url(superBenutzer, superPasswort, process.env.PGDATABASE ?? 'crm'), {
		max: 1,
		onnotice: () => {}
	});
	try {
		await verwaltung.unsafe(`drop database if exists ${TEST_DB} with (force)`);
		await verwaltung.unsafe(`create database ${TEST_DB}`);
	} finally {
		await verwaltung.end();
	}
	const urlSuper = url(superBenutzer, superPasswort, TEST_DB);
	await migrate(urlSuper);
	return {
		urlSuper,
		urlApp: url('crm_app', pflicht('CRM_APP_PASSWORT'), TEST_DB),
		urlAdmin: url('crm_admin', pflicht('CRM_ADMIN_PASSWORT'), TEST_DB)
	};
}
