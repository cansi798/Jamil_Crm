import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

describe('Baustellen-Protokolle – Tabelle und RLS', () => {
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
		await root`delete from app.baustellen_protokolle`;
	});

	it('Protokoll-Tabelle existiert mit korrekten Spalten', async () => {
		const spalten = await root`
			select column_name from information_schema.columns
			where table_schema = 'app' and table_name = 'baustellen_protokolle'
			order by ordinal_position`;
		const namen = spalten.map((s: { column_name: string }) => s.column_name);
		expect(namen).toContain('id');
		expect(namen).toContain('betrieb_id');
		expect(namen).toContain('auftrag_id');
		expect(namen).toContain('typ');
		expect(namen).toContain('inhalt');
		expect(namen).toContain('unterschrift');
		expect(namen).toContain('pdf');
		expect(namen).toContain('angelegt');
		expect(namen).toContain('geaendert');
		expect(namen).toContain('von_benutzer_id');
	});

	it('legt ein Protokoll an und liest es', async () => {
		const [z] = await root`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ, inhalt, von_benutzer_id)
			values (${u.betriebA}, ${u.auftragA}, 'abnahme', ${JSON.stringify({ bemerkung: 'Alles fertig' })}, ${u.ids.chefA})
			returning id`;
		expect(z.id).toBeDefined();
		const [gelesen] = await root`select * from app.baustellen_protokolle where id = ${z.id}`;
		expect(gelesen.typ).toBe('abnahme');
		const inhalt = typeof gelesen.inhalt === 'string' ? JSON.parse(gelesen.inhalt) : gelesen.inhalt;
		expect(inhalt).toEqual({ bemerkung: 'Alles fertig' });
		expect(gelesen.von_benutzer_id).toBe(u.ids.chefA);
	});

	it('Protokolle sind nach Betrieb getrennt (RLS)', async () => {
		await root`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ)
			values (${u.betriebA}, ${u.auftragA}, 'abnahme')`;
		const b = await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select * from app.baustellen_protokolle`);
		expect(b).toHaveLength(0);
	});

	it('nur erlaubte Protokoll-Typen (check constraint)', async () => {
		await expect(
			root`insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ)
				values (${u.betriebA}, ${u.auftragA}, 'unbekannt')`
		).rejects.toThrow();
	});

	it('speichert eine Unterschrift (bytea)', async () => {
		const [z] = await root`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ, unterschrift)
			values (${u.betriebA}, ${u.auftragA}, 'abnahme', ${Buffer.from('PNG-DUMMY')})
			returning id`;
		const [gelesen] = await root`select unterschrift is not null as hat_unterschrift from app.baustellen_protokolle where id = ${z.id}`;
		expect(gelesen.hat_unterschrift).toBe(true);
	});

	it('speichert ein PDF (bytea)', async () => {
		const [z] = await root`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ, pdf)
			values (${u.betriebA}, ${u.auftragA}, 'abnahme', ${Buffer.from('%PDF-FAKE')})
			returning id`;
		const [gelesen] = await root`select pdf is not null as hat_pdf from app.baustellen_protokolle where id = ${z.id}`;
		expect(gelesen.hat_pdf).toBe(true);
	});

	it('Protokolle werden mit Auftrag gelöscht (cascade)', async () => {
		const auftragId = await u.neuerAuftrag();
		await root`
			insert into app.baustellen_protokolle (betrieb_id, auftrag_id, typ)
			values (${u.betriebA}, ${auftragId}, 'abnahme')`;
		await root`delete from app.auftraege where id = ${auftragId}`;
		const rest = await root`select * from app.baustellen_protokolle where auftrag_id = ${auftragId}`;
		expect(rest).toHaveLength(0);
	});
});