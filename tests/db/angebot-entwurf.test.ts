import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { setzeKiAnbieter, type EntwurfEingabe, type KiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { pruefeEntwurf, type KiAktion } from '../../src/lib/server/sprache/aktionen';
import { KI_PRUEF_MARKER } from '../../src/lib/ki-entwurf';
import { POST as entwurfPost } from '../../src/routes/api/angebote/entwurf/+server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, testPng, UNBEKANNT, type Umgebung } from './hilfe-1c';

/** KI-Ersatz mit fest vorgegebener Antwort für den Angebotsentwurf (zählt Aufrufe, merkt sich die Eingabe). */
class FesteKi implements KiAnbieter {
	readonly name = 'fake' as const;
	aufrufe = 0;
	eingabe: EntwurfEingabe | null = null;
	constructor(public antwort: unknown) {}
	async aktionAusText(): Promise<KiAktion> {
		this.aufrufe++;
		return { aktion: 'unbekannt', daten: {} };
	}
	async angebotsEntwurf(e: EntwurfEingabe) {
		this.aufrufe++;
		this.eingabe = e;
		return pruefeEntwurf(this.antwort);
	}
	async bildAuswertung<T>(): Promise<T> {
		throw new Error('nicht benutzt');
	}
}

const formAnfrage = (felder: Record<string, string | Blob>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(felder)) f.append(k, v);
	return new Request('http://localhost/api/angebote/entwurf', { method: 'POST', body: f });
};

describe('KI-Angebotsentwurf nur aus dem Katalog (Task 7)', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let fake: FakeKi;
	let k1: string, k2: string, k3: string;

	const entwurf = async (nutzer: Nutzer | null, koerper: Record<string, unknown>) =>
		antwort(await entwurfPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper) } as never));
	const entwurfForm = async (nutzer: Nutzer | null, felder: Record<string, string | Blob>) =>
		antwort(await entwurfPost({ locals: { nutzer }, request: formAnfrage(felder) } as never));
	const verbrauch = async () => (await root`select coalesce(sum(anzahl), 0)::int as n from app.ki_nutzung`)[0].n as number;
	const anzahlAngebote = async () => (await root`select count(*)::int as n from app.angebote`)[0].n as number;
	const positionen = async (angebotId: string) =>
		root`select pos, katalog_position_id, bezeichnung, beschreibung, menge::float8 as menge, einzelpreis_cent::int as einzelpreis_cent from app.angebot_positionen where angebot_id = ${angebotId} order by pos`;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-entwurf-0123456789abcdef';
		const pos = async (bezeichnung: string, einheit: string, lohn: number, material: number, aktiv = true, beschreibung: string | null = null) =>
			(await root`
				insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, beschreibung, einheit, lohn_cent, material_cent, aktiv)
				values (${u.betriebA}, 'fliesen', ${bezeichnung}, ${beschreibung}, ${einheit}, ${lohn}, ${material}, ${aktiv}) returning id`)[0].id as string;
		k1 = await pos('Wandfliesen verlegen', 'm²', 3000, 1500);
		k2 = await pos('Silikonfuge erneuern', 'lfm', 500, 300, true, 'Alte Fuge entfernen, neu verfugen');
		k3 = await pos('Raufaser tapezieren', 'm²', 400, 200);
		await pos('Alte Leistung', 'Stk', 100, 0, false);
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await leereAngebote(root);
		await root`delete from app.ki_nutzung`;
		fake = new FakeKi();
		setzeKiAnbieter(fake);
	});

	it('Büro: Stichworte → Entwurf mit Katalogpreisen, unsichere Position „bitte prüfen“, Kontingent zählt 1', async () => {
		const a = await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: '12 Quadratmeter Wandfliesen und Silikonfugen' });
		expect(a.status).toBe(201);
		expect(a.koerper).toMatchObject({ pruefen: [2], verworfen: 0 });
		const [an] = await root`select status, auftrag_id from app.angebote where id = ${a.koerper.angebotId}`;
		expect(an).toEqual({ status: 'entwurf', auftrag_id: u.auftragA });
		const p = await positionen(a.koerper.angebotId);
		expect(p).toHaveLength(2);
		expect(p[0]).toMatchObject({ katalog_position_id: k1, bezeichnung: 'Wandfliesen verlegen', menge: 12, einzelpreis_cent: 4500 });
		expect(p[1]).toMatchObject({ katalog_position_id: k2, menge: 1, einzelpreis_cent: 800 });
		expect(p[1].beschreibung).toBe(`${KI_PRUEF_MARKER}\nAlte Fuge entfernen, neu verfugen`);
		expect(p[0].beschreibung).toBeNull();
		expect(await verbrauch()).toBe(1);
		// Die KI bekam nur aktive Katalogpositionen – Schlüssel, Bezeichnung, Einheit, Gewerk; keine Preise, keine IDs
		const gesendet = fake.letzterEntwurf!;
		expect(gesendet.katalog.map((x) => x.bezeichnung).sort()).toEqual(['Raufaser tapezieren', 'Silikonfuge erneuern', 'Wandfliesen verlegen']);
		for (const x of gesendet.katalog) expect(Object.keys(x).sort()).toEqual(['bezeichnung', 'einheit', 'gewerk', 'schluessel']);
		const alles = JSON.stringify(gesendet);
		expect(alles).not.toMatch(/cent|lohn|material|preis/i);
		for (const id of [k1, k2, k3]) expect(alles).not.toContain(id);
		expect(gesendet.text).toBe('12 Quadratmeter Wandfliesen und Silikonfugen');
	});

	it('Review Focus 5: unbekannte Position wird verworfen, KI-Preis ignoriert (Preis aus dem Katalog) und als „bitte prüfen“ markiert', async () => {
		const ki = new FesteKi({
			positionen: [
				{ schluessel: 'K99', menge: 3, unsicher: false },
				{ schluessel: 'K1', menge: 2, unsicher: false, einzelpreis: 1 }
			]
		});
		setzeKiAnbieter(ki);
		const a = await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: 'Fliesen' });
		expect(a.status).toBe(201);
		expect(a.koerper).toMatchObject({ pruefen: [1], verworfen: 1 });
		const p = await positionen(a.koerper.angebotId);
		expect(p).toHaveLength(1);
		const schluessel = ki.eingabe!.katalog.find((x) => x.schluessel === 'K1')!;
		const [kat] = await root`select (lohn_cent + material_cent)::int as preis from app.katalog_positionen where bezeichnung = ${schluessel.bezeichnung}`;
		expect(p[0].einzelpreis_cent).toBe(kat.preis);
		expect(p[0].einzelpreis_cent).not.toBe(100);
		expect(p[0].beschreibung).toMatch(new RegExp(`^${KI_PRUEF_MARKER.replace(/[()]/g, '\\$&')}`));
	});

	it('KI findet nichts Passendes → 422, kein Angebot (Anfrage zählt trotzdem)', async () => {
		setzeKiAnbieter(new FesteKi({ positionen: [{ schluessel: 'X1', menge: 1 }] }));
		const a = await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: 'Dachziegel' });
		expect(a.status).toBe(422);
		expect(a.koerper.fehler).toBe('Die KI hat keine passende Position im Katalog gefunden.');
		expect(await anzahlAngebote()).toBe(0);
		expect(await verbrauch()).toBe(1);
	});

	it('Rechte: Monteur 403, Büro ohne Preise 403, Betrieb ohne Modul ki_angebote 402 – keine KI-Anfrage', async () => {
		expect((await entwurf(u.monteurA, { auftragId: u.auftragA, stichworte: 'Fliesen' })).status).toBe(403);
		expect((await entwurf(u.ohnePreiseA, { auftragId: u.auftragA, stichworte: 'Fliesen' })).status).toBe(403);
		expect((await entwurf(null, { auftragId: u.auftragA, stichworte: 'Fliesen' })).status).toBe(401);
		const [ohneKi] = await root`
			insert into app.tarife (schluessel, name, module, grenzen)
			values ('ohne-ki', 'Ohne KI', ${['kunden', 'auftraege', 'katalog', 'angebote']}, '{"benutzer": 5, "ki_pro_monat": 10}') returning id`;
		await root`update app.betriebe set tarif_id = ${ohneKi.id} where id = ${u.betriebA}`;
		try {
			const a = await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: 'Fliesen' });
			expect(a.status).toBe(402);
		} finally {
			await root`update app.betriebe set tarif_id = (select id from app.tarife where schluessel = 'premium') where id = ${u.betriebA}`;
		}
		expect(fake.aufrufe).toBe(0);
		expect(await verbrauch()).toBe(0);
	});

	it('Eingaben: unbekannter Auftrag 404, fremder Auftrag 404, leere Stichworte 400, leerer Katalog 409 – jeweils ohne KI', async () => {
		expect((await entwurf(u.bueroA, { auftragId: UNBEKANNT, stichworte: 'Fliesen' })).status).toBe(404);
		expect((await entwurf(u.bueroA, { auftragId: u.auftragB, stichworte: 'Fliesen' })).status).toBe(404);
		expect((await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: '  ' })).status).toBe(400);
		expect((await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: 'x'.repeat(2001) })).status).toBe(400);
		const b = await entwurf(u.chefB, { auftragId: u.auftragB, stichworte: 'Fliesen' });
		expect(b.status).toBe(409);
		expect(b.koerper.fehler).toBe('Der Katalog ist leer – bitte zuerst Leistungen anlegen.');
		expect(fake.aufrufe).toBe(0);
		expect(await verbrauch()).toBe(0);
	});

	it('Kontingent aufgebraucht → 429, kein Angebot', async () => {
		await root`
			insert into app.ki_nutzung (betrieb_id, monat, anzahl)
			values (${u.betriebA}, date_trunc('month', now() at time zone 'Europe/Berlin')::date, 1500)`;
		const a = await entwurf(u.bueroA, { auftragId: u.auftragA, stichworte: 'Fliesen' });
		expect(a.status).toBe(429);
		expect(fake.aufrufe).toBe(0);
		expect(await anzahlAngebote()).toBe(0);
	});

	it('Foto (multipart): nur JPEG/PNG bis 5 MB, nur mit Zustimmung; geht an die KI', async () => {
		const ki = new FesteKi({ positionen: [{ schluessel: 'K1', menge: 4, unsicher: true }] });
		setzeKiAnbieter(ki);
		const png = new Blob([testPng(8, 8) as BlobPart], { type: 'image/png' });
		const ohne = await entwurfForm(u.bueroA, { auftragId: u.auftragA, stichworte: 'Bad', foto: png });
		expect(ohne.status).toBe(400);
		expect(ohne.koerper.fehler).toBe('Bitte zustimmen, dass das Foto zur Auswertung an die KI gesendet wird.');
		const kaputt = await entwurfForm(u.bueroA, {
			auftragId: u.auftragA,
			stichworte: 'Bad',
			zustimmung: 'ja',
			foto: new Blob(['<html>kein Bild</html>'], { type: 'image/png' })
		});
		expect(kaputt.status).toBe(400);
		expect(kaputt.koerper.fehler).toBe('Das Foto muss ein JPEG- oder PNG-Bild sein.');
		const gross = await entwurfForm(u.bueroA, {
			auftragId: u.auftragA,
			stichworte: 'Bad',
			zustimmung: 'ja',
			foto: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
		});
		expect(gross.status).toBe(413);
		expect(ki.aufrufe).toBe(0);
		const ok = await entwurfForm(u.bueroA, { auftragId: u.auftragA, stichworte: 'Bad', zustimmung: 'ja', foto: png });
		expect(ok.status).toBe(201);
		expect(ki.eingabe!.foto!.typ).toBe('image/png');
		expect(ki.eingabe!.foto!.bytes.byteLength).toBe(testPng(8, 8).byteLength);
		expect(ok.koerper.pruefen).toEqual([1]);
	});

	it('per Sprache: „Erstelle ein Angebot für Müller: 12 Quadratmeter Wandfliesen“ → Karte → Ja → Entwurf (quelle=sprache), Kontingent 2', async () => {
		const textAntwort = antwort(
			await textPost({ locals: { nutzer: u.bueroA }, request: jsonAnfrage('POST', { text: 'Erstelle ein Angebot für Müller: 12 Quadratmeter Wandfliesen' }) } as never)
		);
		const v = await textAntwort;
		expect(v.status).toBe(200);
		expect(v.koerper.karte.titel).toBe('Angebotsentwurf (KI)');
		expect(typeof v.koerper.vorschlag).toBe('string');
		expect(fake.entwurfAufrufe).toBe(0); // Katalog geht erst beim Speichern an die KI
		const a = await antwort(
			await ausfuehrenPost({ locals: { nutzer: u.bueroA }, request: jsonAnfrage('POST', { vorschlag: v.koerper.vorschlag }) } as never)
		);
		expect(a.status).toBe(201);
		expect(a.koerper.meldung).toMatch(/^Angebotsentwurf AN-\d{4}-\d{4} angelegt – bitte prüfen$/);
		const id = a.koerper.link.split('/').at(-1);
		expect(a.koerper.link).toBe(`/angebote/${id}`);
		const p = await positionen(id);
		expect(p).toHaveLength(1);
		expect(p[0]).toMatchObject({ katalog_position_id: k1, menge: 12, einzelpreis_cent: 4500 });
		const [an] = await root`select status from app.angebote where id = ${id}`;
		expect(an.status).toBe('entwurf');
		const prot = await root`select distinct quelle from app.aenderungen where tabelle in ('angebote', 'angebot_positionen') and (datensatz_id = ${id} or nachher ->> 'angebot_id' = ${id})`;
		expect(prot.map((z) => z.quelle)).toEqual(['sprache']);
		expect(await verbrauch()).toBe(2);
	});
});
