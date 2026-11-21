import postgres from 'postgres';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { _ratenlimitLeeren } from '../../src/lib/server/lexware/ratenlimit';
import { holeClient, setzeKundenAnlegen, speichereLexwareSchluessel } from '../../src/lib/server/lexware/konfig';
import { kundeLexwareStand, kundeNachLexware, setze13b, starteKundenAbgleich } from '../../src/lib/server/lexware/kontakte';
import { naechtlicherAbgleich, starteAboEinrichtung, starteAbgleich, ABO_TYPEN } from '../../src/lib/server/lexware/abgleich';
import { nimmEreignisAn, setzeSignaturSchluesselFuerTests } from '../../src/lib/server/lexware/ereignis';
import { laufFuerBetrieb } from '../../src/lib/server/lexware/dienst';
import { POST as webhook } from '../../src/routes/api/lexware/ereignis/+server';
import { beleg, starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';

/** Kunden ↔ Lexware-Kontakte, Rückmeldungen, Belegabgleich (Plan Phase 1, Tasks 4–5; Migrationen 119/120). */
describe('Lexware: Kunden-Abgleich, Webhooks, Belege', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const NACHTS_1UHR = new Date('2026-11-15T00:00:00Z'); // 01:00 Berlin → kein nächtlicher Abgleich
	const lauf = async () => laufFuerBetrieb(kA(), { client: await holeClient(kA(), { abstandMs: 0, zeitlimitMs: 300 }), jetzt: NACHTS_1UHR });
	const paar = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const signiert = (o: unknown) => {
		const t = JSON.stringify(o);
		return { t, sig: createSign('RSA-SHA512').update(t).sign(paar.privateKey).toString('base64') };
	};

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
		setzeSignaturSchluesselFuerTests(paar.publicKey.export({ type: 'spki', format: 'pem' }).toString());
		await speichereLexwareSchluessel(kA(), a.schluessel);
	});
	beforeEach(() => {
		a.ruhe();
		_ratenlimitLeeren();
	});
	afterAll(async () => {
		setzeLexwareBasisFuerTests(null);
		setzeSignaturSchluesselFuerTests(null);
		await a?.stop();
		await schliesseDb();
		await root?.end();
	});

	it('Kunde nach Lexware: Kontakt angelegt (person, Marke), Lexware-ID am Kunden; zweiter Klick → kein zweiter Kontakt', async () => {
		await root`update app.kunden set email = 'hans@beispiel.test' where id = ${u.kundeA}`;
		const r1 = await kundeNachLexware(kA(), u.kundeA);
		const r2 = await kundeNachLexware(kA(), u.kundeA);
		expect(r1).toMatchObject({ neu: true, art: 'kontakt_anlegen' });
		expect(r2).toMatchObject({ id: r1.id, neu: false });
		await lauf();
		expect(a.kontakte.size).toBe(1);
		const [kontakt] = [...a.kontakte.values()];
		expect(kontakt.person).toEqual({ firstName: 'Hans', lastName: 'Müller' });
		expect(kontakt.note).toBe(`CRM-Kunde ${u.kundeA}`);
		const [kd] = await root`select lexware_id, lexware_version from app.kunden where id = ${u.kundeA}`;
		expect(kd).toMatchObject({ lexware_id: kontakt.id, lexware_version: 1 });
		expect(await kundeLexwareStand(kA(), u.kundeA)).toMatchObject({ verknuepft: true, aktuell: true, inArbeit: false });
		expect(a.anfragen.filter((x) => x.methode === 'POST' && x.pfad === '/v1/contacts')).toHaveLength(1);
	});

	it('Zeitüberschreitung beim Anlegen → ungewiss → Suche findet den Kontakt per Marke, kein zweiter POST', async () => {
		const [neu] = await root`insert into app.kunden (betrieb_id, art, firma, email) values (${u.betriebA}, 'firma', 'Bau-Meier GmbH', 'info@bau-meier.test') returning id`;
		await kundeNachLexware(kA(), neu.id);
		a.stoerung({ verzoegerungMs: 700, trotzdemAusfuehren: true, nurPfad: /^\/v1\/contacts$/ });
		await lauf();
		expect((await root`select status from app.lexware_auftraege where nutzlast ->> 'kundeId' = ${neu.id}`)[0].status).toBe('ungewiss');
		await root`update app.lexware_auftraege set naechster_versuch = now() where nutzlast ->> 'kundeId' = ${neu.id}`;
		await lauf();
		const posts = a.anfragen.filter((x) => x.methode === 'POST' && x.pfad === '/v1/contacts' && x.body?.company?.name === 'Bau-Meier GmbH');
		expect(posts).toHaveLength(1);
		const [kd] = await root`select lexware_id from app.kunden where id = ${neu.id}`;
		expect(kd.lexware_id).toBe([...a.kontakte.values()].find((x) => x.company?.name === 'Bau-Meier GmbH')!.id);
	});

	it('Änderung im CRM → aktualisieren per PUT mit aktueller version; Versionskonflikt (409) → neu lesen, dann ok; Kundennummer bleibt', async () => {
		const [kd] = await root`select lexware_id from app.kunden where id = ${u.kundeA}`;
		const k = a.kontakte.get(kd.lexware_id)!;
		k.roles = { customer: { number: 10001 } };
		await root`update app.kunden set ort = 'Hamburg' where id = ${u.kundeA}`;
		expect((await kundeLexwareStand(kA(), u.kundeA)).aktuell).toBe(false);
		await kundeNachLexware(kA(), u.kundeA);
		a.stoerung({ status: 409, nurPfad: /^\/v1\/contacts\/[0-9a-f-]+$/, nurMethode: 'PUT' });
		await lauf();
		const neu = a.kontakte.get(kd.lexware_id)!;
		expect(neu.addresses.billing[0].city).toBe('Hamburg');
		expect(neu.roles.customer.number).toBe(10001);
		expect(neu.note).toContain(`CRM-Kunde ${u.kundeA}`);
		expect((await root`select lexware_version from app.kunden where id = ${u.kundeA}`)[0].lexware_version).toBe(neu.version);
	});

	it('Kunden-Abgleich: Lexware-Kontakt mit gleicher E-Mail wird verknüpft; fehlende nur mit Schalter angelegt', async () => {
		const [k1] = await root`insert into app.kunden (betrieb_id, art, vorname, nachname, email) values (${u.betriebA}, 'privat', 'Erika', 'Musterfrau', 'erika@beispiel.test') returning id`;
		const [k2] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Ohnemail') returning id`;
		const lxId = '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
		a.kontakte.set(lxId, { id: lxId, version: 3, roles: { customer: {} }, person: { lastName: 'Musterfrau' }, emailAddresses: { private: ['ERIKA@beispiel.test'] } });
		await starteKundenAbgleich(kA());
		await lauf();
		expect((await root`select lexware_id, lexware_version from app.kunden where id = ${k1.id}`)[0]).toMatchObject({ lexware_id: lxId, lexware_version: 3 });
		expect((await root`select lexware_id from app.kunden where id = ${k2.id}`)[0].lexware_id).toBeNull();
		expect(await root`select 1 from app.lexware_auftraege where nutzlast ->> 'kundeId' = ${k2.id}`).toHaveLength(0);
		await setzeKundenAnlegen(kA(), true);
		await root`delete from app.lexware_auftraege where art = 'kontakte_abgleichen'`;
		await starteKundenAbgleich(kA());
		await lauf();
		await lauf();
		expect((await root`select lexware_id from app.kunden where id = ${k2.id}`)[0].lexware_id).not.toBeNull();
		await setzeKundenAnlegen(kA(), false);
	});

	it('Webhook: nur mit gültiger Signatur; dieselbe Meldung zweimal → eine Zeile; unbekannte Organisation → nichts gespeichert', async () => {
		const [kd] = await root`select lexware_id from app.kunden where id = ${u.kundeA}`;
		const e = { organizationId: a.organisationId, eventType: 'contact.changed', resourceId: kd.lexware_id, eventDate: new Date(Date.now() + 120_000).toISOString() };
		const { t, sig } = signiert(e);
		const anfrage = (body: string, s: string | null) => webhook({ request: new Request('http://localhost/api/lexware/ereignis', { method: 'POST', headers: { 'content-type': 'application/json', ...(s ? { 'x-lxo-signature': s } : {}) }, body }) } as never);
		expect((await anfrage(t, null)).status).toBe(401);
		expect((await anfrage(t.replace('contact.changed', 'contact.deleted'), sig)).status).toBe(401);
		expect((await anfrage(t, sig)).status).toBe(202);
		expect((await anfrage(t, sig)).status).toBe(202);
		expect(await root`select 1 from app.lexware_ereignisse where resource_id = ${kd.lexware_id}`).toHaveLength(1);
		const fremd = signiert({ ...e, organizationId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' });
		expect(await nimmEreignisAn(fremd.t, fremd.sig)).toEqual({ status: 202, ergebnis: 'unbekannt' });
		const kaputt = signiert({ ...e, resourceId: 'x' });
		expect((await nimmEreignisAn(kaputt.t, kaputt.sig)).status).toBe(400);
		// Verarbeitung: Kunde „in Lexware geändert“
		await lauf();
		expect((await root`select lexware_geaendert from app.kunden where id = ${u.kundeA}`)[0].lexware_geaendert).toBe(true);
		expect((await kundeLexwareStand(kA(), u.kundeA)).geaendertInLexware).toBe(true);
		expect((await root`select verarbeitet_am, ergebnis from app.lexware_ereignisse where resource_id = ${kd.lexware_id}`)[0].ergebnis).toBe('kunde markiert');
	});

	it('Webhook „Kontakt geändert“ überschreibt eine noch nicht gesendete CRM-Änderung nicht – das CRM führt (Migration 126)', async () => {
		const [kd] = await root`select lexware_id from app.kunden where id = ${u.kundeA}`;
		// alles gesendet → dann im CRM ändern, ohne zu senden
		await root`update app.kunden set lexware_stand = now() - interval '1 hour', geaendert = now() - interval '2 hours', lexware_geaendert = false where id = ${u.kundeA}`;
		await root`update app.kunden set telefon = '040 999 111' where id = ${u.kundeA}`;
		expect((await kundeLexwareStand(kA(), u.kundeA)).aktuell).toBe(false);
		const [vor] = await root`select geaendert, lexware_stand from app.kunden where id = ${u.kundeA}`;
		// Lexware meldet eine fremde Änderung am Kontakt
		const e = { organizationId: a.organisationId, eventType: 'contact.changed', resourceId: kd.lexware_id, eventDate: new Date(Date.now() + 300_000).toISOString() };
		const { t, sig } = signiert(e);
		expect((await nimmEreignisAn(t, sig)).status).toBe(202);
		await lauf();
		const [nach] = await root`select geaendert, lexware_stand, lexware_geaendert from app.kunden where id = ${u.kundeA}`;
		expect(nach.lexware_geaendert).toBe(true);
		// „geaendert“ und der Lexware-Stand bleiben: die CRM-Änderung ist weiter „zu senden“
		expect(new Date(nach.geaendert).getTime()).toBe(new Date(vor.geaendert).getTime());
		expect(new Date(nach.lexware_stand).getTime()).toBe(new Date(vor.lexware_stand).getTime());
		expect((await kundeLexwareStand(kA(), u.kundeA)).aktuell).toBe(false);
		// Abgleich überträgt die CRM-Daten (PUT) – danach aktuell
		await root`delete from app.lexware_auftraege where art = 'kontakte_abgleichen'`;
		await starteKundenAbgleich(kA());
		await lauf();
		await lauf();
		const k = a.kontakte.get(kd.lexware_id)!;
		expect(k.phoneNumbers.private).toEqual(['040 999 111']);
		expect((await kundeLexwareStand(kA(), u.kundeA)).aktuell).toBe(true);
		// Ein rein technisches Update (nur Lexware-Felder) setzt „geaendert“ nicht neu
		const [g1] = await root`select geaendert from app.kunden where id = ${u.kundeA}`;
		await root`update app.kunden set lexware_version = lexware_version + 0, lexware_stand = now() where id = ${u.kundeA}`;
		const [g2] = await root`select geaendert from app.kunden where id = ${u.kundeA}`;
		expect(new Date(g2.geaendert).getTime()).toBe(new Date(g1.geaendert).getTime());
	});

	it('Belegabgleich über mehrere Seiten: Upsert in Cent mit Kundenbezug; zweiter Lauf ändert nichts doppelt; Rückmeldung markiert veraltet', async () => {
		const [kd] = await root`select lexware_id from app.kunden where id = ${u.kundeA}`;
		for (let i = 0; i < 260; i++) a.belege.push(beleg({ voucherNumber: `RE${2000 + i}`, contactId: i === 0 ? kd.lexware_id : null }));
		await starteAbgleich(kA());
		await lauf();
		expect((await root`select count(*)::int as n from app.lexware_belege where betrieb_id = ${u.betriebA}`)[0].n).toBe(260);
		const [b] = await root`select * from app.lexware_belege where nummer = 'RE2000'`;
		expect(b).toMatchObject({ typ: 'invoice', status: 'open', brutto_cent: '9980', offen_cent: '7480', kunde_id: u.kundeA, faellig: expect.anything() });
		expect(a.anfragen.filter((x) => x.pfad === '/v1/voucherlist').map((x) => x.query.get('page'))).toEqual(['0', '1']);
		expect(a.anfragen.find((x) => x.pfad === '/v1/voucherlist')!.query.get('voucherType')).toBe('quotation,orderconfirmation,invoice,downpaymentinvoice,creditnote');
		// Zahlung in Lexware → Rückmeldung → veraltet → neuer Abgleich übernimmt den Stand
		// wie in Lexware (und a.bezahle): eine Zahlung ändert auch updatedDate – sonst fände der Abgleich „seit gestern“
		// den Beleg nicht (das feste Datum aus beleg() lag nur am 15.11. noch im Fenster → Test lief ab 16.11. rot)
		Object.assign(a.belege[0], { voucherStatus: 'paid', openAmount: 0, updatedDate: new Date().toISOString() });
		const { t, sig } = signiert({ organizationId: a.organisationId, eventType: 'payment.changed', resourceId: a.belege[0].id, eventDate: new Date().toISOString() });
		expect((await nimmEreignisAn(t, sig)).ergebnis).toBe('neu');
		await laufFuerBetrieb(kA(), { client: await holeClient(kA(), { abstandMs: 0 }), jetzt: NACHTS_1UHR, max: 0 });
		expect((await root`select veraltet from app.lexware_belege where lexware_id = ${a.belege[0].id}`)[0].veraltet).toBe(true);
		await lauf();
		expect((await root`select status, offen_cent, veraltet from app.lexware_belege where lexware_id = ${a.belege[0].id}`)[0]).toMatchObject({ status: 'paid', offen_cent: '0', veraltet: false });
		// Zahlungsstand holen (payment.changed) klappt auch für Belege, die nur in der Belegliste stehen – kein Fall „prüfen“
		expect(await root`select art, letzter_fehler from app.lexware_auftraege where betrieb_id = ${u.betriebA} and status not in ('erledigt', 'abgebrochen')`).toEqual([]);
		expect((await root`select count(*)::int as n from app.lexware_belege where betrieb_id = ${u.betriebA}`)[0].n).toBe(260);
		// RLS: Betrieb B sieht keine Belege
		expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select 1 from app.lexware_belege`)).toHaveLength(0);
	}, 30_000);

	it('Rückmeldungen einrichten: alle Typen genau einmal (zweiter Lauf: keine Doppel); ohne HTTPS-Adresse → 409', async () => {
		await expect(starteAboEinrichtung(kA(), 'http://127.0.0.1:3000')).rejects.toMatchObject({ status: 409 });
		const r = await starteAboEinrichtung(kA(), 'https://crm.bauwelt.test');
		expect(r.url).toBe('https://crm.bauwelt.test/api/lexware/ereignis');
		await lauf();
		expect(a.abos).toHaveLength(ABO_TYPEN.length);
		await root`delete from app.lexware_auftraege where art = 'abos_einrichten'`;
		await starteAboEinrichtung(kA(), 'https://crm.bauwelt.test');
		await lauf();
		expect(a.abos).toHaveLength(ABO_TYPEN.length);
		expect((await root`select count(*)::int as n from app.lexware_abos where betrieb_id = ${u.betriebA} and lexware_id is not null`)[0].n).toBe(ABO_TYPEN.length);
	});

	it('Nachts ab 02:00 einmal täglich: Belege + Kunden eingestellt; § 13b nur für Firmenkunden mit Datum', async () => {
		const zwei = new Date('2026-11-15T01:30:00Z'); // 02:30 Berlin
		expect(await naechtlicherAbgleich(kA(), zwei)).toBe(true);
		expect(await naechtlicherAbgleich(kA(), new Date('2026-11-15T05:00:00Z'))).toBe(false);
		expect(await root`select 1 from app.lexware_auftraege where idempotenz like 'belege_abgleichen:nacht:2026-11-15'`).toHaveLength(1);
		await expect(setze13b(kA(), u.kundeA, { bauleister: true, bis: '2028-12-31' })).rejects.toMatchObject({ status: 400 });
		const [f] = await root`select id from app.kunden where firma = 'Bau-Meier GmbH'`;
		await expect(setze13b(kA(), f.id, { bauleister: true })).rejects.toMatchObject({ status: 400 });
		await setze13b(kA(), f.id, { bauleister: true, bis: '2028-12-31' });
		expect((await root`select bauleister_13b, bescheinigung_13b_bis::text as bis from app.kunden where id = ${f.id}`)[0]).toEqual({ bauleister_13b: true, bis: '2028-12-31' });
	});
});
