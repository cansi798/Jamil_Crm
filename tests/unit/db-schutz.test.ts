import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../src/lib/server/db';

const GUT = 'postgres://crm_app:pw@db.example.test:5432/crm';
const GUT_ADMIN = 'postgres://crm_admin:pw@db.example.test:5432/crm';
const GUT_AUTH = 'postgres://crm_auth:pw@db.example.test:5432/crm';

describe('db.ts verweigert den Superuser crm', () => {
	const alt = {
		app: process.env.DATABASE_URL_APP,
		admin: process.env.DATABASE_URL_ADMIN,
		auth: process.env.DATABASE_URL_AUTH
	};
	afterEach(() => {
		if (alt.app === undefined) delete process.env.DATABASE_URL_APP;
		else process.env.DATABASE_URL_APP = alt.app;
		if (alt.admin === undefined) delete process.env.DATABASE_URL_ADMIN;
		else process.env.DATABASE_URL_ADMIN = alt.admin;
		if (alt.auth === undefined) delete process.env.DATABASE_URL_AUTH;
		else process.env.DATABASE_URL_AUTH = alt.auth;
	});

	it('initDb: urlApp mit Benutzer crm → Fehler ohne URL/Passwort in der Meldung', () => {
		const f = () => initDb({ urlApp: 'postgres://crm:supergeheim@db.example.test/crm', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH });
		expect(f).toThrow(/DATABASE_URL_APP/);
		expect(f).not.toThrow(/supergeheim|db\.example\.test/);
	});

	it('initDb: urlAdmin mit Benutzer crm → Fehler', () => {
		expect(() => initDb({ urlApp: GUT, urlAdmin: 'postgres://crm:supergeheim@h/crm', urlAuth: GUT_AUTH })).toThrow(
			/DATABASE_URL_ADMIN/
		);
	});

	it('initDb: urlAuth mit Benutzer crm → Fehler', () => {
		const f = () => initDb({ urlApp: GUT, urlAdmin: GUT_ADMIN, urlAuth: 'postgres://crm:supergeheim@h/crm' });
		expect(f).toThrow(/DATABASE_URL_AUTH/);
		expect(f).not.toThrow(/supergeheim/);
	});

	it('erkennt auch codierte Schreibweise, Großschreibung und ?user=', () => {
		expect(() => initDb({ urlApp: 'postgres://cr%6D:pw@h/crm', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH })).toThrow();
		expect(() => initDb({ urlApp: 'postgres://CRM:pw@h/crm', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH })).toThrow();
		expect(() => initDb({ urlApp: 'postgres://crm_app:pw@h/crm?user=crm', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH })).toThrow();
	});

	it('eine URL ohne Benutzer oder eine ungültige URL wird abgelehnt (ohne sie auszugeben)', () => {
		expect(() => initDb({ urlApp: 'postgres://h/crm', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH })).toThrow(/DATABASE_URL_APP/);
		const f = () => initDb({ urlApp: 'kaputt://:geheim@@@', urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH });
		expect(f).toThrow(/DATABASE_URL_APP/);
		expect(f).not.toThrow(/geheim/);
	});

	it('eingeschränkte Rollen werden akzeptiert', () => {
		expect(() => initDb({ urlApp: GUT, urlAdmin: GUT_ADMIN, urlAuth: GUT_AUTH })).not.toThrow();
	});

	it('aus der Umgebung: DATABASE_URL_APP mit crm → der erste Zugriff schlägt fehl', async () => {
		// frische Modulinstanz, damit keine Konfiguration aus anderen Tests übrig ist
		vi.resetModules();
		process.env.DATABASE_URL_APP = 'postgres://crm:supergeheim@db.example.test/crm';
		process.env.DATABASE_URL_ADMIN = GUT_ADMIN;
		process.env.DATABASE_URL_AUTH = GUT_AUTH;
		const frisch = await import('../../src/lib/server/db');
		await expect(frisch.systemAbfrage((sql) => sql`select 1`)).rejects.toThrow(/DATABASE_URL_APP/);
		await expect(frisch.systemAbfrage((sql) => sql`select 1`)).rejects.not.toThrow(/supergeheim/);
	});
});

describe('db.ts: DATABASE_URL_AUTH aus der Umgebung', () => {
	it('mit Benutzer crm → der erste Zugriff schlägt fehl, ohne die URL zu nennen', async () => {
		vi.resetModules();
		const alt = { ...process.env };
		process.env.DATABASE_URL_APP = GUT;
		process.env.DATABASE_URL_ADMIN = GUT_ADMIN;
		process.env.DATABASE_URL_AUTH = 'postgres://crm:supergeheim@db.example.test/crm';
		try {
			const frisch = await import('../../src/lib/server/db');
			const fehler = await frisch.systemAbfrage((sql) => sql`select 1`).catch((e: Error) => e);
			expect(String((fehler as Error).message)).toMatch(/DATABASE_URL_AUTH/);
			expect(String((fehler as Error).message)).not.toMatch(/supergeheim/);
		} finally {
			for (const k of ['DATABASE_URL_APP', 'DATABASE_URL_ADMIN', 'DATABASE_URL_AUTH']) {
				if (alt[k] === undefined) delete process.env[k];
				else process.env[k] = alt[k];
			}
		}
	});
});
