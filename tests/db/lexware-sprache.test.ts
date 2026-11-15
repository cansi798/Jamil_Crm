import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { speichereLexwareSchluessel } from '../../src/lib/server/lexware/konfig';
import { starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';

/** Sprachaktionen Lexware/Mail end-to-end über /api/sprache/text (Fake-KI, Lexware-Attrappe). */
describe('Sprache: Lexware und Mailversand', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const sag = async (nutzer: Nutzer, text: string) => (await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		setzeKiAnbieter(new FakeKi());
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
		await root`update app.rollen set rechte = array_append(rechte, 'sprache.nutzen') where name = 'Chef' and not ('sprache.nutzen' = any (rechte))`;
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		setzeLexwareBasisFuerTests(null);
		await a?.stop();
		await schliesseDb();
		await root?.end();
	});

	const chef = () => ({ ...u.chefA, rechte: [...u.chefA.rechte, 'sprache.nutzen'] });

	it('„Ist Lexware verbunden?“ vor und nach dem Verbinden; ohne Vorschlag (keine Rückfrage)', async () => {
		let r = await sag(chef(), 'Ist Lexware verbunden?');
		expect(r.vorschlag).toBeNull();
		expect(r.karte.aktion).toBe('abfrage_lexware');
		expect(r.karte.antwort.vorlesen).toMatch(/noch nicht verbunden/);
		await speichereLexwareSchluessel({ betriebId: u.betriebA, benutzerId: u.ids.chefA }, a.schluessel);
		r = await sag(chef(), 'Hängt etwas bei Lexware?');
		expect(r.karte.antwort.vorlesen).toBe('Lexware ist verbunden mit Bauwelt Testfirma GmbH. Es hängt nichts.');
	});

	it('„Lexware-Abgleich starten“ stellt Belege + Kunden ein (zweimal in derselben Minute → nichts doppelt)', async () => {
		const r = await sag(chef(), 'Lexware-Abgleich starten');
		expect(r.karte.antwort.vorlesen).toMatch(/läuft im Hintergrund/);
		const r2 = await sag(chef(), 'Lexware-Abgleich starten');
		expect(r2.karte.antwort.vorlesen).toMatch(/schon unterwegs/);
		const z = await root`select art from app.lexware_auftraege where betrieb_id = ${u.betriebA} order by art`;
		expect(z.map((x) => x.art)).toEqual(['belege_abgleichen', 'kontakte_abgleichen']);
	});

	it('„Ist Kunde Müller in Lexware?“ – nicht verknüpft / verknüpft; Monteur ohne Recht bekommt Hinweis', async () => {
		let r = await sag(chef(), 'Ist Kunde Müller in Lexware?');
		expect(r.karte.antwort.vorlesen).toMatch(/Hans Müller ist noch nicht in Lexware/);
		expect(r.karte.antwort.abschnitte[0].eintraege[0].link).toBe(`/kunden/${u.kundeA}#lexware`);
		await root`update app.kunden set lexware_id = gen_random_uuid(), lexware_stand = now() + interval '1 minute' where id = ${u.kundeA}`;
		r = await sag(chef(), 'Ist Kunde Müller in Lexware?');
		expect(r.karte.antwort.vorlesen).toMatch(/ist in Lexware und auf dem neuesten Stand/);
		const m = await sag(u.monteurA, 'Ist Lexware verbunden?');
		expect(m.karte.fehler).toMatch(/Berechtigung|Tarif/);
	});

	it('„Ist der Mailversand eingerichtet?“', async () => {
		const r = await sag(chef(), 'Ist der Mailversand eingerichtet?');
		expect(r.karte.aktion).toBe('abfrage_mailversand');
		expect(r.karte.antwort.vorlesen).toMatch(/^Kein automatischer Mailversand: Es ist noch kein Postfach eingerichtet\. Keine Mailfehler/);
	});
});
