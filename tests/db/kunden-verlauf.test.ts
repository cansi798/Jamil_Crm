import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { legeAuftragAn } from '../../src/lib/server/auftraege';
import { legeEinsatzAn } from '../../src/lib/server/plantafel';
import { legeAngebotAn, legeAngebotOhneAuftragAn } from '../../src/lib/server/angebote';
import { legeKundenNotizAn, speichereKundenDatei } from '../../src/lib/server/kundenakte';
import { kundenVerlauf } from '../../src/lib/server/kunden-verlauf';
import { actions as kundenAktionen, load as kundenLoad } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Phase 4 (Wunsch Jamil): Verlauf eines Kunden – Aufträge, Angebote, Termine, Notizen, Dokumente in einer Zeitleiste. */
describe('Kunden-Verlauf', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let auftrag: string, fremdAuftrag: string, angebotMit: string, angebotOhne: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		auftrag = (await legeAuftragAn(kA(), { titel: 'Bad Müller', kundeId: u.kundeA })).id;
		const [{ id: kundeX }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Fremd') returning id`;
		fremdAuftrag = (await legeAuftragAn(kA(), { titel: 'Anderer Kunde', kundeId: kundeX })).id;
		const beginn = new Date(Date.now() + 2 * 86_400_000);
		await legeEinsatzAn(kA(), {
			auftragId: auftrag,
			benutzerId: u.ids.monteurA,
			beginn: beginn.toISOString(),
			ende: new Date(beginn.getTime() + 3_600_000).toISOString(),
			art: 'besichtigung',
			notiz: 'Aufmaß'
		});
		angebotMit = (await legeAngebotAn(kA(), auftrag)).id;
		angebotOhne = (await legeAngebotOhneAuftragAn(kA(), u.kundeA)).id;
		await legeKundenNotizAn(kA(), u.kundeA, 'Zahlt pünktlich');
		await speichereKundenDatei(kA(), u.kundeA, { name: 'Plan.pdf', typ: 'application/pdf', inhalt: PDF });
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Chef: alle Arten, nur dieser Kunde, neueste/geplante zuerst; Angebote mit und ohne Auftrag', async () => {
		const v = await kundenVerlauf(kA(), u.chefA, u.kundeA);
		const arten = new Set(v.map((e) => e.typ));
		expect([...arten].sort()).toEqual(['angebot', 'auftrag', 'dokument', 'notiz', 'termin']);
		expect(v.some((e) => e.link === `/auftraege/${fremdAuftrag}`)).toBe(false);
		expect(v.filter((e) => e.typ === 'angebot').map((e) => e.link).sort()).toEqual([`/angebote/${angebotMit}`, `/angebote/${angebotOhne}`].sort());
		const termin = v.find((e) => e.typ === 'termin')!;
		expect(termin.titel).toMatch(/^Besichtigung/);
		expect(termin.link).toBe(`/auftraege/${auftrag}`);
		// sortiert absteigend nach Zeitpunkt (der geplante Termin in zwei Tagen steht oben)
		const zeiten = v.map((e) => e.zeit);
		expect(zeiten).toEqual([...zeiten].sort().reverse());
		expect(v[0].typ).toBe('termin');
	});

	it('Monteur: keine Angebote (keine Preise), nur sichtbare Aufträge/Termine; Notizen und Dokumente sieht er (Kunden ansehen)', async () => {
		const v = await kundenVerlauf(kA(), u.monteurA, u.kundeA);
		expect(v.some((e) => e.typ === 'angebot')).toBe(false);
		// Er hat einen Termin im Auftrag → sieht Auftrag und Termin
		expect(v.filter((e) => e.typ === 'auftrag').map((e) => e.link)).toEqual([`/auftraege/${auftrag}`]);
		expect(v.some((e) => e.typ === 'notiz')).toBe(true);
		expect(v.some((e) => e.typ === 'dokument')).toBe(true);
	});

	it('Kundenseite lädt den Verlauf; „+ Angebot ohne Auftrag“ legt ein Angebot für den Kunden an (mit Rechten)', async () => {
		const d = (await kundenLoad({ locals: { nutzer: u.chefA }, params: { id: u.kundeA } } as never)) as any;
		expect(d.zeitleiste.length).toBeGreaterThanOrEqual(6);
		expect(d.darfAngebotAnlegen).toBe(true);
		let ort = '';
		try {
			await kundenAktionen.angebotErstellen({ locals: { nutzer: u.chefA }, params: { id: u.kundeA }, request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams() }) } as never);
		} catch (e: any) {
			ort = e.location;
		}
		expect(ort).toMatch(/^\/angebote\/[0-9a-f-]{36}$/);
		const [an] = await root`select kunde_id, auftrag_id from app.angebote where id = ${ort.split("/").pop()!}`;
		expect(an).toEqual({ kunde_id: u.kundeA, auftrag_id: null });
		const m = (await kundenLoad({ locals: { nutzer: u.monteurA }, params: { id: u.kundeA } } as never)) as any;
		expect(m.darfAngebotAnlegen).toBe(false);
		const verboten = (await kundenAktionen.angebotErstellen({
			locals: { nutzer: u.monteurA },
			params: { id: u.kundeA },
			request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams() })
		} as never)) as any;
		expect(verboten.status).toBe(403);
	});
});
