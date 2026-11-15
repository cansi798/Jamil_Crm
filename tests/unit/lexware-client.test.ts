import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LEXWARE_BASIS, lexwareBasis, lexwareClient, LexwareFehler, setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { warteAufPlatz, sperreKey, _ratenlimitLeeren } from '../../src/lib/server/lexware/ratenlimit';
import { starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';

/** Lexware-Client (Plan Phase 1, Task 3) gegen die Attrappe – Formate laut developers.lexware.io. */
describe('Lexware-Client', () => {
	let a: Attrappe;
	const protokoll: any[] = [];
	const client = (o: Partial<Parameters<typeof lexwareClient>[0]> = {}) =>
		lexwareClient({ schluessel: a.schluessel, ratenKey: `t-${Math.random()}`, abstandMs: 0, protokoll: (e) => protokoll.push(e), ...o });

	beforeAll(async () => {
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
	});
	afterAll(async () => {
		setzeLexwareBasisFuerTests(null);
		await a.stop();
	});
	beforeEach(() => {
		a.zuruecksetzen();
		protokoll.length = 0;
		_ratenlimitLeeren();
	});

	it('Basis-Adresse ist fest die offizielle API (nicht über die Umgebung änderbar)', () => {
		setzeLexwareBasisFuerTests(null);
		const alt = process.env.CRM_LEXWARE_URL;
		process.env.CRM_LEXWARE_URL = 'http://169.254.169.254';
		expect(lexwareBasis()).toBe(LEXWARE_BASIS);
		expect(LEXWARE_BASIS).toBe('https://api.lexware.io');
		// nur im Testmodus und nur auf 127.0.0.1 (Probe-Server mit Attrappe)
		process.env.CRM_TESTMODUS = '1';
		expect(lexwareBasis()).toBe(LEXWARE_BASIS);
		process.env.CRM_LEXWARE_URL = 'http://127.0.0.1:4567';
		expect(lexwareBasis()).toBe('http://127.0.0.1:4567');
		delete process.env.CRM_TESTMODUS;
		expect(lexwareBasis()).toBe(LEXWARE_BASIS);
		if (alt === undefined) delete process.env.CRM_LEXWARE_URL;
		else process.env.CRM_LEXWARE_URL = alt;
		setzeLexwareBasisFuerTests(a.url);
	});

	it('GET mit Bearer-Schlüssel; Protokoll ohne Authorization und ohne Schlüssel', async () => {
		const p = await client().get<any>('/v1/profile');
		expect(p.companyName).toBe('Bauwelt Testfirma GmbH');
		expect(a.anfragen[0].auth).toBe(`Bearer ${a.schluessel}`);
		expect(protokoll[0]).toMatchObject({ methode: 'GET', pfad: '/v1/profile', status: 200 });
		expect(JSON.stringify(protokoll)).not.toContain(a.schluessel);
	});

	it('429 → „grenze“, wiederholbar, Wartezeit aus Retry-After; Schlüssel kurz gesperrt', async () => {
		a.stoerung({ status: 429, retryAfter: 3 });
		const e = await client().get('/v1/profile').catch((x) => x);
		expect(e).toBeInstanceOf(LexwareFehler);
		expect(e).toMatchObject({ status: 429, art: 'grenze', wiederholbar: true, nachSekunden: 3 });
	});

	it('500/503/504 → „server“ wiederholbar; 401 → „schluessel“ nicht wiederholbar; 409 → „konflikt“; 406 → „daten“', async () => {
		for (const s of [500, 503, 504]) {
			a.stoerung({ status: s });
			expect(await client().get('/v1/profile').catch((x) => x)).toMatchObject({ art: 'server', wiederholbar: true });
		}
		expect(await client({ schluessel: 'falsch' }).get('/v1/profile').catch((x) => x)).toMatchObject({ status: 401, art: 'schluessel', wiederholbar: false });
		a.stoerung({ status: 402 });
		expect(await client().get('/v1/profile').catch((x) => x)).toMatchObject({ art: 'vertrag', wiederholbar: false });
		a.stoerung({ status: 409 });
		expect(await client().get('/v1/profile').catch((x) => x)).toMatchObject({ art: 'konflikt', wiederholbar: false });
		a.stoerung({ status: 406 });
		expect(await client().get('/v1/profile').catch((x) => x)).toMatchObject({ art: 'daten', wiederholbar: false });
		expect(await client().get('/v1/contacts/00000000-0000-4000-8000-000000000000').catch((x) => x)).toMatchObject({ art: 'nicht_gefunden' });
	});

	it('Zeitüberschreitung → „zeit“ (Ausgang ungewiss)', async () => {
		a.stoerung({ verzoegerungMs: 400 });
		expect(await client({ zeitlimitMs: 100 }).get('/v1/profile').catch((x) => x)).toMatchObject({ art: 'zeit', wiederholbar: true });
	});

	it('Fehlertext aus beiden Lexware-Formaten (regular: message, legacy: IssueList)', async () => {
		const e = await client().post('/v1/contacts', { version: 0, roles: { customer: {} } }).catch((x) => x);
		expect(e).toMatchObject({ status: 400, art: 'daten' });
		expect(e.message).toContain('missing_entity');
		expect(e.message).toContain('company.name');
	});

	it('Ratenlimit: Abstand je Schlüssel (Standard 667 ms ≈ 1,5/s, Doku-Grenze 2/s); 429 sperrt den Schlüssel', async () => {
		const t0 = Date.now();
		await warteAufPlatz('k1', 200);
		await warteAufPlatz('k1', 200);
		await warteAufPlatz('k1', 200);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(390);
		// anderer Schlüssel wartet nicht
		const t1 = Date.now();
		await warteAufPlatz('k2', 200);
		expect(Date.now() - t1).toBeLessThan(50);
		sperreKey('k2', 300);
		const t2 = Date.now();
		await warteAufPlatz('k2', 0);
		expect(Date.now() - t2).toBeGreaterThanOrEqual(280);
		const c = lexwareClient({ schluessel: a.schluessel, ratenKey: 'k3' });
		const t3 = Date.now();
		await c.get('/v1/profile');
		await c.get('/v1/profile');
		expect(Date.now() - t3).toBeGreaterThanOrEqual(600);
	});
});
