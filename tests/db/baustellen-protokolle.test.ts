import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import {
	legeProtokollAn,
	aktualisiereProtokoll,
	speichereUnterschrift,
	liesProtokoll,
	protokolleFuerAuftrag
} from '../../src/lib/server/baustellen-protokolle';

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
		const namen = (spalten as unknown as { column_name: string }[]).map((s) => s.column_name);
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

	// --- Dienst-Tests ---

	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	it('legeProtokollAn: legt ein Protokoll an', async () => {
		const prot = await legeProtokollAn(kA(), u.auftragA, 'abnahme', { bemerkung: 'Alles fertig' }, u.ids.chefA);
		expect(prot.typ).toBe('abnahme');
		expect(prot.inhalt).toEqual({ bemerkung: 'Alles fertig' });
		expect(prot.vonBenutzerId).toBe(u.ids.chefA);
		expect(prot.unterschriftVorhanden).toBe(false);
		expect(prot.pdfVorhanden).toBe(false);
	});

	it('legeProtokollAn: prüft Modul protokolle', async () => {
		// Betrieb C hat keinen Premium-Tarif mit protokolle-Modul
		await expect(legeProtokollAn(
			{ betriebId: u.betriebC, benutzerId: u.ids.chefC },
			u.auftragB, 'abnahme'
		)).rejects.toThrow();
	});

	it('liesProtokoll: liest ein Protokoll', async () => {
		const prot = await legeProtokollAn(kA(), u.auftragA, 'regiebericht', { text: 'Test' });
		const gelesen = await liesProtokoll(kA(), prot.id);
		expect(gelesen).not.toBeNull();
		expect(gelesen!.typ).toBe('regiebericht');
	});

	it('speichereUnterschrift: speichert eine Unterschrift', async () => {
		const prot = await legeProtokollAn(kA(), u.auftragA, 'abnahme');
		await speichereUnterschrift(kA(), prot.id, Buffer.from('PNG-DUMMY'));
		const gelesen = await liesProtokoll(kA(), prot.id);
		expect(gelesen!.unterschriftVorhanden).toBe(true);
	});

	it('speichereUnterschrift: lehnt zu große Unterschriften ab', async () => {
		const prot = await legeProtokollAn(kA(), u.auftragA, 'abnahme');
		await expect(speichereUnterschrift(kA(), prot.id, Buffer.alloc(512001)))
			.rejects.toThrow('Die Unterschrift ist zu groß');
	});

	it('aktualisiereProtokoll: aktualisiert den Inhalt', async () => {
		const prot = await legeProtokollAn(kA(), u.auftragA, 'abnahme', { alt: 'wert' });
		const aktualisiert = await aktualisiereProtokoll(kA(), prot.id, { neu: 'wert' });
		expect(aktualisiert.inhalt).toEqual({ neu: 'wert' });
	});

	it('protokolleFuerAuftrag: gibt alle Protokolle eines Auftrags zurück', async () => {
		await legeProtokollAn(kA(), u.auftragA, 'abnahme');
		await legeProtokollAn(kA(), u.auftragA, 'regiebericht');
		const liste = await protokolleFuerAuftrag(kA(), u.auftragA);
		expect(liste).toHaveLength(2);
		expect(liste.map((p) => p.typ).sort()).toEqual(['abnahme', 'regiebericht']);
	});
});