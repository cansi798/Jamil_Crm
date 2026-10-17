import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { POST as dateienPost, GET as dateienGet } from '../../src/routes/api/dateien/+server';
import { GET as dateiGet, DELETE as dateiDelete } from '../../src/routes/api/dateien/[id]/+server';

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
		const namen = spalten.map((s: { column_name: string }) => s.column_name);
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
});