import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frischeTestDb } from './setup';

/** Migration 126: Indizes für Verläufe je Auftrag (Änderungsprotokoll) und Portal-Ereignisse je Link. */
describe('Indizes (Migration 126)', () => {
	let root: postgres.Sql;
	beforeAll(async () => {
		const db = await frischeTestDb();
		root = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
	});
	afterAll(async () => {
		await root?.end();
	});

	it('beide Indizes existieren', async () => {
		const z = await root`select indexname from pg_indexes where schemaname = 'app' and indexname in ('aenderungen_auftrag_json_idx', 'portal_ereignisse_link_idx') order by 1`;
		expect(z.map((x) => x.indexname)).toEqual(['aenderungen_auftrag_json_idx', 'portal_ereignisse_link_idx']);
	});

	it('Verlauf je Auftrag nutzt den Index (Abfrage wie in auftrag-links/kundenportal)', async () => {
		await root.begin(async (tx) => {
			await tx`set local enable_seqscan = off`;
			const plan = await tx.unsafe(`explain select id from app.aenderungen a
				where a.betrieb_id = '00000000-0000-4000-8000-000000000001' and a.tabelle = 'auftrag_links'
					and coalesce(a.nachher ->> 'auftrag_id', a.vorher ->> 'auftrag_id') = '00000000-0000-4000-8000-000000000002'
				order by a.id desc limit 50`);
			expect(plan.map((p) => p['QUERY PLAN']).join('\n')).toContain('aenderungen_auftrag_json_idx');
			const plan2 = await tx.unsafe(`explain select count(*) from app.portal_ereignisse e
				where e.link_id = '00000000-0000-4000-8000-000000000003' and e.betrieb_id = '00000000-0000-4000-8000-000000000001' and e.art = 'anmeldung_fehler'`);
			expect(plan2.map((p) => p['QUERY PLAN']).join('\n')).toContain('portal_ereignisse_link_idx');
		});
	});
});
