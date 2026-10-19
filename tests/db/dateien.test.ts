import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { speichereDatei, liesDatei, loescheDatei, dateienFuerAuftrag } from '../../src/lib/server/dateien';

describe('Dateien – Dienst und API', () => {
	let u: Umgebung;
	let root: postgres.Sql;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.dateien`;
	});

	it('Dateien-Tabelle existiert mit korrekten Spalten', async () => {
		const spalten = await root`
			select column_name from information_schema.columns
			where table_schema = 'app' and table_name = 'dateien'
			order by ordinal_position`;
		const namen = (spalten as unknown as { column_name: string }[]).map((s) => s.column_name);
		expect(namen).toContain('id');
		expect(namen).toContain('betrieb_id');
		expect(namen).toContain('auftrag_id');
		expect(namen).toContain('name');
		expect(namen).toContain('typ');
		expect(namen).toContain('groesse');
		expect(namen).toContain('inhalt');
		expect(namen).toContain('beschreibung');
		expect(namen).toContain('angelegt');
		expect(namen).toContain('geaendert');
	});

	it('legt eine Datei an und liest sie (RLS)', async () => {
		const [z] = await root`
			insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung)
			values (${u.betriebA}, ${u.auftragA}, 'foto.jpg', 'image/jpeg', 1024, ${Buffer.from('testdaten')}, 'Foto von der Baustelle')
			returning id`;
		expect(z.id).toBeDefined();
		const [gelesen] = await root`select * from app.dateien where id = ${z.id}`;
		expect(gelesen.name).toBe('foto.jpg');
		expect(gelesen.typ).toBe('image/jpeg');
		expect(gelesen.groesse).toBe(1024);
		expect(gelesen.beschreibung).toBe('Foto von der Baustelle');
	});

	it('Dateien sind nach Betrieb getrennt (RLS)', async () => {
		await root`
			insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt)
			values (${u.betriebA}, ${u.auftragA}, 'a.jpg', 'image/jpeg', 100, ${Buffer.from('a')})`;
		// Betrieb B sieht nichts über crm_app
		const b = await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select * from app.dateien`);
		expect(b).toHaveLength(0);
	});

	it('lehnt zu große Dateien ab (check constraint)', async () => {
		await expect(
			root`insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt)
				values (${u.betriebA}, ${u.auftragA}, 'gross.jpg', 'image/jpeg', 10485761, ${Buffer.from('x')})`
		).rejects.toThrow();
	});

	it('Dateien werden mit Auftrag gelöscht (cascade)', async () => {
		const auftragId = await u.neuerAuftrag();
		await root`
			insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt)
			values (${u.betriebA}, ${auftragId}, 'test.jpg', 'image/jpeg', 100, ${Buffer.from('x')})`;
		await root`delete from app.auftraege where id = ${auftragId}`;
		const rest = await root`select * from app.dateien where auftrag_id = ${auftragId}`;
		expect(rest).toHaveLength(0);
	});

	// --- Dienst-Tests ---

	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	it('speichereDatei: speichert eine Datei und gibt Metadaten zurück', async () => {
		const datei = await speichereDatei(kA(), u.auftragA, 'foto.jpg', 'image/jpeg', 9, Buffer.from('testdaten'), 'Beschreibung');
		expect(datei.name).toBe('foto.jpg');
		expect(datei.typ).toBe('image/jpeg');
		expect(datei.groesse).toBe(9);
		expect(datei.beschreibung).toBe('Beschreibung');
		expect(datei.id).toBeDefined();
	});

	it('speichereDatei: lehnt zu große Dateien ab', async () => {
		await expect(speichereDatei(kA(), u.auftragA, 'gross.jpg', 'image/jpeg', 10485761, Buffer.from('x')))
			.rejects.toThrow('Die Datei ist zu groß');
	});

	it('speichereDatei: lehnt unerlaubte MIME-Typen ab', async () => {
		await expect(speichereDatei(kA(), u.auftragA, 'virus.exe', 'application/octet-stream', 100, Buffer.from('x')))
			.rejects.toThrow('Dieser Dateityp ist nicht erlaubt');
	});

	it('liesDatei: liest eine Datei mit Inhalt', async () => {
		const datei = await speichereDatei(kA(), u.auftragA, 'test.png', 'image/png', 4, Buffer.from('abcd'));
		const gelesen = await liesDatei(kA(), datei.id);
		expect(gelesen).not.toBeNull();
		expect(gelesen!.name).toBe('test.png');
		expect(gelesen!.inhalt).toBeDefined();
	});

	it('loescheDatei: löscht eine Datei', async () => {
		const datei = await speichereDatei(kA(), u.auftragA, 'weg.jpg', 'image/jpeg', 3, Buffer.from('abc'));
		await loescheDatei(kA(), datei.id);
		const gelesen = await liesDatei(kA(), datei.id);
		expect(gelesen).toBeNull();
	});

	it('dateienFuerAuftrag: gibt alle Dateien eines Auftrags zurück', async () => {
		await speichereDatei(kA(), u.auftragA, 'a.jpg', 'image/jpeg', 1, Buffer.from('a'));
		await speichereDatei(kA(), u.auftragA, 'b.png', 'image/png', 1, Buffer.from('b'));
		const liste = await dateienFuerAuftrag(kA(), u.auftragA);
		expect(liste).toHaveLength(2);
		expect(liste.map((d) => d.name).sort()).toEqual(['a.jpg', 'b.png']);
	});
});