import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { _ratenlimitLeeren, warteAufPlatz } from '../../src/lib/server/lexware/ratenlimit';
import { holeClient, speichereLexwareSchluessel } from '../../src/lib/server/lexware/konfig';
import { kundeNachLexware, kundennummernPflege, starteKundenAbgleich } from '../../src/lib/server/lexware/kontakte';
import { laufFuerBetrieb } from '../../src/lib/server/lexware/dienst';
import { holeKunde, listeKunden } from '../../src/lib/server/kunden';
import { starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';

/**
 * Lexware-Kundennummer als Kundennummer im CRM (Can #6748, Migration 129): Nummer kommt aus Lexware
 * (roles.customer.number), eindeutig je Betrieb, einmaliger Abgleich, neue Kunden automatisch in Lexware; dazu das
 * prozessübergreifende Ratenlimit. Nur gegen die Lexware-Attrappe.
 */
describe('Lexware: Kundennummer', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const lauf = async () => laufFuerBetrieb(kA(), { client: await holeClient(kA(), { abstandMs: 0, zeitlimitMs: 1000 }), jetzt: new Date('2026-11-15T00:00:00Z') });

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
		await speichereLexwareSchluessel(kA(), a.schluessel);
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

	it('Anlegen in Lexware holt die vergebene Kundennummer (GET nach POST) und zeigt sie am Kunden; Suche nach Nummer', async () => {
		expect((await holeKunde(kA(), u.kundeA)).kundennummer).toBeNull();
		await kundeNachLexware(kA(), u.kundeA);
		await lauf();
		const [kd] = await root`select lexware_id, lexware_kundennummer from app.kunden where id = ${u.kundeA}`;
		expect(kd.lexware_kundennummer).toBe(a.kontakte.get(kd.lexware_id)!.roles.customer.number);
		expect(kd.lexware_kundennummer).toBeGreaterThan(10000);
		expect(a.anfragen.some((x) => x.methode === 'GET' && x.pfad === `/v1/contacts/${kd.lexware_id}`)).toBe(true);
		expect((await holeKunde(kA(), u.kundeA)).kundennummer).toBe(kd.lexware_kundennummer);
		expect((await listeKunden(kA(), String(kd.lexware_kundennummer))).map((x) => x.id)).toContain(u.kundeA);
	});

	it('Kundennummer ist je Betrieb eindeutig (UNIQUE) und ändert „geaendert“ nicht', async () => {
		const [k2] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Zweit') returning id, geaendert`;
		const [kd] = await root`select lexware_kundennummer from app.kunden where id = ${u.kundeA}`;
		await expect(root`update app.kunden set lexware_kundennummer = ${kd.lexware_kundennummer} where id = ${k2.id}`).rejects.toMatchObject({ code: '23505' });
		await root`update app.kunden set lexware_kundennummer = 99999 where id = ${k2.id}`;
		const [g] = await root`select geaendert from app.kunden where id = ${k2.id}`;
		expect(new Date(g.geaendert).getTime()).toBe(new Date(k2.geaendert).getTime());
		await root`delete from app.kunden where id = ${k2.id}`;
	});

	it('Einmaliger Abgleich: verknüpft per E-Mail, holt Nummern, überträgt die CRM-Daten der neu Verknüpften – genau einmal', async () => {
		const [alt] = await root`insert into app.kunden (betrieb_id, art, vorname, nachname, email, ort, angelegt)
			values (${u.betriebA}, 'privat', 'Erika', 'Altkundin', 'erika.alt@beispiel.test', 'Kiel', now() - interval '1 year') returning id`;
		const lxId = '6b9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5c';
		a.kontakte.set(lxId, { id: lxId, version: 2, roles: { customer: { number: 10500 } }, person: { lastName: 'Altkundin' }, emailAddresses: { private: ['erika.alt@beispiel.test'] } });
		await root`update app.lexware_konfig set kunden_auto_seit = now() where betrieb_id = ${u.betriebA}`;
		expect((await kundennummernPflege(kA())).abgleich).toBe(true);
		expect((await kundennummernPflege(kA())).abgleich).toBe(false); // nur einmal
		await lauf();
		await lauf();
		expect((await root`select lexware_id, lexware_kundennummer from app.kunden where id = ${alt.id}`)[0]).toEqual({ lexware_id: lxId, lexware_kundennummer: 10500 });
		// neu verknüpft → CRM führt: Ort aus dem CRM steht jetzt in Lexware
		expect(a.kontakte.get(lxId)!.addresses.billing[0].city).toBe('Kiel');
		expect(a.kontakte.get(lxId)!.roles.customer.number).toBe(10500);
		// alter, unbekannter Kunde ohne Schalter „fehlende anlegen“ → nicht in Lexware angelegt
		const [ohne] = await root`insert into app.kunden (betrieb_id, art, nachname, angelegt) values (${u.betriebA}, 'privat', 'Ohnelexware', now() - interval '1 year') returning id`;
		expect((await kundennummernPflege(kA())).angelegt).toBe(0);
		expect((await root`select lexware_id from app.kunden where id = ${ohne.id}`)[0].lexware_id).toBeNull();
	});

	it('Neue Kunden (nach dem Verbinden) legt das CRM selbst in Lexware an und holt die Nummer', async () => {
		const [neu] = await root`insert into app.kunden (betrieb_id, art, firma) values (${u.betriebA}, 'firma', 'Neubau Nord GmbH') returning id`;
		expect((await kundennummernPflege(kA())).angelegt).toBe(1);
		expect((await kundennummernPflege(kA())).angelegt).toBe(0); // schon in der Warteschlange
		await lauf();
		const [kd] = await root`select lexware_id, lexware_kundennummer from app.kunden where id = ${neu.id}`;
		expect(kd.lexware_id).not.toBeNull();
		expect(kd.lexware_kundennummer).toBe(a.kontakte.get(kd.lexware_id)!.roles.customer.number);
	});

	it('Ohne Verbindung: keine Pflege', async () => {
		await root`update app.lexware_konfig set status = 'nicht_verbunden' where betrieb_id = ${u.betriebA}`;
		try {
			expect(await kundennummernPflege(kA())).toEqual({ abgleich: false, angelegt: 0 });
		} finally {
			await root`update app.lexware_konfig set status = 'verbunden' where betrieb_id = ${u.betriebA}`;
		}
	});

	it('Ratenlimit gilt prozessübergreifend über die Datenbank (zweiter „Prozess“ wartet)', async () => {
		await warteAufPlatz(u.betriebA, 300);
		_ratenlimitLeeren(); // so, als käme die nächste Anfrage aus einem anderen App-Prozess
		const t = Date.now();
		await warteAufPlatz(u.betriebA, 300);
		expect(Date.now() - t).toBeGreaterThanOrEqual(240);
		expect((await root`select count(*)::int as n from app.lexware_takt where betrieb_id = ${u.betriebA}`)[0].n).toBe(1);
	});

	it('starteKundenAbgleich überträgt Nummern auch für schon verknüpfte Kunden ohne Nummer', async () => {
		const [kd] = await root`select lexware_id, lexware_kundennummer from app.kunden where id = ${u.kundeA}`;
		await root`update app.kunden set lexware_kundennummer = null where id = ${u.kundeA}`;
		await root`delete from app.lexware_auftraege where art = 'kontakte_abgleichen'`;
		await starteKundenAbgleich(kA());
		await lauf();
		expect((await root`select lexware_kundennummer from app.kunden where id = ${u.kundeA}`)[0].lexware_kundennummer).toBe(kd.lexware_kundennummer);
	});
});
