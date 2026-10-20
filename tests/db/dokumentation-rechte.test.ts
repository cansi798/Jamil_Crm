import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { speichereDatei } from '../../src/lib/server/dateien';
import { notizAnlegen } from '../../src/lib/server/notizen';
import { legeProtokollAn } from '../../src/lib/server/baustellen-protokolle';
import { GET as dateienGet, POST as dateienPost } from '../../src/routes/api/dateien/+server';
import { DELETE as dateiDelete, GET as dateiGet } from '../../src/routes/api/dateien/[id]/+server';
import { GET as notizenGet, POST as notizenPost } from '../../src/routes/api/notizen/+server';
import { DELETE as notizDelete, PUT as notizPut } from '../../src/routes/api/notizen/[id]/+server';
import { GET as protokolleGet, POST as protokollePost } from '../../src/routes/api/protokolle/+server';
import { GET as protokollGet, PUT as protokollPut } from '../../src/routes/api/protokolle/[id]/+server';
import { GET as protokollPdfGet } from '../../src/routes/api/protokolle/[id]/pdf/+server';
import { POST as protokollMail } from '../../src/routes/api/protokolle/[id]/email/+server';
import { POST as unterschriftPost } from '../../src/routes/api/protokolle/[id]/unterschrift/+server';
import { baueUmgebung, jsonAnfrage, testPng, UNBEKANNT, type Umgebung } from './hilfe-1c';

/**
 * Stufe 2a: Dateien, Notizen und Protokolle eines Auftrags – vorher prüften die Endpunkte weder Rechte noch, ob der
 * Auftrag für den Nutzer sichtbar ist. Regeln siehe src/lib/server/dokumentation-zugriff.ts.
 */
describe('Dokumentation eines Auftrags: Rechte und Sichtbarkeit', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let sichtbar: string; // Auftrag, in dem der Monteur eine Aufgabe hat (für ihn sichtbar)
	let datei: string, notiz: string, protokoll: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const ohneAuftraege = (): Nutzer => ({ id: u.ids.monteurA, betriebId: u.betriebA, istAdmin: false, rechte: ['kunden.lesen'], betriebStatus: 'aktiv' });
	const status = async (r: Response | Promise<Response>) => (await r).status;
	const mitUrl = (nutzer: Nutzer, pfad: string) => ({ locals: { nutzer }, url: new URL(`http://localhost${pfad}`) }) as never;
	const mitId = (nutzer: Nutzer, id: string, request?: Request) => ({ locals: { nutzer }, params: { id }, request }) as never;
	const upload = (auftragId: string) => {
		const f = new FormData();
		f.append('auftragId', auftragId);
		f.append('datei', new File([Buffer.from(testPng(4, 2))], 'foto.png', { type: 'image/png' }));
		return new Request('http://localhost/api/dateien', { method: 'POST', body: f });
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		sichtbar = await u.neuerAuftrag('beauftragt', 'Monteur-Auftrag');
		await root`insert into app.todos (betrieb_id, auftrag_id, titel, zustaendig_id) values (${u.betriebA}, ${sichtbar}, 'Vor Ort', ${u.ids.monteurA})`;
		datei = (await speichereDatei(kA(), u.auftragA, 'plan "a".png', 'image/png', 100, testPng(4, 2))).id;
		notiz = (await notizAnlegen(kA(), u.auftragA, 'Geheime Notiz')).id;
		protokoll = (await legeProtokollAn(kA(), u.auftragA, 'abnahme', { bemerkung: 'ok' })).id;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Dateien: Liste/Download nur bei sichtbarem Auftrag; Hochladen/Löschen nur mit „Aufträge bearbeiten“', async () => {
		// Monteur: fremder (unsichtbarer) Auftrag → 404, eigener → 200; ohne Auftragsrechte → 403
		expect(await status(dateienGet(mitUrl(u.monteurA, `/api/dateien?auftragId=${u.auftragA}`)))).toBe(404);
		expect(await status(dateienGet(mitUrl(u.monteurA, `/api/dateien?auftragId=${sichtbar}`)))).toBe(200);
		expect(await status(dateienGet(mitUrl(ohneAuftraege(), `/api/dateien?auftragId=${u.auftragA}`)))).toBe(403);
		expect(await status(dateiGet(mitId(u.monteurA, datei)))).toBe(404);
		expect(await status(dateiGet(mitId(u.chefB, datei)))).toBe(404);
		expect(await status(dateiGet(mitId(u.chefA, 'kaputt')))).toBe(404);
		expect(await status(dateiGet(mitId(u.chefA, UNBEKANNT)))).toBe(404);
		const r = await dateiGet(mitId(u.chefA, datei));
		expect(r.status).toBe(200);
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-disposition')).toBe(`inline; filename="plan _a_.png"; filename*=UTF-8''plan%20%22a%22.png`);
		// Schreiben
		expect(await status(dateienPost({ locals: { nutzer: u.monteurA }, request: upload(sichtbar) } as never))).toBe(403);
		expect(await status(dateienPost({ locals: { nutzer: u.chefB }, request: upload(u.auftragA) } as never))).toBe(404);
		expect(await status(dateienPost({ locals: { nutzer: u.bueroA }, request: upload(u.auftragA) } as never))).toBe(201);
		expect(await status(dateiDelete(mitId(u.monteurA, datei)))).toBe(403);
		expect(await status(dateiDelete(mitId(u.chefB, datei)))).toBe(404);
		expect(await root`select 1 from app.dateien where id = ${datei}`).toHaveLength(1);
	});

	it('Notizen: lesen nur bei sichtbarem Auftrag; anlegen/ändern/löschen nur mit „Aufträge bearbeiten“', async () => {
		expect(await status(notizenGet(mitUrl(u.monteurA, `/api/notizen?auftragId=${u.auftragA}`)))).toBe(404);
		expect(await status(notizenGet(mitUrl(u.monteurA, `/api/notizen?auftragId=${sichtbar}`)))).toBe(200);
		const post = (n: Nutzer, auftragId: string) =>
			status(notizenPost({ locals: { nutzer: n }, request: jsonAnfrage('POST', { auftragId, text: 'x' }) } as never));
		expect(await post(u.monteurA, sichtbar)).toBe(403);
		expect(await post(u.chefB, u.auftragA)).toBe(404);
		expect(await post(u.bueroA, u.auftragA)).toBe(201);
		expect(await status(notizPut(mitId(u.monteurA, notiz, jsonAnfrage('PUT', { text: 'gekapert' }))))).toBe(403);
		expect(await status(notizPut(mitId(u.chefB, notiz, jsonAnfrage('PUT', { text: 'gekapert' }))))).toBe(404);
		expect(await status(notizDelete(mitId(u.monteurA, notiz)))).toBe(403);
		expect((await root`select text from app.notizen where id = ${notiz}`)[0].text).toBe('Geheime Notiz');
	});

	it('Protokolle: lesen mit „Protokolle ansehen“, schreiben/unterschreiben/versenden mit „Protokolle bearbeiten“; PDF geht', async () => {
		expect(await status(protokolleGet(mitUrl(u.monteurA, `/api/protokolle?auftragId=${sichtbar}`)))).toBe(403);
		expect(await status(protokolleGet(mitUrl(u.bueroA, `/api/protokolle?auftragId=${u.auftragA}`)))).toBe(200);
		expect(await status(protokollGet(mitId(u.monteurA, protokoll)))).toBe(403);
		expect(await status(protokollGet(mitId(u.chefB, protokoll)))).toBe(404);
		const neu = (n: Nutzer) =>
			status(protokollePost({ locals: { nutzer: n }, request: jsonAnfrage('POST', { auftragId: u.auftragA, typ: 'aufmass' }) } as never));
		expect(await neu(u.monteurA)).toBe(403);
		expect(await neu(u.bueroA)).toBe(201);
		expect(await status(protokollPut(mitId(u.monteurA, protokoll, jsonAnfrage('PUT', { inhalt: { x: 1 } }))))).toBe(403);
		const png = new Request('http://localhost/x', { method: 'POST', body: Buffer.from(testPng(4, 2)) });
		expect(await status(unterschriftPost(mitId(u.monteurA, protokoll, png)))).toBe(403);
		expect(await status(protokollMail(mitId(u.monteurA, protokoll)))).toBe(403);
		// PDF (las vorher eine nicht vorhandene Spalte kunden.name → immer 500)
		const pdf = await protokollPdfGet(mitId(u.bueroA, protokoll));
		expect(pdf.status).toBe(200);
		expect(pdf.headers.get('content-type')).toBe('application/pdf');
		expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
		expect(await status(protokollPdfGet(mitId(u.chefB, protokoll)))).toBe(404);
	});
});
