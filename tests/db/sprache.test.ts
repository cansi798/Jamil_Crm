import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { POST as audioPost } from '../../src/routes/api/sprache/+server';
import { antwort, baueUmgebung, type Umgebung } from './hilfe-1c';
import { audioBytes, starteSttDouble, type SttDouble } from './stt-double';

/** Rohe Audio-Anfrage wie vom Mikrofon-Knopf (Körper = Aufnahme, Content-Type = Format des MediaRecorders). */
const audioAnfrage = (bytes: Uint8Array, typ: string | null, laengeKopf?: string) => {
	const kopf: Record<string, string> = {};
	if (typ) kopf['content-type'] = typ;
	if (laengeKopf) kopf['content-length'] = laengeKopf;
	return new Request('http://localhost/api/sprache', { method: 'POST', headers: kopf, body: bytes as BodyInit });
};

describe('Sprache – Audio annehmen und transkribieren (Task 2)', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let stt: SttDouble;

	const senden = async (nutzer: Nutzer | null, bytes: Uint8Array, typ: string | null, laengeKopf?: string) =>
		antwort(await audioPost({ locals: { nutzer }, request: audioAnfrage(bytes, typ, laengeKopf) } as never));

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		stt = await starteSttDouble();
		process.env.CRM_STT_URL = stt.url;
	});
	afterAll(async () => {
		await stt?.stop();
		await schliesseDb();
		await root?.end();
	});
	beforeEach(() => stt.zuruecksetzen());

	it('nimmt alle vier Formate an und liefert den erkannten Text', async () => {
		for (const [format, typ] of [
			['webm', 'audio/webm;codecs=opus'],
			['ogg', 'audio/ogg; codecs=opus'],
			['mp4', 'audio/mp4'],
			['wav', 'audio/wav']
		] as const) {
			const a = await senden(u.chefA, audioBytes(format), typ);
			expect(a.status, typ).toBe(200);
			expect(a.koerper.text).toBe('Neuer Auftrag für Müller');
		}
		expect(stt.aufrufe()).toBe(4);
	});

	it('Monteur darf sprechen (Rechte prüft erst die Aktion)', async () => {
		const a = await senden(u.monteurA, audioBytes('webm'), 'audio/webm');
		expect(a.status).toBe(200);
	});

	it('ohne Anmeldung 401, Plattform-Admin 403, Betrieb ohne Modul sprache 402 – STT wird nie gefragt', async () => {
		expect((await senden(null, audioBytes('webm'), 'audio/webm')).status).toBe(401);
		expect((await senden(u.admin, audioBytes('webm'), 'audio/webm')).status).toBe(403);
		const ohne = await senden(u.chefC, audioBytes('webm'), 'audio/webm');
		expect(ohne.status).toBe(402);
		expect(ohne.koerper.fehler).toBe('Im aktuellen Tarif nicht enthalten');
		expect(stt.aufrufe()).toBe(0);
	});

	it('6 MB → 413 (auch schon am Content-Length-Kopf), STT wird nicht gefragt', async () => {
		const gross = audioBytes('webm', 6 * 1024 * 1024);
		const a = await senden(u.chefA, gross, 'audio/webm');
		expect(a.status).toBe(413);
		expect(a.koerper.fehler).toBe('Die Aufnahme ist zu groß (höchstens 5 MB).');
		const b = await senden(u.chefA, audioBytes('webm', 100), 'audio/webm', String(6 * 1024 * 1024));
		expect(b.status).toBe(413);
		expect(stt.aufrufe()).toBe(0);
	});

	it('genau 5 MB sind erlaubt', async () => {
		expect((await senden(u.chefA, audioBytes('webm', 5 * 1024 * 1024), 'audio/webm')).status).toBe(200);
	});

	it('falsches oder fehlendes Format → 415, STT wird nicht gefragt', async () => {
		for (const typ of ['text/plain', 'application/json', 'audio/mpeg', 'image/png', null]) {
			const a = await senden(u.chefA, audioBytes('webm'), typ);
			expect(a.status, String(typ)).toBe(415);
			expect(a.koerper.fehler).toBe('Dieses Audioformat wird nicht unterstützt (webm, ogg, mp4, wav).');
		}
		expect(stt.aufrufe()).toBe(0);
	});

	it('Inhalt passt nicht zum Format (Magic Bytes) → 400, STT wird nicht gefragt', async () => {
		const html = new TextEncoder().encode('<html><body>kein Audio</body></html>'.repeat(10));
		for (const typ of ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']) {
			const a = await senden(u.chefA, html, typ);
			expect(a.status, typ).toBe(400);
			expect(a.koerper.fehler).toBe('Die Datei ist keine gültige Aufnahme.');
		}
		// webm-Kopf als wav ausgegeben
		expect((await senden(u.chefA, audioBytes('webm'), 'audio/wav')).status).toBe(400);
		// RIFF ohne WAVE
		const riff = audioBytes('wav');
		riff.set(new TextEncoder().encode('AVI '), 8);
		expect((await senden(u.chefA, riff, 'audio/wav')).status).toBe(400);
		expect(stt.aufrufe()).toBe(0);
	});

	it('leere Aufnahme → 422 „Ich habe nichts verstanden“, STT wird nicht gefragt', async () => {
		const a = await senden(u.chefA, new Uint8Array(0), 'audio/webm');
		expect(a.status).toBe(422);
		expect(a.koerper.fehler).toBe('Ich habe nichts verstanden – bitte noch einmal');
		expect(stt.aufrufe()).toBe(0);
	});

	it('stumme Aufnahme (STT liefert leeren Text) → 422 „Ich habe nichts verstanden“', async () => {
		stt.antworte(200, { text: '   ', dauer_s: 3, sprache: 'de' });
		const a = await senden(u.chefA, audioBytes('webm'), 'audio/webm');
		expect(a.status).toBe(422);
		expect(a.koerper.fehler).toBe('Ich habe nichts verstanden – bitte noch einmal');
		expect(stt.aufrufe()).toBe(1);
	});

	it('61 s (STT meldet zu_lang) → 422 mit klarer Meldung', async () => {
		stt.antworte(422, { fehler: 'zu lang', grund: 'zu_lang' });
		const a = await senden(u.chefA, audioBytes('webm'), 'audio/webm');
		expect(a.status).toBe(422);
		expect(a.koerper.fehler).toBe('Die Aufnahme ist zu lang (höchstens 60 Sekunden).');
	});

	it('kaputtes Audio (STT meldet unlesbar/leer) → 422', async () => {
		stt.antworte(422, { fehler: 'x', grund: 'unlesbar' });
		expect((await senden(u.chefA, audioBytes('ogg'), 'audio/ogg')).koerper.fehler).toBe(
			'Die Aufnahme konnte nicht gelesen werden – bitte noch einmal.'
		);
		stt.antworte(422, { fehler: 'x', grund: 'leer' });
		expect((await senden(u.chefA, audioBytes('ogg'), 'audio/ogg')).koerper.fehler).toBe(
			'Ich habe nichts verstanden – bitte noch einmal'
		);
	});

	it('STT ausgelastet oder nicht erreichbar → 503', async () => {
		stt.antworte(503, { fehler: 'belegt', grund: 'belegt' });
		const a = await senden(u.chefA, audioBytes('webm'), 'audio/webm');
		expect(a.status).toBe(503);
		expect(a.koerper.fehler).toBe('Die Spracherkennung ist gerade nicht erreichbar – bitte gleich noch einmal.');
		const alt = process.env.CRM_STT_URL;
		process.env.CRM_STT_URL = 'http://127.0.0.1:1';
		try {
			expect((await senden(u.chefA, audioBytes('webm'), 'audio/webm')).status).toBe(503);
		} finally {
			process.env.CRM_STT_URL = alt;
		}
	});

	it('überträgt die Aufnahme an den STT-Dienst (multipart, Feld audio)', async () => {
		await senden(u.chefA, audioBytes('wav', 4000), 'audio/wav');
		expect(stt.letzteGroesse()).toBeGreaterThan(4000);
		expect(stt.letzteGroesse()).toBeLessThan(4600);
	});
});
