import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { legeAngebotAn, neueVersion, setzeAngebotStatus, speicherePositionen } from '../../src/lib/server/angebote';
import { legePositionAn, aenderePosition } from '../../src/lib/server/katalog';
import { GET as listeGet, POST as angebotPost } from '../../src/routes/api/angebote/+server';
import {
	DELETE as angebotDelete,
	GET as angebotGet,
	PATCH as angebotPatch
} from '../../src/routes/api/angebote/[id]/+server';
import { PUT as positionenPut } from '../../src/routes/api/angebote/[id]/positionen/+server';
import { POST as statusPost } from '../../src/routes/api/angebote/[id]/status/+server';
import { POST as versionPost } from '../../src/routes/api/angebote/[id]/neue-version/+server';
import { DELETE as auftragDelete } from '../../src/routes/api/auftraege/[id]/+server';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, UNBEKANNT, type Umgebung } from './hilfe-1c';

const JAHR = berlinTag(new Date()).slice(0, 4);

describe('Angebote – Dienst und API', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	const liste = async (nutzer: Nutzer | null, params: Record<string, string> = {}) => {
		const url = new URL('http://localhost/api/angebote');
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		return antwort(await listeGet({ locals: { nutzer }, url } as never));
	};
	const anlegen = async (nutzer: Nutzer | null, auftragId: unknown) =>
		antwort(await angebotPost({ locals: { nutzer }, request: jsonAnfrage('POST', { auftragId }) } as never));
	const get = async (nutzer: Nutzer | null, id: string) => antwort(await angebotGet({ locals: { nutzer }, params: { id } } as never));
	const patch = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await angebotPatch({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PATCH', koerper) } as never));
	const del = async (nutzer: Nutzer | null, id: string) => antwort(await angebotDelete({ locals: { nutzer }, params: { id } } as never));
	const positionen = async (nutzer: Nutzer | null, id: string, liste: unknown) =>
		antwort(await positionenPut({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PUT', { positionen: liste }) } as never));
	const status = async (nutzer: Nutzer | null, id: string, nach: unknown) =>
		antwort(await statusPost({ locals: { nutzer }, params: { id }, request: jsonAnfrage('POST', { status: nach }) } as never));
	const version = async (nutzer: Nutzer | null, id: string) => antwort(await versionPost({ locals: { nutzer }, params: { id } } as never));
	const auftragStatus = async (id: string) => (await root`select status from app.auftraege where id = ${id}`)[0].status;

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
		await root`delete from app.angebot_nummern`;
		await root`delete from app.katalog_positionen`;
		await root`update app.auftraege set status = 'anfrage' where id = ${u.auftragA}`;
	});

	it('anlegen: Nummer, Entwurf, Datum heute (Berlin), gültig 30 Tage, Standardtexte, MwSt 19; Kunde und Auftrag', async () => {
		const r = await anlegen(u.chefA, u.auftragA);
		expect(r.status).toBe(201);
		const heute = berlinTag(new Date());
		expect(r.koerper).toMatchObject({
			nummer: `AN-${JAHR}-0001`,
			status: 'entwurf',
			auftragId: u.auftragA,
			kundeName: 'Hans Müller',
			datum: heute,
			gueltigBis: tagPlus(heute, 30),
			mwstSatz: 19,
			einleitung: 'Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:',
			schluss: 'Wir freuen uns auf Ihren Auftrag.',
			positionen: [],
			nettoCent: 0,
			mwstCent: 0,
			bruttoCent: 0,
			vorgaengerId: null,
			warnungen: []
		});
		expect(r.koerper.auftragNummer).toMatch(/^A-\d{4}-\d{4}$/);
		expect((await anlegen(u.chefA, UNBEKANNT)).status).toBe(400);
		expect((await anlegen(u.chefA, u.auftragB)).status).toBe(400);
		expect((await anlegen(u.chefA, 'kaputt')).status).toBe(400);
		const l = await liste(u.bueroA, { auftrag: u.auftragA });
		expect(l.koerper).toHaveLength(1);
		expect(l.koerper[0]).toMatchObject({ nummer: `AN-${JAHR}-0001`, bruttoCent: 0 });
		expect((await liste(u.chefA, { auftrag: 'x' })).status).toBe(400);
	});

	it('Review Focus 2: 3 × 33,33 € → Netto 99,99, MwSt 19,00, Brutto 118,99; MwSt 7 und 0', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		const r = await positionen(u.chefA, a.id, [{ bezeichnung: 'Fliesen verlegen', einheit: 'm²', menge: '3', einzelpreis: '33,33' }]);
		expect(r.status).toBe(200);
		expect(r.koerper).toMatchObject({ nettoCent: 9999, mwstCent: 1900, bruttoCent: 11899 });
		expect(r.koerper.positionen[0]).toMatchObject({ pos: 1, menge: 3, einzelpreisCent: 3333, summeCent: 9999, katalogPositionId: null });
		const p7 = await patch(u.chefA, a.id, { mwstSatz: 7 });
		expect(p7.koerper).toMatchObject({ mwstSatz: 7, nettoCent: 9999, mwstCent: 700, bruttoCent: 10699 });
		expect((await patch(u.chefA, a.id, { mwstSatz: 0 })).koerper).toMatchObject({ mwstCent: 0, bruttoCent: 9999 });
		expect((await patch(u.chefA, a.id, { mwstSatz: 16 })).status).toBe(400);
	});

	it('Review Focus 1: Menge „2,5“ gelesen; 0, negativ, Unsinn → 400; höchstens 200 Positionen', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		const r = await positionen(u.chefA, a.id, [{ bezeichnung: 'Silikon', einheit: 'lfm', menge: '2,5', einzelpreis: '49,99' }]);
		expect(r.koerper.positionen[0]).toMatchObject({ menge: 2.5, summeCent: 12498 });
		for (const menge of ['0', '-1', 0, 'zwei', '', '1,0001']) {
			const f = await positionen(u.chefA, a.id, [{ bezeichnung: 'x', einheit: 'Stk', menge, einzelpreis: '1' }]);
			expect(f.status, String(menge)).toBe(400);
			expect(f.koerper.fehler).toMatch(/Position 1/);
		}
		expect((await positionen(u.chefA, a.id, [{ bezeichnung: 'x', einheit: 'Stk', menge: 1, einzelpreis: '-1' }])).status).toBe(400);
		expect((await positionen(u.chefA, a.id, [{ bezeichnung: '', einheit: 'Stk', menge: 1 }])).status).toBe(400);
		expect((await positionen(u.chefA, a.id, [{ bezeichnung: 'x', einheit: 'Eimer', menge: 1 }])).status).toBe(400);
		expect((await positionen(u.chefA, a.id, 'keine Liste')).status).toBe(400);
		const viele = Array.from({ length: 201 }, (_, i) => ({ bezeichnung: `Pos ${i}`, einheit: 'Stk', menge: 1, einzelpreis: 1 }));
		const f = await positionen(u.chefA, a.id, viele);
		expect(f.status).toBe(400);
		expect(f.koerper.fehler).toContain('200');
		expect((await positionen(u.chefA, a.id, viele.slice(0, 200))).koerper.positionen).toHaveLength(200);
		// Fehler lässt die bisherigen Positionen stehen
		expect((await get(u.chefA, a.id)).koerper.positionen).toHaveLength(200);
	});

	it('Katalogposition: Bezeichnung/Einheit/Preis werden kopiert und bleiben nach Katalogänderung gleich; Überschreiben möglich', async () => {
		const kat = await legePositionAn(kA(), { bezeichnung: 'Bodenfliesen verlegen', einheit: 'm²', lohn: '38,00', material: '7,50', beschreibung: 'Dünnbett' });
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		const r = await positionen(u.chefA, a.id, [
			{ katalogPositionId: kat.id, menge: '12,5' },
			{ katalogPositionId: kat.id, menge: 1, bezeichnung: 'Sockel', einzelpreis: '10' },
			{ bezeichnung: 'Anfahrt', einheit: 'psch', menge: 1, einzelpreis: '45,00' }
		]);
		expect(r.status).toBe(200);
		expect(r.koerper.positionen.map((p: any) => [p.pos, p.bezeichnung, p.einheit, p.einzelpreisCent, p.katalogPositionId])).toEqual([
			[1, 'Bodenfliesen verlegen', 'm²', 4550, kat.id],
			[2, 'Sockel', 'm²', 1000, kat.id],
			[3, 'Anfahrt', 'psch', 4500, null]
		]);
		expect(r.koerper.positionen[0]).toMatchObject({ beschreibung: 'Dünnbett', summeCent: 56875 });
		await aenderePosition(kA(), kat.id, { lohn: '99,00' });
		expect((await get(u.chefA, a.id)).koerper.positionen[0].einzelpreisCent).toBe(4550);
		// fremde oder unbekannte Katalogposition → 400
		expect((await positionen(u.chefA, a.id, [{ katalogPositionId: UNBEKANNT, menge: 1 }])).status).toBe(400);
		// Katalogposition gelöscht → Angebot bleibt, Verweis wird leer
		await root`delete from app.katalog_positionen where id = ${kat.id}`;
		const nach = (await get(u.chefA, a.id)).koerper;
		expect(nach.positionen[0]).toMatchObject({ katalogPositionId: null, einzelpreisCent: 4550 });
	});

	it('Warnung preis_fehlt bei einer Position mit 0 €', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		const r = await positionen(u.chefA, a.id, [
			{ bezeichnung: 'Gratis', einheit: 'Stk', menge: 1 },
			{ bezeichnung: 'Teuer', einheit: 'Stk', menge: 1, einzelpreis: 5 }
		]);
		expect(r.koerper.warnungen).toEqual(['preis_fehlt']);
		const ok = await positionen(u.chefA, a.id, [{ bezeichnung: 'Teuer', einheit: 'Stk', menge: 1, einzelpreis: 5 }]);
		expect(ok.koerper.warnungen).toEqual([]);
	});

	it('Status: entwurf→angenommen 409; versendet setzt Auftrag anfrage→angebot; angenommen setzt angebot→beauftragt', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		expect(await status(u.chefA, a.id, 'angenommen')).toMatchObject({ status: 409, koerper: { fehler: 'Statuswechsel nicht erlaubt' } });
		expect((await status(u.chefA, a.id, 'quatsch')).status).toBe(400);
		// leeres Angebot kann nicht versendet werden
		expect((await status(u.chefA, a.id, 'versendet')).status).toBe(409);
		await positionen(u.chefA, a.id, [{ bezeichnung: 'x', einheit: 'Stk', menge: 1, einzelpreis: 10 }]);
		const v = await status(u.chefA, a.id, 'versendet');
		expect(v).toMatchObject({ status: 200, koerper: { status: 'versendet' } });
		expect(await auftragStatus(u.auftragA)).toBe('angebot');
		const an = await status(u.chefA, a.id, 'angenommen');
		expect(an.koerper.status).toBe('angenommen');
		expect(await auftragStatus(u.auftragA)).toBe('beauftragt');
		expect((await status(u.chefA, a.id, 'abgelehnt')).status).toBe(409);
	});

	it('Statuskopplung nur aus anfrage bzw. angebot: Auftrag in_arbeit bleibt; versendet → entwurf ändert den Auftrag nicht', async () => {
		const auftrag = await u.neuerAuftrag('in_arbeit', 'Nachtrag');
		const a = await legeAngebotAn(kA(), auftrag);
		await speicherePositionen(kA(), a.id, [{ bezeichnung: 'x', einheit: 'Stk', menge: 1, einzelpreis: 1 }]);
		await setzeAngebotStatus(kA(), a.id, 'versendet');
		expect(await auftragStatus(auftrag)).toBe('in_arbeit');
		await setzeAngebotStatus(kA(), a.id, 'angenommen');
		expect(await auftragStatus(auftrag)).toBe('in_arbeit');
		// Auftrag schon „Angebot“: versendet lässt ihn stehen, abgelehnt auch
		const auftrag2 = await u.neuerAuftrag('angebot', 'Zweites');
		const b = await legeAngebotAn(kA(), auftrag2);
		await speicherePositionen(kA(), b.id, [{ bezeichnung: 'x', einheit: 'Stk', menge: 1, einzelpreis: 1 }]);
		await setzeAngebotStatus(kA(), b.id, 'versendet');
		expect(await auftragStatus(auftrag2)).toBe('angebot');
		const zurueck = await setzeAngebotStatus(kA(), b.id, 'entwurf');
		expect(zurueck.status).toBe('entwurf');
		await setzeAngebotStatus(kA(), b.id, 'versendet');
		await setzeAngebotStatus(kA(), b.id, 'abgelehnt');
		expect(await auftragStatus(auftrag2)).toBe('angebot');
	});

	it('versendetes Angebot: PATCH und Positionen → 409 „Angebot ist nicht mehr änderbar“; Löschen nur im Entwurf', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		await positionen(u.chefA, a.id, [{ bezeichnung: 'x', einheit: 'Stk', menge: 1, einzelpreis: 10 }]);
		await status(u.chefA, a.id, 'versendet');
		expect(await patch(u.chefA, a.id, { einleitung: 'Neu' })).toMatchObject({ status: 409, koerper: { fehler: 'Angebot ist nicht mehr änderbar' } });
		expect(await positionen(u.chefA, a.id, [])).toMatchObject({ status: 409, koerper: { fehler: 'Angebot ist nicht mehr änderbar' } });
		expect((await del(u.chefA, a.id)).status).toBe(409);
		// Auftrag mit Angeboten lässt sich nicht löschen (409, nicht 500)
		await root`update app.auftraege set status = 'anfrage' where id = ${u.auftragA}`;
		expect((await antwort(await auftragDelete({ locals: { nutzer: u.chefA }, params: { id: u.auftragA } } as never))).status).toBe(409);
		const e = (await anlegen(u.chefA, u.auftragA)).koerper;
		expect((await del(u.chefA, e.id)).status).toBe(204);
		expect((await get(u.chefA, e.id)).status).toBe(404);
	});

	it('Kopf ändern: Datum, gültig bis (≥ Datum), Texte; Länge geprüft; unbekannte Felder 400', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		const r = await patch(u.chefA, a.id, { datum: '2026-11-02', gueltigBis: '2026-12-02', einleitung: 'Hallo', schluss: '' });
		expect(r.koerper).toMatchObject({ datum: '2026-11-02', gueltigBis: '2026-12-02', einleitung: 'Hallo', schluss: null });
		expect((await patch(u.chefA, a.id, { gueltigBis: '2026-11-01' })).status).toBe(400);
		expect((await patch(u.chefA, a.id, { datum: '2026-02-30' })).status).toBe(400);
		expect((await patch(u.chefA, a.id, { einleitung: 'x'.repeat(2001) })).status).toBe(400);
		expect((await patch(u.chefA, a.id, { nummer: 'AN-1' })).status).toBe(400);
		expect((await patch(u.chefA, a.id, {})).status).toBe(400);
	});

	it('neue Version: neuer Entwurf mit vorgaengerId, Kopf und Positionen kopiert', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		await patch(u.chefA, a.id, { mwstSatz: 7, einleitung: 'Version 1' });
		await positionen(u.chefA, a.id, [
			{ bezeichnung: 'A', einheit: 'Stk', menge: 2, einzelpreis: 10 },
			{ bezeichnung: 'B', einheit: 'h', menge: '1,5', einzelpreis: 50 }
		]);
		await status(u.chefA, a.id, 'versendet');
		const v = await version(u.chefA, a.id);
		expect(v.status).toBe(201);
		expect(v.koerper).toMatchObject({
			status: 'entwurf',
			vorgaengerId: a.id,
			nummer: `AN-${JAHR}-0002`,
			mwstSatz: 7,
			einleitung: 'Version 1',
			nettoCent: 9500
		});
		expect(v.koerper.positionen.map((p: any) => p.bezeichnung)).toEqual(['A', 'B']);
		expect((await get(u.chefA, a.id)).koerper.status).toBe('versendet');
		expect((await neueVersion(kA(), v.koerper.id)).vorgaengerId).toBe(v.koerper.id);
	});

	it('Rechte: Monteur, „Nur Angebote“ ohne preise.sehen → 403; Tarif ohne Angebote 402; fremder Betrieb 404', async () => {
		const a = (await anlegen(u.chefA, u.auftragA)).koerper;
		for (const n of [u.monteurA, u.nurAngeboteA, u.ohnePreiseA]) {
			expect((await liste(n)).status).toBe(403);
			expect((await get(n, a.id)).status).toBe(403);
			expect((await anlegen(n, u.auftragA)).status).toBe(403);
			expect((await positionen(n, a.id, [])).status).toBe(403);
			expect((await status(n, a.id, 'versendet')).status).toBe(403);
			expect((await version(n, a.id)).status).toBe(403);
			expect((await del(n, a.id)).status).toBe(403);
		}
		expect((await liste(u.chefC)).status).toBe(402);
		expect((await liste(null)).status).toBe(401);
		expect((await get(u.chefB, a.id)).status).toBe(404);
		expect((await patch(u.chefB, a.id, { einleitung: 'x' })).status).toBe(404);
		expect((await positionen(u.chefB, a.id, [])).status).toBe(404);
		expect((await liste(u.chefB)).koerper).toHaveLength(0);
		expect((await get(u.chefA, 'kaputt')).status).toBe(404);
	});
});
