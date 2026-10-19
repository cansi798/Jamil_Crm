import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import {
	holeAngebot,
	ladePdfDaten,
	legeAngebotAn,
	legeAngebotOhneAuftragAn,
	listeAngebote,
	neueVersion,
	ordneAngebotZu,
	setzeAngebotStatus,
	speicherePositionen
} from '../../src/lib/server/angebote';
import { POST as angebotPost } from '../../src/routes/api/angebote/+server';
import { POST as zuordnenPost } from '../../src/routes/api/angebote/[id]/zuordnen/+server';
import { actions as auftragAktionen, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** Phase 4 (Wunsch Jamil, Antwort 1): Angebote ohne Auftrag, nachträglich einem Kunden oder Auftrag zuordnen. */
describe('Angebote ohne Auftrag und Zuordnen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const voll = () => ({ sicht: { alle: true, benutzerId: u.ids.chefA }, auftragAendern: true });
	const nurEigene = () => ({ sicht: { alle: false, benutzerId: u.ids.chefA }, auftragAendern: true });
	const POS = [{ bezeichnung: 'Anfahrt', menge: 1, einheit: 'psch', einzelpreis: '45' }];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await leereAngebote(root);
		await root`update app.auftraege set status = 'anfrage' where id = ${u.auftragA}`;
	});

	it('anlegen ohne Auftrag (mit oder ohne Kunde); nur wer alle Aufträge sieht, sieht es', async () => {
		const ohne = await legeAngebotOhneAuftragAn(kA(), null);
		expect(ohne).toMatchObject({ auftragId: null, auftragNummer: null, kundeId: null, kundeName: 'Ohne Kunde', status: 'entwurf' });
		const mit = await legeAngebotOhneAuftragAn(kA(), u.kundeA);
		expect(mit).toMatchObject({ auftragId: null, kundeId: u.kundeA, kundeName: 'Hans Müller' });
		await expect(legeAngebotOhneAuftragAn(kA(), u.kundeB)).rejects.toMatchObject({ status: 404 });
		await expect(legeAngebotOhneAuftragAn(kA(), null, nurEigene())).rejects.toMatchObject({ status: 403 });
		expect((await listeAngebote(kA(), {}, voll())).map((a) => a.id).sort()).toEqual([ohne.id, mit.id].sort());
		expect(await listeAngebote(kA(), {}, nurEigene())).toEqual([]);
		await expect(holeAngebot(kA(), mit.id, nurEigene())).rejects.toMatchObject({ status: 404 });
		// Filter: nur nicht zugeordnete, je Kunde
		expect((await listeAngebote(kA(), { ohneAuftrag: true, kundeId: u.kundeA }, voll())).map((a) => a.id)).toEqual([mit.id]);
	});

	it('Status und neue Version funktionieren ohne Auftrag (keine Auftrags-Kopplung); PDF nimmt die Kundenanschrift', async () => {
		const a = await legeAngebotOhneAuftragAn(kA(), u.kundeA);
		await speicherePositionen(kA(), a.id, POS);
		const v = await setzeAngebotStatus(kA(), a.id, 'versendet');
		expect(v).toMatchObject({ status: 'versendet' });
		expect(v.hinweis).toBeUndefined();
		const n = await neueVersion(kA(), a.id);
		expect(n).toMatchObject({ auftragId: null, kundeId: u.kundeA, vorgaengerId: a.id });
		expect((await ladePdfDaten(kA(), a.id)).kunde).toMatchObject({ name: 'Hans Müller', strasse: 'Lindenweg 3', ort: 'Norderstedt' });
	});

	it('zuordnen: Kunde, dann Auftrag (Kunde des Auftrags gilt); auch versendet; versendetes am Auftrag nicht mehr umhängen', async () => {
		const a = await legeAngebotOhneAuftragAn(kA(), null);
		expect(await ordneAngebotZu(kA(), a.id, { kundeId: u.kundeA })).toMatchObject({ kundeId: u.kundeA, auftragId: null });
		await speicherePositionen(kA(), a.id, POS);
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		const z = await ordneAngebotZu(kA(), a.id, { auftragId: u.auftragA });
		expect(z).toMatchObject({ auftragId: u.auftragA, kundeId: u.kundeA, status: 'versendet' });
		// Kopplung wie beim Versenden: Auftrag „Anfrage“ → „Angebot“
		expect((await root`select status from app.auftraege where id = ${u.auftragA}`)[0].status).toBe('angebot');
		const anderer = await u.neuerAuftrag('anfrage', 'Anderer');
		await expect(ordneAngebotZu(kA(), a.id, { auftragId: anderer })).rejects.toMatchObject({ status: 409 });
		// Entwurf am Auftrag darf umziehen
		const e = await legeAngebotAn(kA(), u.auftragA);
		expect(await ordneAngebotZu(kA(), e.id, { auftragId: anderer })).toMatchObject({ auftragId: anderer });
	});

	it('zuordnen prüft: genau eins von Kunde/Auftrag, fremd/unbekannt → 404, unsichtbarer Auftrag → 404', async () => {
		const a = await legeAngebotOhneAuftragAn(kA(), null);
		await expect(ordneAngebotZu(kA(), a.id, {})).rejects.toMatchObject({ status: 400 });
		await expect(ordneAngebotZu(kA(), a.id, { kundeId: u.kundeA, auftragId: u.auftragA })).rejects.toMatchObject({ status: 400 });
		await expect(ordneAngebotZu(kA(), a.id, { auftragId: u.auftragB })).rejects.toMatchObject({ status: 404 });
		await expect(ordneAngebotZu(kA(), a.id, { kundeId: u.kundeB })).rejects.toMatchObject({ status: 404 });
		await expect(ordneAngebotZu(kA(), a.id, { kundeId: UNBEKANNT })).rejects.toMatchObject({ status: 404 });
		await expect(ordneAngebotZu(kA(), UNBEKANNT, { kundeId: u.kundeA })).rejects.toMatchObject({ status: 404 });
	});

	it('API: POST /api/angebote ohne Auftrag (ohneAuftrag/kundeId), POST …/zuordnen; ohne Preise-Recht 403', async () => {
		const post = async (n: Nutzer, k: unknown) => antwort(await angebotPost({ locals: { nutzer: n }, request: jsonAnfrage('POST', k) } as never));
		const r = await post(u.bueroA, { ohneAuftrag: true, kundeId: u.kundeA });
		expect(r.status).toBe(201);
		expect(r.koerper).toMatchObject({ auftragId: null, kundeId: u.kundeA });
		expect((await post(u.bueroA, { ohneAuftrag: true })).koerper).toMatchObject({ kundeId: null });
		expect((await post(u.ohnePreiseA, { ohneAuftrag: true })).status).toBe(403);
		const z = await antwort(
			await zuordnenPost({ locals: { nutzer: u.bueroA }, params: { id: r.koerper.id }, request: jsonAnfrage('POST', { auftragId: u.auftragA }) } as never)
		);
		expect(z.status).toBe(200);
		expect(z.koerper.auftragId).toBe(u.auftragA);
	});

	it('Auftragsseite: zuordenbare Angebote (ohne Auftrag; Kunde des Auftrags oder ohne Kunde) und Aktion „angebotZuordnen“', async () => {
		const passend = await legeAngebotOhneAuftragAn(kA(), u.kundeA);
		const ohneKunde = await legeAngebotOhneAuftragAn(kA(), null);
		const [{ id: andererKunde }] = await root`
			insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Anders') returning id`;
		await legeAngebotOhneAuftragAn(kA(), andererKunde);
		const d = (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id: u.auftragA } } as never)) as any;
		expect(d.zuordenbareAngebote.map((a: any) => a.id).sort()).toEqual([passend.id, ohneKunde.id].sort());
		const body = new URLSearchParams({ angebotId: passend.id });
		expect(
			await auftragAktionen.angebotZuordnen({
				locals: { nutzer: u.chefA },
				params: { id: u.auftragA },
				request: new Request('http://localhost/x', { method: 'POST', body })
			} as never)
		).toBeUndefined();
		expect((await holeAngebot(kA(), passend.id)).auftragId).toBe(u.auftragA);
	});
});
