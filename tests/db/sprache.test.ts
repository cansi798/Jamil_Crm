import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { POST as audioPost } from '../../src/routes/api/sprache/+server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { signiere } from '../../src/lib/server/sprache/vorschlag';
import { legeKundeAn } from '../../src/lib/server/kunden';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { pruefeVorschlag } from '../../src/lib/server/sprache/vorschlag';
import { berlinTag, tagPlus, wochentag } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { audioBytes, starteSttDouble, type SttDouble } from './stt-double';

/** Rohe Audio-Anfrage wie vom Mikrofon-Knopf (Körper = Aufnahme, Content-Type = Format des MediaRecorders). */
const audioAnfrage = (bytes: Uint8Array, typ: string | null, laengeKopf?: string) => {
	const kopf: Record<string, string> = {};
	if (typ) kopf['content-type'] = typ;
	if (laengeKopf) kopf['content-length'] = laengeKopf;
	return new Request('http://localhost/api/sprache', { method: 'POST', headers: kopf, body: bytes as BodyInit });
};

describe('Sprache – Audio, Text, Vorschlag (Tasks 2 und 4)', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let stt: SttDouble;
	let ki: FakeKi;
	let mehmetId: string, kundeHamburg: string, kundeBecker: string;

	/** KI-Anfragen dieses Monats (alle Betriebe). */
	const verbrauch = async () => (await root`select coalesce(sum(anzahl), 0)::int as n from app.ki_nutzung`)[0].n as number;
	const text = async (nutzer: Nutzer | null, koerper: unknown, typ: string | null = 'application/json') =>
		antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper, typ) } as never));
	const ausfuehren = async (nutzer: Nutzer | null, koerper: unknown) =>
		antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper) } as never));
	const anzahl = async (tabelle: string) => (await root.unsafe(`select count(*)::int as n from app.${tabelle}`))[0].n as number;

	const senden = async (nutzer: Nutzer | null, bytes: Uint8Array, typ: string | null, laengeKopf?: string) =>
		antwort(await audioPost({ locals: { nutzer }, request: audioAnfrage(bytes, typ, laengeKopf) } as never));

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		stt = await starteSttDouble();
		process.env.CRM_STT_URL = stt.url;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		ki = new FakeKi();
		setzeKiAnbieter(ki);
		const [monteurRolle] = await root`select rolle_id from app.benutzer where id = ${u.ids.monteurA}`;
		[{ id: mehmetId }] = await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${u.betriebA}, 'mehmet-a@beispiel.test', 'Mehmet Kaya', 'x', ${monteurRolle.rolle_id}) returning id`;
		[{ id: kundeHamburg }] = await root`
			insert into app.kunden (betrieb_id, art, vorname, nachname, ort) values (${u.betriebA}, 'privat', 'Petra', 'Müller', 'Hamburg') returning id`;
		[{ id: kundeBecker }] = await root`
			insert into app.kunden (betrieb_id, art, firma, ort) values (${u.betriebA}, 'firma', 'Becker Bau GmbH', 'Quickborn') returning id`;
		// Kunde mit gleichem Namen in Betrieb B – darf nie auftauchen
		await root`insert into app.kunden (betrieb_id, art, nachname, ort) values (${u.betriebB}, 'privat', 'Becker', 'Berlin')`;
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await stt?.stop();
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		stt.zuruecksetzen();
		ki.aufrufe = 0;
		await root`delete from app.ki_nutzung`;
	});

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

	// ---------------------------------------------------------------------------------------------------------------
	// Task 4: Vorschlag und Karte

	const naechster = (ziel: number) => {
		const heute = berlinTag(new Date());
		return tagPlus(heute, ((ziel - wochentag(heute) + 7) % 7) || 7);
	};
	const deutsch = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;
	const zeile = (karte: any, label: string) => karte.zeilen.find((z: any) => z.label === label)?.wert;

	it('Review Focus 4: leer, stumm, 61 s, 6 MB, falsches Format → klare Meldung, kein KI-Aufruf, Kontingent unverändert', async () => {
		const faelle: [string, () => Promise<{ status: number; koerper: any }>, number][] = [
			['leer', () => senden(u.chefA, new Uint8Array(0), 'audio/webm'), 422],
			['6 MB', () => senden(u.chefA, audioBytes('webm', 6 * 1024 * 1024), 'audio/webm'), 413],
			['Format', () => senden(u.chefA, audioBytes('webm'), 'text/plain'), 415],
			['Magic Bytes', () => senden(u.chefA, new TextEncoder().encode('<html></html>'), 'audio/webm'), 400],
			[
				'stumm',
				async () => {
					stt.antworte(200, { text: '', dauer_s: 3, sprache: 'de' });
					return senden(u.chefA, audioBytes('webm'), 'audio/webm');
				},
				422
			],
			[
				'61 s',
				async () => {
					stt.antworte(422, { fehler: 'zu lang', grund: 'zu_lang' });
					return senden(u.chefA, audioBytes('webm'), 'audio/webm');
				},
				422
			]
		];
		for (const [name, f, status] of faelle) {
			const a = await f();
			expect(a.status, name).toBe(status);
			expect(typeof a.koerper.fehler, name).toBe('string');
			expect(a.koerper.vorschlag, name).toBeUndefined();
		}
		expect(ki.aufrufe).toBe(0);
		expect(await verbrauch()).toBe(0);
	});

	it('gültige Aufnahme → Text, Vorschlag und Karte; genau eine KI-Anfrage gezählt', async () => {
		stt.antworte(200, { text: 'Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker', dauer_s: 4, sprache: 'de' });
		const a = await senden(u.bueroA, audioBytes('webm'), 'audio/webm');
		expect(a.status).toBe(200);
		expect(a.koerper.text).toBe('Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker');
		expect(typeof a.koerper.vorschlag).toBe('string');
		const k = a.koerper.karte;
		expect(k.titel).toBe('Auftrag anlegen');
		expect(zeile(k, 'Auftrag')).toBe('Badsanierung');
		expect(zeile(k, 'Kunde')).toBe('Becker Bau GmbH, Quickborn');
		const montag = naechster(0);
		expect(zeile(k, 'Start')).toBe(`Montag, ${deutsch(montag)}`);
		expect(zeile(k, 'Mitarbeiter')).toBe('Ali Monteur + Mehmet Kaya');
		expect(zeile(k, 'Einsatz')).toBe(`Montag, ${deutsch(montag)}, 07:00–15:00`);
		expect(k.fehler).toBeNull();
		expect(k.auswahl).toEqual([]);
		expect(ki.aufrufe).toBe(1);
		expect(await verbrauch()).toBe(1);
		// Vorschlag: signiert, an Büro A gebunden, mit aufgelösten IDs
		const v = pruefeVorschlag(a.koerper.vorschlag, u.ids.bueroA, u.betriebA).vorschau;
		expect(v.aktion).toBe('auftrag_anlegen');
		expect(v.werte.kundeId).toBe(kundeBecker);
		expect(v.werte.geplantAb).toBe(montag);
		expect(v.werte.einsaetze.map((e: any) => e.benutzerId)).toEqual([u.ids.monteurA, mehmetId]);
		expect(() => pruefeVorschlag(a.koerper.vorschlag, u.ids.chefA, u.betriebA)).toThrow();
	});

	it('zwei Kunden „Müller“ → Auswahl mit Ort („Meinen Sie Kunde Müller in Norderstedt oder in Hamburg?“)', async () => {
		const a = await text(u.bueroA, { text: 'Neuer Auftrag Fliesen Küche bei Müller' });
		expect(a.status).toBe(200);
		const k = a.koerper.karte;
		expect(k.auswahl).toHaveLength(1);
		expect(k.auswahl[0].feld).toBe('kunde');
		expect(k.auswahl[0].frage).toBe('Meinen Sie Kunde Müller in Norderstedt oder in Hamburg?');
		expect(k.auswahl[0].optionen.map((o: any) => o.id).sort()).toEqual([u.kundeA, kundeHamburg].sort());
		expect(k.auswahl[0].optionen.map((o: any) => o.label).sort()).toEqual(['Hans Müller, Norderstedt', 'Petra Müller, Hamburg']);
		expect(typeof a.koerper.vorschlag).toBe('string');
		expect(zeile(k, 'Auftrag')).toBe('Fliesen Küche');
	});

	it('mit Ort genannt → eindeutig', async () => {
		const a = await text(u.bueroA, { text: 'Neuer Auftrag Fliesen Küche bei Müller in Hamburg' });
		expect(a.koerper.karte.auswahl).toEqual([]);
		expect(zeile(a.koerper.karte, 'Kunde')).toBe('Petra Müller, Hamburg');
	});

	it('Kunde nicht gefunden → Hinweis auf der Karte, kein Vorschlag; Kunde aus fremdem Betrieb nie sichtbar', async () => {
		const a = await text(u.bueroA, { text: 'Neuer Auftrag Dach decken bei Schmidt' });
		expect(a.status).toBe(200);
		expect(a.koerper.vorschlag).toBeNull();
		expect(a.koerper.karte.fehler).toBe('Kunde „Schmidt“ nicht gefunden – bitte zuerst den Kunden anlegen.');
		const b = await text(u.chefB, { text: 'Neuer Auftrag Dach decken bei Becker' });
		expect(zeile(b.koerper.karte, 'Kunde')).toBe('Becker, Berlin');
	});

	it('Kunde anlegen → Karte; gleicher Name vorhanden → Warnung', async () => {
		const a = await text(u.bueroA, { text: 'Neuer Kunde Eva Schulz aus Hamburg' });
		expect(a.koerper.karte.titel).toBe('Kunde anlegen');
		expect(zeile(a.koerper.karte, 'Name')).toBe('Eva Schulz');
		expect(zeile(a.koerper.karte, 'Adresse')).toBe('Hamburg');
		expect(a.koerper.karte.warnungen).toEqual([]);
		expect(typeof a.koerper.vorschlag).toBe('string');
		const b = await text(u.bueroA, { text: 'Neuer Kunde Klaus Müller aus Kiel' });
		expect(b.koerper.karte.warnungen[0]).toMatch(/^Es gibt schon Kunden mit diesem Namen: Hans Müller, Norderstedt; Petra Müller, Hamburg/);
	});

	it('To-do mit Zuständigem und Fälligkeit „bis Freitag“', async () => {
		const a = await text(u.bueroA, { text: 'Neues To-do für Mehmet: Silikonfuge erneuern, bis Freitag' });
		const k = a.koerper.karte;
		expect(k.titel).toBe('To-do anlegen');
		expect(zeile(k, 'To-do')).toBe('Silikonfuge erneuern');
		expect(zeile(k, 'Zuständig')).toBe('Mehmet Kaya');
		expect(zeile(k, 'Fällig')).toBe(`Freitag, ${deutsch(naechster(4))}`);
		const v = pruefeVorschlag(a.koerper.vorschlag, u.ids.bueroA, u.betriebA).vorschau;
		expect(v.werte).toEqual({ titel: 'Silikonfuge erneuern', zustaendigId: mehmetId, faellig: naechster(4), auftragId: null });
	});

	it('Termin bei Becker morgen 8 Uhr mit Ali → Einsatz 08:00–16:00', async () => {
		const [auftrag] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${u.betriebA}, 'Dachrinne', ${kundeBecker}) returning id, nummer`;
		try {
			const a = await text(u.bueroA, { text: 'Termin bei Becker Dachrinne morgen 8 Uhr mit Ali' });
			const k = a.koerper.karte;
			expect(k.titel).toBe('Termin einplanen');
			expect(zeile(k, 'Auftrag')).toBe(`${auftrag.nummer} Dachrinne – Becker Bau GmbH`);
			const morgen = tagPlus(berlinTag(new Date()), 1);
			expect(zeile(k, 'Termin')).toBe(`${['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][wochentag(morgen)]}, ${deutsch(morgen)}, 08:00–16:00`);
			const v = pruefeVorschlag(a.koerper.vorschlag, u.ids.bueroA, u.betriebA).vorschau;
			expect(v.werte.auftragId).toBe(auftrag.id);
			expect(v.werte.einsaetze).toHaveLength(1);
			expect(v.werte.einsaetze[0].benutzerId).toBe(u.ids.monteurA);
		} finally {
			await root`delete from app.auftraege where id = ${auftrag.id}`;
		}
	});

	it('Termin verschieben: „Verschiebe Alis Termin auf übermorgen“ → gleicher Beginn am neuen Tag', async () => {
		const [auftrag] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${u.betriebA}, 'Dachrinne', ${kundeBecker}) returning id`;
		const morgen = tagPlus(berlinTag(new Date()), 1);
		const beginn = new Date(`${morgen}T09:00:00+01:00`);
		const [einsatz] = await root`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${auftrag.id}, ${u.ids.monteurA}, ${beginn}, ${new Date(beginn.getTime() + 3 * 3600_000)}) returning id`;
		try {
			const a = await text(u.bueroA, { text: 'Verschiebe Alis Termin auf übermorgen' });
			const k = a.koerper.karte;
			expect(k.titel).toBe('Termin verschieben');
			expect(k.fehler).toBeNull();
			const v = pruefeVorschlag(a.koerper.vorschlag, u.ids.bueroA, u.betriebA).vorschau;
			expect(v.werte.einsatzId).toBe(einsatz.id);
			expect(v.werte.nachTag).toBe(tagPlus(berlinTag(new Date()), 2));
			expect(zeile(k, 'Neu')).toContain(deutsch(tagPlus(berlinTag(new Date()), 2)));
		} finally {
			await root`delete from app.auftraege where id = ${auftrag.id}`;
		}
	});

	it('nicht unterstützt → „Das kann ich noch nicht“, kein Vorschlag (KI wurde gefragt)', async () => {
		const a = await text(u.bueroA, { text: 'Schreib eine Rechnung für Müller' });
		expect(a.status).toBe(200);
		expect(a.koerper.vorschlag).toBeNull();
		expect(a.koerper.karte.titel).toBe('Das kann ich noch nicht');
		expect(await verbrauch()).toBe(1);
	});

	it('Monteur: „Neuer Auftrag …“ → „Dafür fehlt Ihnen die Berechtigung“, kein Vorschlag, keine Namenssuche', async () => {
		const a = await text(u.monteurA, { text: 'Neuer Auftrag Fliesen Küche bei Müller' });
		expect(a.status).toBe(200);
		expect(a.koerper.vorschlag).toBeNull();
		expect(a.koerper.karte.fehler).toBe('Dafür fehlt Ihnen die Berechtigung');
		expect(a.koerper.karte.zeilen).toEqual([]);
		expect(a.koerper.karte.auswahl).toEqual([]);
	});

	it('Kontingent aufgebraucht → 429, KI wird nicht gefragt', async () => {
		await root`
			insert into app.ki_nutzung (betrieb_id, monat, anzahl)
			values (${u.betriebA}, date_trunc('month', now() at time zone 'Europe/Berlin')::date, 1500)`;
		const a = await text(u.bueroA, { text: 'Neues To-do: Material bestellen' });
		expect(a.status).toBe(429);
		expect(a.koerper.fehler).toBe('KI-Kontingent dieses Monats aufgebraucht');
		expect(ki.aufrufe).toBe(0);
	});

	it('Text-Endpunkt: Eingaben prüfen (415, 400) vor Kontingent und KI; 401/402', async () => {
		expect((await text(u.bueroA, { text: 'x' }, 'text/plain')).status).toBe(415);
		expect((await text(u.bueroA, {})).status).toBe(400);
		expect((await text(u.bueroA, { text: '   ' })).status).toBe(400);
		expect((await text(u.bueroA, { text: 5 })).status).toBe(400);
		const lang = await text(u.bueroA, { text: 'a'.repeat(501) });
		expect(lang.status).toBe(400);
		expect(lang.koerper.fehler).toBe('Der Befehl ist zu lang (höchstens 500 Zeichen).');
		expect((await text(null, { text: 'x' })).status).toBe(401);
		expect((await text(u.chefC, { text: 'x' })).status).toBe(402);
		expect(ki.aufrufe).toBe(0);
		expect(await verbrauch()).toBe(0);
	});

	// ---------------------------------------------------------------------------------------------------------------
	// Task 5: Ausführen mit Rechten und Protokoll-Quelle

	it('Auftrag mit 2 Mitarbeitern: legt Auftrag + 2 Einsätze an, liefert Plantafel-Warnungen, Protokoll quelle=sprache', async () => {
		const montag = naechster(0);
		// Ali hat am Montag Urlaub → Warnung (blockiert nicht)
		await root`insert into app.abwesenheiten (betrieb_id, benutzer_id, art, von, bis) values (${u.betriebA}, ${u.ids.monteurA}, 'urlaub', ${montag}, ${montag})`;
		try {
			const v = await text(u.bueroA, { text: 'Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker' });
			const vorher = { auftraege: await anzahl('auftraege'), einsaetze: await anzahl('einsaetze') };
			const a = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag });
			expect(a.status).toBe(201);
			expect(a.koerper.meldung).toMatch(/^Auftrag A-\d{4}-\d{4} „Badsanierung“ angelegt$/);
			expect(a.koerper.link).toMatch(/^\/auftraege\/[0-9a-f-]{36}$/);
			expect(a.koerper.warnungen).toEqual(['Ali Monteur: Urlaub']);
			expect(await anzahl('auftraege')).toBe(vorher.auftraege + 1);
			expect(await anzahl('einsaetze')).toBe(vorher.einsaetze + 2);
			const id = a.koerper.link.split('/').at(-1);
			const [auftrag] = await root`select titel, kunde_id, to_char(geplant_ab, 'YYYY-MM-DD') as geplant_ab from app.auftraege where id = ${id}`;
			expect(auftrag).toEqual({ titel: 'Badsanierung', kunde_id: kundeBecker, geplant_ab: montag });
			const einsaetze = await root`select benutzer_id from app.einsaetze where auftrag_id = ${id} order by beginn, benutzer_id`;
			expect(einsaetze.map((e) => e.benutzer_id).sort()).toEqual([u.ids.monteurA, mehmetId].sort());
			const protokoll = await root`
				select tabelle, quelle, benutzer_id from app.aenderungen
				where (tabelle = 'auftraege' and datensatz_id = ${id})
					or (tabelle = 'einsaetze' and datensatz_id in (select id from app.einsaetze where auftrag_id = ${id}))`;
			expect(protokoll).toHaveLength(3);
			for (const p of protokoll) expect(p).toMatchObject({ quelle: 'sprache', benutzer_id: u.ids.bueroA });
			// Zweites Mal derselbe Vorschlag → 409, nichts doppelt
			const nochmal = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag });
			expect(nochmal.status).toBe(409);
			expect(await anzahl('auftraege')).toBe(vorher.auftraege + 1);
		} finally {
			await root`delete from app.abwesenheiten`;
		}
	});

	it('Änderungen über die Oberfläche bleiben quelle=oberflaeche', async () => {
		const kd = await legeKundeAn({ betriebId: u.betriebA, benutzerId: u.ids.bueroA }, { art: 'privat', nachname: 'Oberfläche' });
		const [p] = await root`select quelle from app.aenderungen where tabelle = 'kunden' and datensatz_id = ${kd.id}`;
		expect(p.quelle).toBe('oberflaeche');
	});

	it('Kunde, To-do, Termin, Verschieben über den Vorschlag', async () => {
		const kunde = await text(u.bueroA, { text: 'Neuer Kunde Eva Schulz aus Hamburg' });
		const k = await ausfuehren(u.bueroA, { vorschlag: kunde.koerper.vorschlag });
		expect(k.status).toBe(201);
		expect(k.koerper.meldung).toBe('Kunde „Eva Schulz“ angelegt');
		const [schulz] = await root`select id, ort from app.kunden where nachname = 'Schulz' and betrieb_id = ${u.betriebA}`;
		expect(schulz.ort).toBe('Hamburg');
		expect(k.koerper.link).toBe(`/kunden/${schulz.id}`);

		const todo = await text(u.bueroA, { text: 'Neues To-do für Mehmet: Silikonfuge erneuern, bis Freitag' });
		const t = await ausfuehren(u.bueroA, { vorschlag: todo.koerper.vorschlag });
		expect(t.status).toBe(201);
		const [td] = await root`select zustaendig_id, to_char(faellig, 'YYYY-MM-DD') as faellig from app.todos where titel = 'Silikonfuge erneuern'`;
		expect(td).toEqual({ zustaendig_id: mehmetId, faellig: naechster(4) });

		const [auftrag] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${u.betriebA}, 'Dachrinne', ${kundeBecker}) returning id`;
		try {
			const termin = await text(u.bueroA, { text: 'Termin bei Becker Dachrinne morgen 8 Uhr mit Ali' });
			const e = await ausfuehren(u.bueroA, { vorschlag: termin.koerper.vorschlag });
			expect(e.status).toBe(201);
			const [einsatz] = await root`select id, beginn, ende from app.einsaetze where auftrag_id = ${auftrag.id}`;
			const morgen = tagPlus(berlinTag(new Date()), 1);
			expect(berlinTag(new Date(einsatz.beginn))).toBe(morgen);
			expect(new Date(einsatz.ende).getTime() - new Date(einsatz.beginn).getTime()).toBe(8 * 3600_000);

			const schieben = await text(u.bueroA, { text: 'Verschiebe den Termin bei Becker Dachrinne auf übermorgen um 10 Uhr' });
			const s = await ausfuehren(u.bueroA, { vorschlag: schieben.koerper.vorschlag });
			expect(s.status).toBe(200);
			const [neu] = await root`select beginn, ende from app.einsaetze where id = ${einsatz.id}`;
			expect(berlinTag(new Date(neu.beginn))).toBe(tagPlus(berlinTag(new Date()), 2));
			expect(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(neu.beginn))).toBe('10:00');
			expect(new Date(neu.ende).getTime() - new Date(neu.beginn).getTime()).toBe(8 * 3600_000);
			const [prot] = await root`select quelle from app.aenderungen where tabelle = 'einsaetze' and datensatz_id = ${einsatz.id} and aktion = 'geaendert'`;
			expect(prot.quelle).toBe('sprache');
		} finally {
			await root`delete from app.auftraege where id = ${auftrag.id}`;
		}
	});

	it('Auswahl bei Mehrdeutigkeit: nur angebotene Option, sonst 400; ohne Auswahl 400', async () => {
		const v = await text(u.bueroA, { text: 'Neuer Auftrag Fliesen Küche bei Müller' });
		const vorher = await anzahl('auftraege');
		const ohne = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag });
		expect(ohne.status).toBe(400);
		expect(ohne.koerper.fehler).toBe('Bitte wählen: Meinen Sie Kunde Müller in Norderstedt oder in Hamburg?');
		const fremd = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag, auswahl: { kunde: kundeBecker } });
		expect(fremd.status).toBe(400);
		const unbekanntesFeld = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag, auswahl: { kunde: kundeHamburg, preis: '1' } });
		expect(unbekanntesFeld.status).toBe(400);
		expect(await anzahl('auftraege')).toBe(vorher);
		const ok = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag, auswahl: { kunde: kundeHamburg } });
		expect(ok.status).toBe(201);
		const [a] = await root`select kunde_id from app.auftraege where id = ${ok.koerper.link.split('/').at(-1)}`;
		expect(a.kunde_id).toBe(kundeHamburg);
	});

	it('Review Focus 2: manipulierter, fremder oder abgelaufener Vorschlag → 400/403, nichts gespeichert', async () => {
		const v = await text(u.bueroA, { text: 'Neuer Kunde Rita Manipuliert aus Kiel' });
		const token: string = v.koerper.vorschlag;
		const vorher = await anzahl('kunden');
		// fremder Benutzer, fremder Betrieb
		expect((await ausfuehren(u.chefA, { vorschlag: token })).status).toBe(403);
		expect((await ausfuehren(u.chefB, { vorschlag: token })).status).toBe(403);
		// geänderte Felder
		const [teil, sig] = token.split('.');
		const daten = JSON.parse(Buffer.from(teil, 'base64url').toString('utf8'));
		daten.vorschau.werte.kunde.nachname = 'Untergeschoben';
		expect((await ausfuehren(u.bueroA, { vorschlag: `${Buffer.from(JSON.stringify(daten)).toString('base64url')}.${sig}` })).status).toBe(400);
		// anderer Betrieb im Inhalt (ohne neue Signatur)
		daten.vorschau.werte.kunde.nachname = 'Manipuliert';
		daten.b = u.betriebB;
		expect((await ausfuehren(u.chefB, { vorschlag: `${Buffer.from(JSON.stringify(daten)).toString('base64url')}.${sig}` })).status).toBe(400);
		// abgelaufen (Uhr 11 Minuten vor)
		const echt = Date.now;
		Date.now = () => echt() + 11 * 60_000;
		try {
			const alt = await ausfuehren(u.bueroA, { vorschlag: token });
			expect(alt.status).toBe(400);
			expect(alt.koerper.fehler).toBe('Der Vorschlag ist abgelaufen – bitte noch einmal sprechen.');
		} finally {
			Date.now = echt;
		}
		// kaputt / fehlt / ohne Anmeldung
		expect((await ausfuehren(u.bueroA, { vorschlag: 'abc.def' })).status).toBe(400);
		expect((await ausfuehren(u.bueroA, {})).status).toBe(400);
		expect((await ausfuehren(null, { vorschlag: token })).status).toBe(401);
		expect(await anzahl('kunden')).toBe(vorher);
		// das Original funktioniert danach noch
		expect((await ausfuehren(u.bueroA, { vorschlag: token })).status).toBe(201);
		expect(await anzahl('kunden')).toBe(vorher + 1);
	});

	it('Rechte werden beim Ausführen erneut geprüft (Recht inzwischen entzogen → 403, nichts gespeichert)', async () => {
		const ohneKunden: Nutzer = { ...u.bueroA, rechte: u.bueroA.rechte.filter((r) => r !== 'kunden.bearbeiten') };
		const v = await text(u.bueroA, { text: 'Neuer Kunde Rudi Entzogen aus Kiel' });
		const vorher = await anzahl('kunden');
		const a = await ausfuehren(ohneKunden, { vorschlag: v.koerper.vorschlag });
		expect(a.status).toBe(403);
		expect(await anzahl('kunden')).toBe(vorher);
		// Plantafel-Recht fehlt beim Auftrag mit Mitarbeitern
		const ohnePlanen: Nutzer = { ...u.bueroA, rechte: u.bueroA.rechte.filter((r) => r !== 'plantafel.bearbeiten') };
		const w = await text(u.bueroA, { text: 'Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker' });
		const auftraegeVorher = await anzahl('auftraege');
		expect((await ausfuehren(ohnePlanen, { vorschlag: w.koerper.vorschlag })).status).toBe(403);
		expect(await anzahl('auftraege')).toBe(auftraegeVorher);
		// Karte für Nutzer ohne Planungsrecht: Hinweis statt Vorschlag
		const karte = await text(ohnePlanen, { text: 'Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker' });
		expect(karte.koerper.vorschlag).toBeNull();
		expect(karte.koerper.karte.fehler).toBe('Dafür fehlt Ihnen die Berechtigung (Mitarbeiter einplanen).');
	});

	it('Alles oder nichts: scheitert ein Einsatz (Mitarbeiter inzwischen deaktiviert), bleibt auch der Auftrag weg', async () => {
		const v = await text(u.bueroA, { text: 'Neuer Auftrag für Montag, Ali und Mehmet, Badsanierung bei Becker' });
		await root`update app.benutzer set aktiv = false where id = ${mehmetId}`;
		try {
			const vorher = { auftraege: await anzahl('auftraege'), einsaetze: await anzahl('einsaetze'), protokoll: await anzahl('aenderungen') };
			const a = await ausfuehren(u.bueroA, { vorschlag: v.koerper.vorschlag });
			expect(a.status).toBe(400);
			expect(a.koerper.fehler).toBe('Eingeplant werden kann nur ein aktiver Mitarbeiter des Betriebs.');
			expect(await anzahl('auftraege')).toBe(vorher.auftraege);
			expect(await anzahl('einsaetze')).toBe(vorher.einsaetze);
			expect(await anzahl('aenderungen')).toBe(vorher.protokoll);
		} finally {
			await root`update app.benutzer set aktiv = true where id = ${mehmetId}`;
		}
	});

	it('Review Focus 1: Monteur „Erstelle ein Angebot für Müller“ → Berechtigung fehlt, keine KI-Anfrage mit Katalog, nichts gespeichert', async () => {
		const vorher = await anzahl('angebote');
		const a = await text(u.monteurA, { text: 'Erstelle ein Angebot für Müller: 12 Quadratmeter Wandfliesen' });
		expect(a.status).toBe(200);
		expect(a.koerper.vorschlag).toBeNull();
		expect(a.koerper.karte.fehler).toBe('Dafür fehlt Ihnen die Berechtigung');
		expect(ki.entwurfAufrufe).toBe(0);
		expect(ki.letzterEntwurf).toBeNull();
		// selbst ein (z. B. vorher ausgestellter) Vorschlag hilft nicht: Ausführen prüft die Rechte vor dem Schreiben
		const token = signiere(
			{ aktion: 'angebot_entwurf', werte: { auftragId: u.auftragA, stichworte: '12 m² Fliesen' }, auswahl: [] },
			u.ids.monteurA,
			u.betriebA
		);
		const b = await ausfuehren(u.monteurA, { vorschlag: token });
		expect(b.status).toBe(403);
		expect(ki.entwurfAufrufe).toBe(0);
		expect(await anzahl('angebote')).toBe(vorher);
	});
});
