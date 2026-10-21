import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { schritteVorschau } from '../../src/lib/server/sprache/mehrschritt';
import { berlinTag, wochentag } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

/**
 * Mehrere Schritte in einem Satz (Jamil msg 2983): Vorschau je Schritt, Verweise auf neu angelegte Kunden/Aufträge,
 * einmal bestätigen, Schritte der Reihe nach; Abbruch beim ersten Fehler mit genauem Stand; Rechte je Schritt.
 */
describe('Sprache – mehrere Schritte', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const text = async (nutzer: Nutzer, befehl: string) =>
		antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text: befehl }) } as never));
	const ausfuehren = async (nutzer: Nutzer, vorschlag: string, auswahl?: Record<string, string>) =>
		antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { vorschlag, ...(auswahl ? { auswahl } : {}) }) } as never));
	const naechsterMontag = () => {
		const heute = berlinTag(new Date());
		const d = new Date(`${heute}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + (((0 - wochentag(heute) + 7) % 7) || 7));
		return d.toISOString().slice(0, 10);
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		setzeKiAnbieter(new FakeKi());
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Kunde → Auftrag → Termin: nummerierte Vorschau, ein Vorschlag, Schritte nutzen die neuen IDs', async () => {
		const r = await text(u.chefA, 'Leg Kunde Neumann an, mach einen Auftrag Dachrinne und plan Ali für Montag ein.');
		expect(r.status).toBe(200);
		const k = r.koerper.karte;
		expect(k.aktion).toBe('mehrere_schritte');
		expect(k.titel).toBe('3 Schritte');
		expect(k.fehler, JSON.stringify(k)).toBeNull();
		expect(k.schritte.map((s: any) => [s.nr, s.titel])).toEqual([
			[1, 'Kunde anlegen'],
			[2, 'Auftrag anlegen'],
			[3, 'Termin einplanen']
		]);
		expect(k.schritte[1].zeilen).toContainEqual({ label: 'Kunde', wert: 'Neumann (neu, Schritt 1)' });
		expect(k.schritte[2].zeilen).toContainEqual({ label: 'Auftrag', wert: '(neu, Schritt 2) Dachrinne – Neumann' });
		expect(r.koerper.vorschlag).toBeTruthy();
		// Noch nichts gespeichert
		expect(await root`select 1 from app.kunden where nachname = 'Neumann'`).toHaveLength(0);

		const a = await ausfuehren(u.chefA, r.koerper.vorschlag);
		expect(a.status, JSON.stringify(a.koerper)).toBe(201);
		expect(a.koerper.meldung).toBe('Alle 3 Schritte erledigt');
		expect(a.koerper.schritte.map((s: any) => s.status)).toEqual(['erledigt', 'erledigt', 'erledigt']);
		expect(a.koerper.fehlgeschlagen).toBeUndefined();
		const [kd] = await root`select id from app.kunden where nachname = 'Neumann' and betrieb_id = ${u.betriebA}`;
		const [auftrag] = await root`select id from app.auftraege where titel = 'Dachrinne' and kunde_id = ${kd.id}`;
		expect(auftrag).toBeTruthy();
		const einsaetze = await root`
			select benutzer_id, to_char(beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD') as tag from app.einsaetze where auftrag_id = ${auftrag.id}`;
		expect(einsaetze).toEqual([{ benutzer_id: u.ids.monteurA, tag: naechsterMontag() }]);
		// Änderungsprotokoll: alles mit Quelle Sprache
		const q = await root`select distinct quelle from app.aenderungen where datensatz_id in (${kd.id}, ${auftrag.id})`;
		expect(q.map((x) => x.quelle)).toEqual(['sprache']);
		// Derselbe Vorschlag nur einmal
		expect((await ausfuehren(u.chefA, r.koerper.vorschlag)).status).toBe(409);
	});

	it('Verweis über den Namen (wie echte KIs ihn oft liefern) statt „#1“', async () => {
		const { vorschau, karte } = await schritteVorschau(
			{ nutzer: u.chefA },
			{ betriebId: u.betriebA, benutzerId: u.ids.chefA },
			u.chefA,
			[
				{ aktion: 'kunde_anlegen', daten: { art: 'firma', firma: 'Zauberbau GmbH' } },
				{ aktion: 'auftrag_anlegen', daten: { titel: 'Hallendach', kunde: { name: 'Zauberbau' } } },
				{ aktion: 'todo_anlegen', daten: { titel: 'Material bestellen', auftrag: 'Hallendach' } }
			],
			new Date()
		);
		expect(karte.fehler, JSON.stringify(karte)).toBeNull();
		expect(vorschau!.schritte[1].werte.kundeId).toBe('$kunde:1');
		expect(vorschau!.schritte[2].werte.auftragId).toBe('$auftrag:2');
	});

	it('Auswahl je Schritt („2:kunde“) bei Mehrdeutigkeit', async () => {
		const [kiel] = await root`insert into app.kunden (betrieb_id, art, vorname, nachname, ort) values (${u.betriebA}, 'privat', 'Eva', 'Doppel', 'Kiel') returning id`;
		const [luebeck] = await root`insert into app.kunden (betrieb_id, art, vorname, nachname, ort) values (${u.betriebA}, 'privat', 'Tom', 'Doppel', 'Lübeck') returning id`;
		const r = await text(u.chefA, 'Leg Kunde Erster an und mach einen Auftrag Gartenzaun bei Doppel');
		const k = r.koerper.karte;
		expect(k.fehler, JSON.stringify(k)).toBeNull();
		expect(k.auswahl).toHaveLength(1);
		expect(k.auswahl[0].feld).toBe('2:kunde');
		expect(k.auswahl[0].frage).toMatch(/^Schritt 2: Meinen Sie Kunde Doppel/);
		expect((await ausfuehren(u.chefA, r.koerper.vorschlag)).status).toBe(400);
		expect((await ausfuehren(u.chefA, r.koerper.vorschlag, { kunde: luebeck.id })).status).toBe(400);
		const a = await ausfuehren(u.chefA, r.koerper.vorschlag, { '2:kunde': luebeck.id });
		expect(a.status, JSON.stringify(a.koerper)).toBe(201);
		const [g] = await root`select kunde_id from app.auftraege where titel = 'Gartenzaun'`;
		expect(g.kunde_id).toBe(luebeck.id);
		expect(kiel.id).not.toBe(luebeck.id);
	});

	it('Fehler in Schritt 2: Abbruch, Schritt 1 bleibt, Schritt 3 läuft nicht – mit genauem Stand', async () => {
		const auftrag = await u.neuerAuftrag('anfrage', 'Fliesenspiegel');
		const r = await text(u.chefA, 'Leg Kunde Erstmann an, setze Auftrag Fliesenspiegel auf beauftragt und leg Kunde Drittmann an');
		expect(r.koerper.karte.fehler, JSON.stringify(r.koerper.karte)).toBeNull();
		expect(r.koerper.karte.schritte).toHaveLength(3);
		// Zwischen Vorschau und Bestätigung verschwindet der Auftrag
		await root`delete from app.auftraege where id = ${auftrag}`;
		const a = await ausfuehren(u.chefA, r.koerper.vorschlag);
		expect(a.status).toBe(200);
		expect(a.koerper.fehlgeschlagen).toBe(true);
		expect(a.koerper.meldung).toBe('1 von 3 Schritten erledigt – Schritt 2 ist fehlgeschlagen, danach wurde abgebrochen');
		expect(a.koerper.schritte.map((s: any) => s.status)).toEqual(['erledigt', 'fehler', 'offen']);
		expect(a.koerper.schritte[1].meldung).toBeTruthy();
		expect(await root`select 1 from app.kunden where nachname = 'Erstmann'`).toHaveLength(1);
		expect(await root`select 1 from app.kunden where nachname = 'Drittmann'`).toHaveLength(0);
	});

	it('Rechte je Schritt: Monteur darf keinen Kunden anlegen → kein Vorschlag, Hinweis am Schritt', async () => {
		const r = await text(u.monteurA, 'Leg Kunde Verboten an und mach einen Auftrag Dach');
		expect(r.koerper.vorschlag).toBeNull();
		expect(r.koerper.karte.schritte[0].fehler).toMatch(/Berechtigung/);
		expect(r.koerper.karte.fehler).toMatch(/^Schritt 1: /);
		expect(await root`select 1 from app.kunden where nachname = 'Verboten'`).toHaveLength(0);
	});

	it('Rechte beim Ausführen: Rolle verliert ein Recht nach der Vorschau → nichts wird gespeichert (403)', async () => {
		const r = await text(u.bueroA, 'Leg Kunde Spaeter an und mach einen Auftrag Treppe');
		expect(r.koerper.vorschlag, JSON.stringify(r.koerper.karte)).toBeTruthy();
		const ohneAuftraege = { ...u.bueroA, rechte: u.bueroA.rechte.filter((x) => x !== 'auftraege.bearbeiten') };
		const a = await ausfuehren(ohneAuftraege, r.koerper.vorschlag);
		expect(a.status).toBe(403);
		expect(a.koerper.fehler).toMatch(/^Schritt 2/);
		expect(await root`select 1 from app.kunden where nachname = 'Spaeter'`).toHaveLength(0);
	});

	it('Mehr als 8 Schritte: freundlicher Hinweis, kein Vorschlag', async () => {
		const namen = ['Aal', 'Bach', 'Cord', 'Dorn', 'Eck', 'Fink', 'Gans', 'Hahn', 'Igel'];
		const r = await text(u.chefA, namen.map((n) => `leg Kunde ${n} an`).join(', '));
		expect(r.koerper.vorschlag).toBeNull();
		expect(r.koerper.karte.fehler).toBe('Höchstens 8 Schritte auf einmal – bitte den Befehl aufteilen.');
	});
});
