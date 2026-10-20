import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { aendereTodo, legeTodoAn } from '../../src/lib/server/todos';
import { legeEinsatzAn, aendereEinsatz } from '../../src/lib/server/plantafel';
import {
	benachrichtigungen,
	markiereGelesen,
	setzeErinnerungen,
	setzePushSender,
	speicherePushAbo,
	stelleFaelligeZu,
	type PushNachricht
} from '../../src/lib/server/erinnerungen';
import { ausTagUndUhrzeit, berlinTag, tagPlus } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/** Erinnerungen (Jamil msg 2679): anlegen, nachziehen, Rechte, Zustellung (Glocke + Push), SSRF-Schutz. */
describe('Erinnerungen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const morgen = tagPlus(berlinTag(new Date()), 2);
	const gesendet: { endpoint: string; n: PushNachricht }[] = [];
	const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
	const zeiten = async (todoId: string) =>
		(await root`select minuten_vorher, zeitpunkt from app.erinnerungen where todo_id = ${todoId} order by zeitpunkt`).map((r) => [r.minuten_vorher, new Date(r.zeitpunkt).toISOString()]);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		setzePushSender(async (abo, n) => {
			gesendet.push({ endpoint: abo.endpoint, n });
			return { status: 201 };
		});
	});
	afterAll(async () => {
		setzePushSender(null);
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.erinnerungen`;
		await root`delete from app.push_abos`;
		await root`delete from app.todos`;
		await root`delete from app.einsaetze`;
		await root`update app.rollen set rechte = array_append(rechte, 'erinnerungen.nutzen') where not ('erinnerungen.nutzen' = any (rechte))`;
		gesendet.length = 0;
	});

	it('Aufgabe mit Uhrzeit: 1 Tag und 1 Stunde vorher; Fälligkeit ändern → zieht nach; ohne Uhrzeit 8:00', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Material bestellen', faellig: morgen, faelligZeit: '10:00', erinnerung1: '1440', erinnerung2: '60' });
		expect(t.faelligZeit).toBe('10:00');
		const um = ausTagUndUhrzeit(morgen, '10:00').getTime();
		expect(await zeiten(t.id)).toEqual([
			[1440, new Date(um - 1440 * 60_000).toISOString()],
			[60, new Date(um - 60 * 60_000).toISOString()]
		]);
		await aendereTodo(kA(), t.id, { faelligZeit: '' });
		const acht = ausTagUndUhrzeit(morgen, '08:00').getTime();
		expect((await zeiten(t.id))[1]).toEqual([60, new Date(acht - 3_600_000).toISOString()]);
		// fester Zeitpunkt
		await aendereTodo(kA(), t.id, { erinnerung1: `zeit:${morgen}T07:15`, erinnerung2: '' });
		expect(await zeiten(t.id)).toEqual([[null, ausTagUndUhrzeit(morgen, '07:15').toISOString()]]);
	});

	it('Prüfungen: höchstens 2, „vorher“ braucht Fälligkeit, nicht in der Vergangenheit, Recht nötig', async () => {
		await expect(legeTodoAn(kA(), { titel: 'x', faellig: morgen, erinnerungen: [{ minuten: 1 }, { minuten: 2 }, { minuten: 3 }] })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'x', erinnerung1: '60' })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'x', erinnerung1: 'zeit:2020-01-01T08:00' })).rejects.toMatchObject({ status: 400 });
		await root`update app.rollen set rechte = array_remove(rechte, 'erinnerungen.nutzen')`;
		await expect(legeTodoAn(kA(), { titel: 'x', faellig: morgen, erinnerung1: '60' })).rejects.toMatchObject({ status: 403 });
		expect((await legeTodoAn(kA(), { titel: 'ohne', faellig: morgen, erinnerung1: '' })).titel).toBe('ohne'); // leer geht ohne Recht
	});

	it('Zustellung: fällig → Glocke + Push an erlaubte Geräte; erledigt bzw. ohne Recht → übersprungen; gelesen', async () => {
		await speicherePushAbo(kA(), { endpoint: FCM, keys: { p256dh: 'BPx'.padEnd(87, 'A'), auth: 'abcdefghij' } });
		await expect(speicherePushAbo(kA(), { endpoint: 'https://crm-db/x', keys: { p256dh: 'BPx'.padEnd(87, 'A'), auth: 'abcdefghij' } })).rejects.toMatchObject({ status: 400 });
		await expect(speicherePushAbo(kA(), { endpoint: 'https://169.254.169.254/x', keys: { p256dh: 'BPx'.padEnd(87, 'A'), auth: 'abcdefghij' } })).rejects.toMatchObject({ status: 400 });
		const t1 = await legeTodoAn(kA(), { titel: 'Material bestellen', faellig: morgen, faelligZeit: '10:00', erinnerung1: '60' });
		const t2 = await legeTodoAn(kA(), { titel: 'Schon erledigt', faellig: morgen, erinnerung1: '60' });
		await aendereTodo(kA(), t2.id, { erledigt: true });
		await root`update app.erinnerungen set zeitpunkt = now() - interval '1 minute'`;
		expect(await stelleFaelligeZu()).toEqual({ gesendet: 1, uebersprungen: 1 });
		expect(gesendet).toEqual([{ endpoint: FCM, n: { titel: 'Aufgabe: Material bestellen', text: expect.stringMatching(/^Fällig \w\w \d\d\.\d\d\. 10:00$/), link: '/todos' } }]);
		expect(await stelleFaelligeZu()).toEqual({ gesendet: 0, uebersprungen: 0 }); // nur einmal
		const b = await benachrichtigungen(kA());
		expect(b.ungelesen).toBe(1);
		expect(b.liste[0]).toMatchObject({ titel: 'Aufgabe: Material bestellen', gelesen: false });
		expect((await benachrichtigungen({ betriebId: u.betriebA, benutzerId: u.ids.bueroA })).ungelesen).toBe(0); // nur eigene
		await markiereGelesen(kA(), b.liste[0].id);
		expect((await benachrichtigungen(kA())).ungelesen).toBe(0);

		// Recht entzogen → übersprungen
		await legeTodoAn(kA(), { titel: 'Später', faellig: morgen, erinnerung1: '60' });
		await root`update app.erinnerungen set zeitpunkt = now() - interval '1 minute' where gesendet_am is null`;
		await root`update app.rollen set rechte = array_remove(rechte, 'erinnerungen.nutzen')`;
		expect(await stelleFaelligeZu()).toEqual({ gesendet: 0, uebersprungen: 1 });
	});

	it('Termin: Erinnerung relativ zum Beginn, zieht beim Verschieben mit; Text mit Auftrag; fremde Termine nur mit Recht', async () => {
		const e = await legeEinsatzAn(kA(), { auftragId: u.auftragA, benutzerId: u.ids.monteurA, beginn: ausTagUndUhrzeit(morgen, '14:00').toISOString(), ende: ausTagUndUhrzeit(morgen, '16:00').toISOString() });
		await mitBetrieb(kA(), (tx) => setzeErinnerungen(tx, kA(), { einsatzId: e.id }, [{ minuten: 1440 }, { minuten: 60 }], new Date(e.beginn)));
		await aendereEinsatz(kA(), e.id, { beginn: ausTagUndUhrzeit(morgen, '15:00').toISOString(), ende: ausTagUndUhrzeit(morgen, '16:00').toISOString() });
		const [r] = await root`select zeitpunkt from app.erinnerungen where einsatz_id = ${e.id} and minuten_vorher = 60`;
		expect(new Date(r.zeitpunkt).toISOString()).toBe(ausTagUndUhrzeit(morgen, '14:00').toISOString());
		await root`update app.erinnerungen set zeitpunkt = now() - interval '1 minute'`;
		expect(await stelleFaelligeZu()).toEqual({ gesendet: 2, uebersprungen: 0 });
		const b = await benachrichtigungen(kA());
		expect(b.liste[0]).toMatchObject({ titel: expect.stringMatching(/^Termin: Badsanierung/), link: `/auftraege/${u.auftragA}` });
	});

	it('Sprache: Aufgabe und Termin mit zwei Erinnerungen; eigener Termin (auch Monteur für sich); Rechte', async () => {
		setzeKiAnbieter(new FakeKi());
		const sag = async (nutzer: unknown, text: string) => {
			const k = await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never));
			return k.koerper as { vorschlag: string | null; karte: { fehler: string | null; zeilen: { label: string; wert: string }[] } };
		};
		const ausfuehren = async (nutzer: unknown, vorschlag: string) =>
			antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { vorschlag }) } as never));

		const t = await sag(u.chefA, 'Erstelle Aufgabe Material bestellen für übermorgen 10 Uhr, erinnere mich einen Tag vorher und eine Stunde vorher');
		expect(t.karte.fehler).toBeNull();
		expect(t.karte.zeilen.find((z) => z.label === '🔔 Erinnerung')?.wert).toMatch(/^1 Tag vorher .* und 1 Stunde vorher /);
		expect((await ausfuehren(u.chefA, t.vorschlag!)).status).toBe(201);
		const [todo] = await root`select id, to_char(faellig_zeit, 'HH24:MI') as zeit from app.todos where titel = 'Material bestellen'`;
		expect(todo.zeit).toBe('10:00');
		expect((await zeiten(todo.id)).map((z) => z[0])).toEqual([1440, 60]);

		const e = await sag(u.chefA, 'Termin bei Müller übermorgen 14 Uhr, erinnere mich einen Tag und eine Stunde vorher');
		expect(e.karte.fehler).toBeNull();
		expect((await ausfuehren(u.chefA, e.vorschlag!)).status).toBe(201);
		const [ein] = await root`select id, benutzer_id from app.einsaetze where auftrag_id = ${u.auftragA}`;
		expect(ein.benutzer_id).toBe(u.ids.chefA);
		expect(await root`select minuten_vorher from app.erinnerungen where einsatz_id = ${ein.id} order by zeitpunkt`).toEqual([{ minuten_vorher: 1440 }, { minuten_vorher: 60 }]);

		// Monteur: eigener Termin für sich – ja; Termin beim Kunden (Plantafel planen) – nein
		const z = await sag(u.monteurA, 'Kalendereintrag Zahnarzt übermorgen 9 Uhr, erinnere mich eine Stunde vorher');
		expect(z.karte.fehler).toBeNull();
		expect(z.karte.zeilen).toContainEqual({ label: 'Eigener Termin', wert: '📌 Zahnarzt' });
		expect((await ausfuehren(u.monteurA, z.vorschlag!)).status).toBe(201);
		const [zahn] = await root`select id, auftrag_id, titel, benutzer_id, to_char(beginn at time zone 'Europe/Berlin', 'HH24:MI') as b, to_char(ende at time zone 'Europe/Berlin', 'HH24:MI') as e from app.einsaetze where titel = 'Zahnarzt'`;
		expect(zahn).toMatchObject({ auftrag_id: null, benutzer_id: u.ids.monteurA, b: '09:00', e: '10:00' });
		expect(await root`select count(*)::int as n from app.erinnerungen where einsatz_id = ${zahn.id} and benutzer_id = ${u.ids.monteurA}`).toEqual([{ n: 1 }]);
		expect((await sag(u.monteurA, 'Termin bei Müller übermorgen 14 Uhr')).karte.fehler).toMatch(/Berechtigung/);
		// Erinnerung zum eigenen Termin wird zugestellt (Link auf den Tag im Kalender)
		await root`update app.erinnerungen set zeitpunkt = now() - interval '1 minute' where einsatz_id = ${zahn.id}`;
		await stelleFaelligeZu();
		const b = await benachrichtigungen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA });
		expect(b.liste[0]).toMatchObject({ titel: 'Termin: Zahnarzt', link: expect.stringMatching(/^\/plantafel\?ansicht=tag&tag=\d{4}-\d{2}-\d{2}$/) });
	});
});
