import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { holeAuftrag } from '../../src/lib/server/auftraege';
import { meineEinsaetzeHeute } from '../../src/lib/server/plantafel';
import { actions as auftragAktionen, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { listeKunden } from '../../src/lib/server/kunden';
import { POST as kundePost } from '../../src/routes/api/kunden/+server';
import { GET as kundeGet, PUT as kundePut } from '../../src/routes/api/kunden/[id]/+server';
import { load as listeLoad } from '../../src/routes/(app)/kunden/+page.server';
import { actions as neuAktionen, load as neuLoad } from '../../src/routes/(app)/kunden/neu/+page.server';
import { load as detailLoad } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { actions as bearbeitenAktionen } from '../../src/routes/(app)/kunden/[id]/bearbeiten/+page.server';

/**
 * Bevorzugter Kommunikationsweg am Kunden (Jamil, Talk msgs 4289/4291; Migration 115): E-Mail, Chat oder Telefon,
 * leer = keine Angabe. Datenbank-Check, Spaltenrecht, Änderungsprotokoll, API, Formulare, Liste mit Filter, Anzeige im
 * Auftrag – immer nur im eigenen Betrieb.
 */

type Ant = { status: number; koerper: any };
const nutzerVon = (id: string, betriebId: string, rechte: readonly string[]): Nutzer => ({
	id,
	betriebId,
	istAdmin: false,
	rechte: [...rechte],
	betriebStatus: 'aktiv'
});
async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}
const jsonAnfrage = (methode: string, koerper: unknown) =>
	new Request('http://localhost/api/kunden', { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper) });
const formAnfrage = (felder: Record<string, string>) =>
	new Request('http://localhost/kunden', { method: 'POST', body: new URLSearchParams(felder) });
const ort = (nutzer: Nutzer) => ({ locals: { nutzer } });

describe('Bevorzugter Kontaktweg', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefA: Nutzer, monteurA: Nutzer, chefB: Nutzer;

	const post = async (n: Nutzer, k: unknown) => antwort(await kundePost({ locals: { nutzer: n }, request: jsonAnfrage('POST', k) } as never));
	const get = async (n: Nutzer, id: string) => antwort(await kundeGet({ locals: { nutzer: n }, params: { id } } as never));
	const put = async (n: Nutzer, id: string, k: unknown) =>
		antwort(await kundePut({ locals: { nutzer: n }, params: { id }, request: jsonAnfrage('PUT', k) } as never));

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
		const benutzer = async (betrieb: string, vorlage: keyof typeof VORLAGEN, email: string) => {
			const [r] = await root`insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${vorlage}, ${[...VORLAGEN[vorlage]]}) returning id`;
			const [b] = await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id) values (${betrieb}, ${email}, ${email}, 'x', ${r.id}) returning id`;
			return nutzerVon(b.id, betrieb, VORLAGEN[vorlage]);
		};
		chefA = await benutzer(betriebA, 'chef', 'chef-a@kw.test');
		monteurA = await benutzer(betriebA, 'monteur', 'monteur-a@kw.test');
		chefB = await benutzer(betriebB, 'chef', 'chef-b@kw.test');
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.einsaetze`;
		await root`delete from app.auftraege`;
		await root`delete from app.kunden`;
	});

	it('Migration: Spalte ist optional (null = keine Angabe), die Datenbank lässt nur email/chat/telefon zu', async () => {
		const [spalte] = await root`
			select is_nullable, data_type from information_schema.columns
			where table_schema = 'app' and table_name = 'kunden' and column_name = 'bevorzugter_kontakt'`;
		expect(spalte).toMatchObject({ is_nullable: 'YES', data_type: 'text' });
		const [k] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Ohne') returning bevorzugter_kontakt`;
		expect(k.bevorzugter_kontakt).toBeNull();
		for (const w of ['email', 'chat', 'telefon']) {
			await root`insert into app.kunden (betrieb_id, art, nachname, bevorzugter_kontakt) values (${betriebA}, 'privat', ${w}, ${w})`;
		}
		await expect(
			root`insert into app.kunden (betrieb_id, art, nachname, bevorzugter_kontakt) values (${betriebA}, 'privat', 'Fax', 'fax')`
		).rejects.toMatchObject({ code: '23514' });
	});

	it('crm_app darf den Kontaktweg ändern – nur im eigenen Betrieb (RLS)', async () => {
		const [k] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Recht') returning id`;
		await mitBetrieb({ betriebId: betriebA, benutzerId: chefA.id }, (tx) => tx`update app.kunden set bevorzugter_kontakt = 'chat' where id = ${k.id}`);
		const fremd = await mitBetrieb({ betriebId: betriebB, benutzerId: chefB.id }, (tx) =>
			tx`update app.kunden set bevorzugter_kontakt = 'telefon' where id = ${k.id} returning id`
		);
		expect(fremd).toHaveLength(0);
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${k.id}`)[0].bevorzugter_kontakt).toBe('chat');
	});

	it('API: anlegen, lesen, ändern, leeren; ungültiger Wert → 400; Monteur darf lesen, nicht ändern; fremder Betrieb → 404', async () => {
		const neu = await post(chefA, { art: 'privat', nachname: 'Weg', bevorzugter_kontakt: 'chat' });
		expect(neu.status).toBe(201);
		expect(neu.koerper.bevorzugter_kontakt).toBe('chat');
		const id = neu.koerper.id as string;

		expect((await get(monteurA, id)).koerper.bevorzugter_kontakt).toBe('chat');
		expect((await put(chefA, id, { bevorzugter_kontakt: 'telefon' })).koerper.bevorzugter_kontakt).toBe('telefon');
		// andere Änderung lässt den Kontaktweg stehen
		expect((await put(chefA, id, { ort: 'Kiel' })).koerper).toMatchObject({ ort: 'Kiel', bevorzugter_kontakt: 'telefon' });
		expect((await put(chefA, id, { bevorzugter_kontakt: '' })).koerper.bevorzugter_kontakt).toBeNull();

		const falsch = await put(chefA, id, { bevorzugter_kontakt: 'fax' });
		expect(falsch.status).toBe(400);
		expect(falsch.koerper.fehler).toMatch(/Kontaktweg/);
		expect((await put(monteurA, id, { bevorzugter_kontakt: 'email' })).status).toBe(403);
		expect((await get(chefB, id)).status).toBe(404);
		expect((await put(chefB, id, { bevorzugter_kontakt: 'email' })).status).toBe(404);
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${id}`)[0].bevorzugter_kontakt).toBeNull();
	});

	it('Änderungsprotokoll: der Wechsel steht mit deutschem Feldnamen im Verlauf der Kundenakte', async () => {
		const id = (await post(chefA, { art: 'privat', nachname: 'Protokoll' })).koerper.id as string;
		await put(chefA, id, { bevorzugter_kontakt: 'email' });
		const [z] = await root`
			select vorher->>'bevorzugter_kontakt' as alt, nachher->>'bevorzugter_kontakt' as neu from app.aenderungen
			where tabelle = 'kunden' and datensatz_id = ${id} and aktion = 'geaendert'`;
		expect(z).toMatchObject({ alt: null, neu: 'email' });
		const d = (await detailLoad({ ...ort(chefA), params: { id } } as never)) as any;
		expect(d.kunde.bevorzugter_kontakt).toBe('email');
		expect(d.verlauf[0].aenderungen).toContainEqual({ feld: 'Bevorzugter Kontaktweg', alt: '–', neu: 'E-Mail' });
	});

	it('Formulare: Neu mit Auswahl, Bearbeiten wechselt bzw. leert; Vorbelegung aus der Adresse; Fehler behält Eingaben', async () => {
		await expect(
			neuAktionen.anlegen({ ...ort(chefA), request: formAnfrage({ art: 'privat', nachname: 'Formular', bevorzugter_kontakt: 'telefon' }) } as never)
		).rejects.toMatchObject({ status: 303 });
		const [k] = await root`select id, bevorzugter_kontakt from app.kunden where nachname = 'Formular'`;
		expect(k.bevorzugter_kontakt).toBe('telefon');

		await expect(
			bearbeitenAktionen.speichern({ ...ort(chefA), params: { id: k.id }, request: formAnfrage({ art: 'privat', nachname: 'Formular', bevorzugter_kontakt: 'chat' }) } as never)
		).rejects.toMatchObject({ status: 303 });
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${k.id}`)[0].bevorzugter_kontakt).toBe('chat');
		// Formular ohne Auswahl („Keine Angabe“) → null
		await expect(
			bearbeitenAktionen.speichern({ ...ort(chefA), params: { id: k.id }, request: formAnfrage({ art: 'privat', nachname: 'Formular', bevorzugter_kontakt: '' }) } as never)
		).rejects.toMatchObject({ status: 303 });
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${k.id}`)[0].bevorzugter_kontakt).toBeNull();

		const fehler = (await neuAktionen.anlegen({
			...ort(chefA),
			request: formAnfrage({ art: 'privat', nachname: 'X', bevorzugter_kontakt: 'brieftaube' })
		} as never)) as any;
		expect(fehler.status).toBe(400);
		expect(fehler.data.werte.bevorzugter_kontakt).toBe('brieftaube');

		const vor = (await neuLoad({ ...ort(chefA), url: new URL('http://localhost/kunden/neu?nachname=Neu&bevorzugter_kontakt=email') } as never)) as any;
		expect(vor.vorbelegt).toMatchObject({ nachname: 'Neu', bevorzugter_kontakt: 'email' });
	});

	it('Kundenliste: Kontaktweg in jeder Zeile, Filter ?kontakt= (auch „ohne“), unbekannter Filter = alle; nur eigener Betrieb', async () => {
		await root`insert into app.kunden (betrieb_id, art, nachname, bevorzugter_kontakt) values
			(${betriebA}, 'privat', 'Anna', 'email'), (${betriebA}, 'privat', 'Bert', 'chat'),
			(${betriebA}, 'privat', 'Carl', null), (${betriebB}, 'privat', 'Fremd', 'chat')`;
		const laden = async (q: string) => (await listeLoad({ ...ort(chefA), url: new URL(`http://localhost/kunden${q}`) } as never)) as any;
		const alle = await laden('');
		expect(alle.kunden.map((k: any) => [k.nachname, k.bevorzugter_kontakt])).toEqual([['Anna', 'email'], ['Bert', 'chat'], ['Carl', null]]);
		expect(alle.kontakt).toBeNull();
		expect((await laden('?kontakt=chat')).kunden.map((k: any) => k.nachname)).toEqual(['Bert']);
		expect((await laden('?kontakt=chat')).kontakt).toBe('chat');
		expect((await laden('?kontakt=ohne')).kunden.map((k: any) => k.nachname)).toEqual(['Carl']);
		expect((await laden('?kontakt=fax')).kunden).toHaveLength(3);
		expect((await laden('?kontakt=email&suche=bert')).kunden).toHaveLength(0);
		// Monteur (nur Lesen) sieht und filtert genauso
		expect(((await listeLoad({ ...ort(monteurA), url: new URL('http://localhost/kunden?kontakt=email') } as never)) as any).kunden.map((k: any) => k.nachname)).toEqual(['Anna']);
		// Service direkt: Betrieb B sieht nur seinen Kunden
		const b = await listeKunden({ betriebId: betriebB, benutzerId: chefB.id }, null, { kontaktweg: 'chat' });
		expect(b.map((k) => k.nachname)).toEqual(['Fremd']);
	});

	it('Auftrag zeigt den bevorzugten Kontaktweg seines Kunden (null ohne Kunde / ohne Angabe)', async () => {
		const [kd] = await root`insert into app.kunden (betrieb_id, art, nachname, bevorzugter_kontakt) values (${betriebA}, 'privat', 'Auftragskunde', 'telefon') returning id`;
		const [a] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Dachrinne', ${kd.id}) returning id`;
		const [ohne] = await root`insert into app.auftraege (betrieb_id, titel, einmal_name) values (${betriebA}, 'Einmal', 'Gast') returning id`;
		const k = { betriebId: betriebA, benutzerId: chefA.id };
		const sicht = { alle: true, benutzerId: chefA.id };
		expect((await holeAuftrag(k, sicht, a.id)).kontaktweg).toBe('telefon');
		expect((await holeAuftrag(k, sicht, ohne.id)).kontaktweg).toBeNull();
	});

	it('Auftrag: Kontaktweg direkt im Auftrag setzen (Jamil msg 4337) – speichert beim Kunden; Monteur/fremder Betrieb/ohne Kunde nicht', async () => {
		const [kd] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Inline') returning id`;
		const [a] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Bad', ${kd.id}) returning id`;
		const [einmal] = await root`insert into app.auftraege (betrieb_id, titel, einmal_name) values (${betriebA}, 'Einmal', 'Gast') returning id`;
		const setze = (n: Nutzer, id: string, w: string) =>
			auftragAktionen.kontaktweg({ ...ort(n), params: { id }, request: formAnfrage({ bevorzugter_kontakt: w }) } as never) as Promise<any>;

		const geladen = (await auftragLoad({ ...ort(chefA), params: { id: a.id }, url: new URL(`http://localhost/auftraege/${a.id}`) } as never)) as any;
		expect(geladen.darfKontaktweg).toBe(true);
		expect(geladen.auftrag.kontaktweg).toBeNull();

		expect(await setze(chefA, a.id, 'telefon')).toEqual({ kontaktwegGespeichert: true });
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${kd.id}`)[0].bevorzugter_kontakt).toBe('telefon');
		const [p] = await root`select nachher->>'bevorzugter_kontakt' as neu from app.aenderungen where tabelle = 'kunden' and datensatz_id = ${kd.id} and aktion = 'geaendert'`;
		expect(p.neu).toBe('telefon');
		expect((await setze(chefA, a.id, '')).kontaktwegGespeichert).toBe(true);
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${kd.id}`)[0].bevorzugter_kontakt).toBeNull();

		expect((await setze(chefA, a.id, 'fax')).status).toBe(400);
		expect((await setze(monteurA, a.id, 'chat')).status).toBe(403);
		expect((await setze(chefB, a.id, 'chat')).status).toBe(404);
		expect((await setze(chefA, einmal.id, 'chat')).status).toBe(400);
		expect((await root`select bevorzugter_kontakt from app.kunden where id = ${kd.id}`)[0].bevorzugter_kontakt).toBeNull();
	});

	it('Meine Einsätze heute: Kontaktweg des Kunden (auch „keine Angabe“), eigener Termin ohne Kunde', async () => {
		const [kd] = await root`insert into app.kunden (betrieb_id, art, nachname, bevorzugter_kontakt) values (${betriebA}, 'privat', 'Heute', 'chat') returning id`;
		const [ohne] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'OhneWeg') returning id`;
		const [a1] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Mit', ${kd.id}) returning id`;
		const [a2] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Ohne', ${ohne.id}) returning id`;
		const jetzt = new Date('2026-11-03T09:00:00Z');
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values
			(${betriebA}, ${a1.id}, ${monteurA.id}, '2026-11-03T07:00:00Z', '2026-11-03T08:00:00Z'),
			(${betriebA}, ${a2.id}, ${monteurA.id}, '2026-11-03T09:00:00Z', '2026-11-03T10:00:00Z')`;
		await root`insert into app.einsaetze (betrieb_id, benutzer_id, titel, beginn, ende) values
			(${betriebA}, ${monteurA.id}, 'Werkstatt', '2026-11-03T11:00:00Z', '2026-11-03T12:00:00Z')`;
		const liste = await meineEinsaetzeHeute({ betriebId: betriebA, benutzerId: monteurA.id }, monteurA.id, jetzt);
		expect(liste.map((e) => [e.auftragTitel, e.kundeImBestand, e.kontaktweg])).toEqual([
			['Mit', true, 'chat'],
			['Ohne', true, null],
			['Werkstatt', false, null]
		]);
	});
});
