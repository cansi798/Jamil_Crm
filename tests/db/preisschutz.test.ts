import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { enthaeltPreisfeld } from '../../src/lib/server/preisschutz';
import { legePositionAn, aenderePosition } from '../../src/lib/server/katalog';
import { legeAngebotAn, speicherePositionen } from '../../src/lib/server/angebote';
import { GET as katalogGet } from '../../src/routes/api/katalog/+server';
import { GET as katalogEinzelGet } from '../../src/routes/api/katalog/[id]/+server';
import { GET as angeboteGet } from '../../src/routes/api/angebote/+server';
import { GET as angebotGet } from '../../src/routes/api/angebote/[id]/+server';
import { GET as pdfGet } from '../../src/routes/api/angebote/[id]/pdf/+server';
import { GET as auftragGet } from '../../src/routes/api/auftraege/[id]/+server';
import { GET as protokollGet } from '../../src/routes/api/protokoll/+server';
import { load as auftragSeite } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { load as katalogSeite } from '../../src/routes/(app)/katalog/+page.server';
import { antwort, baueUmgebung, type Umgebung } from './hilfe-1c';

describe('Preisschutz: Rollen ohne „Preise sehen“ bekommen nirgends Preise', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let angebotId: string;
	let katalogId: string;

	const url = (pfad: string, params: Record<string, string> = {}) => {
		const x = new URL(`http://localhost${pfad}`);
		for (const [k, v] of Object.entries(params)) x.searchParams.set(k, v);
		return x;
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		const kA = { betriebId: u.betriebA, benutzerId: u.ids.chefA };
		katalogId = (await legePositionAn(kA, { bezeichnung: 'Fliesen verlegen', einheit: 'm²', lohn: '38', material: '7,5' })).id;
		await aenderePosition(kA, katalogId, { lohn: '40' }); // Preisänderung steht im Protokoll
		const a = await legeAngebotAn(kA, u.auftragA);
		await speicherePositionen(kA, a.id, [{ katalogPositionId: katalogId, menge: 10 }]);
		angebotId = a.id;
		// Der Monteur hat einen Einsatz im Auftrag → „eigener Auftrag“
		await root`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, now(), now() + interval '2 hours')`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Review Focus 4: Monteur → Katalog, Angebote, Angebot, PDF 403; eigener Auftrag 200 ohne Preisfelder', async () => {
		const n = u.monteurA;
		expect((await antwort(await katalogGet({ locals: { nutzer: n }, url: url('/api/katalog') } as never))).status).toBe(403);
		expect((await antwort(await katalogEinzelGet({ locals: { nutzer: n }, params: { id: katalogId } } as never))).status).toBe(403);
		expect((await antwort(await angeboteGet({ locals: { nutzer: n }, url: url('/api/angebote', { auftrag: u.auftragA }) } as never))).status).toBe(403);
		expect((await antwort(await angebotGet({ locals: { nutzer: n }, params: { id: angebotId } } as never))).status).toBe(403);
		expect((await pdfGet({ locals: { nutzer: n }, params: { id: angebotId } } as never)).status).toBe(403);
		const auftrag = await antwort(await auftragGet({ locals: { nutzer: n }, params: { id: u.auftragA } } as never));
		expect(auftrag.status).toBe(200);
		expect(enthaeltPreisfeld(auftrag.koerper)).toBe(false);
		// Seite des Auftrags: kein Bereich „Angebote“, keine Preise
		const seite = (await auftragSeite({ locals: { nutzer: n }, params: { id: u.auftragA }, url: url(`/auftraege/${u.auftragA}`) } as never)) as any;
		expect(seite.angebote ?? null).toBeNull();
		expect(enthaeltPreisfeld(seite)).toBe(false);
		expect(JSON.stringify(seite)).not.toMatch(/€|Cent/);
	});

	it('„Büro ohne Preise“: Katalog ohne Preisfelder (API, Seite, Protokoll), Angebote und PDF 403', async () => {
		const n = u.ohnePreiseA;
		const k = await antwort(await katalogGet({ locals: { nutzer: n }, url: url('/api/katalog') } as never));
		expect(k.status).toBe(200);
		expect(k.koerper).toHaveLength(1);
		expect(enthaeltPreisfeld(k.koerper)).toBe(false);
		const ke = await antwort(await katalogEinzelGet({ locals: { nutzer: n }, params: { id: katalogId } } as never));
		expect(enthaeltPreisfeld(ke.koerper)).toBe(false);
		const seite = await katalogSeite({ locals: { nutzer: n }, url: url('/katalog') } as never);
		expect(enthaeltPreisfeld(seite)).toBe(false);
		expect((await antwort(await angeboteGet({ locals: { nutzer: n }, url: url('/api/angebote') } as never))).status).toBe(403);
		expect((await antwort(await angebotGet({ locals: { nutzer: n }, params: { id: angebotId } } as never))).status).toBe(403);
		expect((await pdfGet({ locals: { nutzer: n }, params: { id: angebotId } } as never)).status).toBe(403);
		// Änderungsprotokoll der Katalogposition: lesbar, aber ohne Preisspalten
		const p = await antwort(
			await protokollGet({ locals: { nutzer: n }, url: url('/api/protokoll', { tabelle: 'katalog_positionen', datensatz: katalogId }) } as never)
		);
		expect(p.status).toBe(200);
		expect(p.koerper.eintraege.length).toBeGreaterThanOrEqual(2);
		expect(JSON.stringify(p.koerper)).not.toMatch(/lohn_cent|material_cent|einzelpreis_cent/);
		// Protokoll der Angebotspositionen ebenso (Recht angebote.bearbeiten genügt fürs Protokoll, Preise nicht)
		const [pos] = await root`select id from app.angebot_positionen where angebot_id = ${angebotId}`;
		const pp = await antwort(
			await protokollGet({ locals: { nutzer: n }, url: url('/api/protokoll', { tabelle: 'angebot_positionen', datensatz: pos.id }) } as never)
		);
		expect(pp.status).toBe(200);
		expect(JSON.stringify(pp.koerper)).not.toMatch(/einzelpreis_cent/);
		// Mit preise.sehen stehen die Preise im Protokoll
		const chef = await antwort(
			await protokollGet({ locals: { nutzer: u.chefA }, url: url('/api/protokoll', { tabelle: 'katalog_positionen', datensatz: katalogId }) } as never)
		);
		expect(JSON.stringify(chef.koerper)).toMatch(/lohn_cent/);
	});

	it('Chef/Büro: Auftragsseite zeigt Angebote mit Beträgen; „Nur Angebote“ ohne preise.sehen sieht keine Beträge', async () => {
		const chef = (await auftragSeite({ locals: { nutzer: u.bueroA }, params: { id: u.auftragA }, url: url(`/auftraege/${u.auftragA}`) } as never)) as any;
		expect(chef.angebote).toHaveLength(1);
		expect(chef.angebote[0]).toMatchObject({ id: angebotId, status: 'entwurf', nettoCent: 47500, bruttoCent: 56525 });
		expect(chef.darfAngebote).toBe(true);
		const ohne = (await auftragSeite({ locals: { nutzer: u.nurAngeboteA }, params: { id: u.auftragA }, url: url(`/auftraege/${u.auftragA}`) } as never)) as any;
		expect(enthaeltPreisfeld(ohne)).toBe(false);
		expect(ohne.darfAngebote).toBe(false);
	});
});
