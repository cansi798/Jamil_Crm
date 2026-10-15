import { afterEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../src/lib/server/db';

const GUT = 'postgres://crm_app:pw@db.example.test:5432/crm';
const GUT_ADMIN = 'postgres://crm_admin:pw@db.example.test:5432/crm';

describe('db.ts verweigert den Superuser crm', () => {
	const alt = { app: process.env.DATABASE_URL_APP, admin: process.env.DATABASE_URL_ADMIN };
	afterEach(() => {
		if (alt.app === undefined) delete process.env.DATABASE_URL_APP;
		else process.env.DATABASE_URL_APP = alt.app;
		if (alt.admin === undefined) delete process.env.DATABASE_URL_ADMIN;
		else process.env.DATABASE_URL_ADMIN = alt.admin;
	});

	it('initDb: urlApp mit Benutzer crm → Fehler ohne URL/Passwort in der Meldung', () => {
		const f = () => initDb({ urlApp: 'postgres://crm:supergeheim@db.example.test/crm', urlAdmin: GUT_ADMIN });
		expect(f).toThrow(/DATABASE_URL_APP/);
		expect(f).not.toThrow(/supergeheim|db\.example\.test/);
	});

	it('initDb: urlAdmin mit Benutzer crm → Fehler', () => {
		expect(() => initDb({ urlApp: GUT, urlAdmin: 'postgres://crm:supergeheim@h/crm' })).toThrow(
			/DATABASE_URL_ADMIN/
		);
	});

	it('erkennt auch codierte Schreibweise, Großschreibung und ?user=', () => {
		expect(() => initDb({ urlApp: 'postgres://cr%6D:pw@h/crm', urlAdmin: GUT_ADMIN })).toThrow();
		expect(() => initDb({ urlApp: 'postgres://CRM:pw@h/crm', urlAdmin: GUT_ADMIN })).toThrow();
		expect(() => initDb({ urlApp: 'postgres://crm_app:pw@h/crm?user=crm', urlAdmin: GUT_ADMIN })).toThrow();
	});

	it('eine URL ohne Benutzer oder eine ungültige URL wird abgelehnt (ohne sie auszugeben)', () => {
		expect(() => initDb({ urlApp: 'postgres://h/crm', urlAdmin: GUT_ADMIN })).toThrow(/DATABASE_URL_APP/);
		const f = () => initDb({ urlApp: 'kaputt://:geheim@@@', urlAdmin: GUT_ADMIN });
		expect(f).toThrow(/DATABASE_URL_APP/);
		expect(f).not.toThrow(/geheim/);
	});

	it('eingeschränkte Rollen werden akzeptiert', () => {
		expect(() => initDb({ urlApp: GUT, urlAdmin: GUT_ADMIN })).not.toThrow();
	});

	it('aus der Umgebung: DATABASE_URL_APP mit crm → der erste Zugriff schlägt fehl', async () => {
		// frische Modulinstanz, damit keine Konfiguration aus anderen Tests übrig ist
		vi.resetModules();
		process.env.DATABASE_URL_APP = 'postgres://crm:supergeheim@db.example.test/crm';
		process.env.DATABASE_URL_ADMIN = GUT_ADMIN;
		const frisch = await import('../../src/lib/server/db');
		await expect(frisch.systemAbfrage((sql) => sql`select 1`)).rejects.toThrow(/DATABASE_URL_APP/);
		await expect(frisch.systemAbfrage((sql) => sql`select 1`)).rejects.not.toThrow(/supergeheim/);
	});
});
