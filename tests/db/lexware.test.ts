import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { setzeLexwareBasisFuerTests, LexwareFehler } from '../../src/lib/server/lexware/client';
import { _ratenlimitLeeren } from '../../src/lib/server/lexware/ratenlimit';
import { holeClient, ladeLexwareKonfig, protokollFertig, pruefeVerbindung, speichereLexwareSchluessel, trenneLexware } from '../../src/lib/server/lexware/konfig';
import { arbeiteAb, auftragErneut, listeAuftraege, stelleEin, type HandlerTabelle } from '../../src/lib/server/lexware/warteschlange';
import { starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';

/** Lexware-Grundlage (Plan Phase 1, Task 3; Migration 119) gegen die Attrappe. */
describe('Lexware: Verbindung, Warteschlange, Protokoll', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const schnell = () => holeClient(kA(), { abstandMs: 0, zeitlimitMs: 300 });

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
	});
	beforeEach(() => {
		a.ruhe();
		_ratenlimitLeeren();
	});
	afterAll(async () => {
		setzeLexwareBasisFuerTests(null);
		await a?.stop();
		await schliesseDb();
		await root?.end();
	});

	it('Schlüssel speichern: verschlüsselt, für crm_app nicht lesbar; Verbindung prüfen liest das Profil', async () => {
		const c = await speichereLexwareSchluessel(kA(), a.schluessel);
		expect(c).toMatchObject({ status: 'verbunden', verbunden: true, firmenname: 'Bauwelt Testfirma GmbH', steuerart: 'net', kleinunternehmer: false, organisationId: a.organisationId, schluesselHinweis: '…0001' });
		expect(c.gueltigBis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(JSON.stringify(c)).not.toContain(a.schluessel);
		const [roh] = await root`select schluessel from app.lexware_konfig where betrieb_id = ${u.betriebA}`;
		expect(Buffer.from(roh.schluessel).toString('latin1')).not.toContain('testschluessel');
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select schluessel from app.lexware_konfig`)).rejects.toThrow(/permission denied/);
		// RLS: Betrieb B sieht nichts
		expect((await ladeLexwareKonfig(kB())).status).toBe('nicht_verbunden');
		expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select 1 from app.lexware_konfig`)).toHaveLength(0);
		// Protokoll ohne Schlüssel
		await protokollFertig();
		const p = await root`select methode, pfad, status from app.lexware_protokoll where betrieb_id = ${u.betriebA}`;
		expect(p[0]).toMatchObject({ methode: 'GET', pfad: '/v1/profile', status: 200 });
		expect(JSON.stringify(await root`select * from app.lexware_protokoll`)).not.toContain(a.schluessel);
	});

	it('falscher Schlüssel → „Schlüssel ungültig“; ungültige Eingabe → 400; dasselbe Lexware-Konto für zwei Betriebe → Fehler', async () => {
		await expect(speichereLexwareSchluessel(kB(), 'kurz')).rejects.toMatchObject({ status: 400 });
		const b = await speichereLexwareSchluessel(kB(), 'falscher-schluessel-0000000000');
		expect(b.status).toBe('schluessel_ungueltig');
		const b2 = await speichereLexwareSchluessel(kB(), a.schluessel);
		expect(b2.status).toBe('fehler');
		expect(b2.letzterFehler).toMatch(/anderen Betrieb/);
		await trenneLexware(kB());
		expect((await ladeLexwareKonfig(kB())).schluesselGesetzt).toBe(false);
		expect((await pruefeVerbindung(kA())).status).toBe('verbunden');
	});

	it('Idempotenz: derselbe Auftrag zweimal (Doppelklick) → genau ein Eintrag', async () => {
		const x = await stelleEin(kA(), { art: 'kontakt_anlegen', nutzlast: { kundeId: u.kundeA }, idempotenz: 'test:doppelt' });
		const y = await stelleEin(kA(), { art: 'kontakt_anlegen', nutzlast: { kundeId: u.kundeA }, idempotenz: 'test:doppelt' });
		expect(x.neu).toBe(true);
		expect(y).toEqual({ id: x.id, neu: false });
		// anderer Betrieb darf denselben Schlüssel haben (eigene Warteschlange)
		expect((await stelleEin(kB(), { art: 'kontakt_anlegen', idempotenz: 'test:doppelt' })).neu).toBe(true);
		expect(await root`select 1 from app.lexware_auftraege where idempotenz = 'test:doppelt' and betrieb_id = ${u.betriebA}`).toHaveLength(1);
		await root`update app.lexware_auftraege set status = 'abgebrochen' where idempotenz = 'test:doppelt'`;
	});

	it('429 → wartet mit Wartezeit von Lexware; 5xx → wartet mit wachsendem Abstand; danach erledigt', async () => {
		let aufrufe = 0;
		const h: HandlerTabelle = { belege_abgleichen: { ausfuehren: async (c) => (aufrufe++, await c.get('/v1/profile'), { ergebnis: { ok: true } }) } };
		const { id } = await stelleEin(kA(), { art: 'belege_abgleichen', idempotenz: 'test:429' });
		a.stoerung({ status: 429, retryAfter: 7 });
		expect(await arbeiteAb(kA(), await schnell(), h)).toEqual({ erledigt: 0, fehler: 1 });
		let [z] = await root`select status, versuche, extract(epoch from naechster_versuch - now())::int as warte, letzter_fehler from app.lexware_auftraege where id = ${id}`;
		expect(z.status).toBe('wartet');
		expect(z.letzter_fehler).toMatch(/Ratenlimit/);
		expect(z.warte).toBeGreaterThanOrEqual(5);
		expect(z.warte).toBeLessThanOrEqual(8);
		_ratenlimitLeeren(); // Sperre des Schlüssels nach 429 (7 s) für den Test aufheben
		await root`update app.lexware_auftraege set naechster_versuch = now() where id = ${id}`;
		a.stoerung({ status: 503 });
		await arbeiteAb(kA(), await schnell(), h);
		[z] = await root`select status, versuche, extract(epoch from naechster_versuch - now())::int as s from app.lexware_auftraege where id = ${id}`;
		expect(z).toMatchObject({ status: 'wartet', versuche: 2 });
		expect(z.s).toBeGreaterThanOrEqual(55);
		await root`update app.lexware_auftraege set naechster_versuch = now() where id = ${id}`;
		expect((await arbeiteAb(kA(), await schnell(), h)).erledigt).toBe(1);
		expect((await root`select status, ergebnis from app.lexware_auftraege where id = ${id}`)[0]).toMatchObject({ status: 'erledigt', ergebnis: { ok: true } });
		expect(aufrufe).toBe(3);
	});

	it('Zeitüberschreitung beim Anlegen → ungewiss → vor dem Neuversuch wird nachgesehen, kein zweiter Aufruf', async () => {
		let angelegt = 0;
		const h: HandlerTabelle = {
			kontakt_anlegen: {
				anlegend: true,
				ausfuehren: async (c) => (angelegt++, await c.get('/v1/profile'), { lexwareId: '11111111-1111-4111-8111-111111111111' }),
				vorhanden: async () => '22222222-2222-4222-8222-222222222222'
			}
		};
		const { id } = await stelleEin(kA(), { art: 'kontakt_anlegen', idempotenz: 'test:zeit' });
		a.stoerung({ verzoegerungMs: 800, trotzdemAusfuehren: true });
		await arbeiteAb(kA(), await schnell(), h);
		expect((await root`select status from app.lexware_auftraege where id = ${id}`)[0].status).toBe('ungewiss');
		await root`update app.lexware_auftraege set naechster_versuch = now() where id = ${id}`;
		await arbeiteAb(kA(), await schnell(), h);
		expect(angelegt).toBe(1);
		expect((await root`select status, lexware_id from app.lexware_auftraege where id = ${id}`)[0]).toMatchObject({ status: 'erledigt', lexware_id: '22222222-2222-4222-8222-222222222222' });
	});

	it('401 → prüfen, Verbindung „Schlüssel ungültig“, Aufgabe + Glocke für den Chef (einmal); kein Wiederholen', async () => {
		const h: HandlerTabelle = { belege_abgleichen: { ausfuehren: async (c) => (await c.get('/v1/profile'), {}) } };
		const { id } = await stelleEin(kA(), { art: 'belege_abgleichen', idempotenz: 'test:401' });
		a.stoerung({ status: 401 });
		await arbeiteAb(kA(), await schnell(), h);
		expect((await root`select status from app.lexware_auftraege where id = ${id}`)[0].status).toBe('pruefen');
		expect((await ladeLexwareKonfig(kA())).status).toBe('schluessel_ungueltig');
		const t = await root`select id, zustaendig_id from app.todos where betrieb_id = ${u.betriebA} and titel = 'Lexware-Schlüssel erneuern' and erledigt_am is null`;
		expect(t).toHaveLength(1);
		expect(t[0].zustaendig_id).toBe(u.ids.chefA);
		expect(await root`select 1 from app.erinnerungen where todo_id = ${t[0].id}`).toHaveLength(1);
		// nicht noch einmal ausgeführt
		expect((await arbeiteAb(kA(), await schnell(), h)).erledigt + (await arbeiteAb(kA(), await schnell(), h)).fehler).toBe(0);
		// 406 → prüfen + eigene Aufgabe; „Erneut versuchen“ → ungewiss, sofort fällig
		await pruefeVerbindung(kA());
		const { id: id2 } = await stelleEin(kA(), { art: 'belege_abgleichen', idempotenz: 'test:406' });
		a.stoerung({ status: 406 });
		await arbeiteAb(kA(), await schnell(), h);
		expect((await listeAuftraege(kA())).find((x) => x.id === id2)).toMatchObject({ status: 'pruefen', name: 'Belege aus Lexware abgleichen' });
		expect(await root`select 1 from app.todos where titel = 'Lexware: Belege aus Lexware abgleichen prüfen'`).toHaveLength(1);
		await auftragErneut(kA(), id2);
		expect((await arbeiteAb(kA(), await schnell(), h)).erledigt).toBeGreaterThanOrEqual(1);
		expect(await listeAuftraege(kB())).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: id2 })]));
	});

	it('Client ohne Verbindung → 409', async () => {
		await expect(holeClient(kB())).rejects.toMatchObject({ status: 409 });
		expect(LexwareFehler).toBeTypeOf('function');
	});
});
