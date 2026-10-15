import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { GET as listeGet, POST as kundePost } from '../../src/routes/api/kunden/+server';
import { DELETE as kundeDelete, GET as kundeGet, PUT as kundePut } from '../../src/routes/api/kunden/[id]/+server';
import { GET as objekteGet, POST as objektPost } from '../../src/routes/api/kunden/[id]/objekte/+server';
import {
	DELETE as objektDelete,
	GET as objektGet,
	PUT as objektPut
} from '../../src/routes/api/kunden/[id]/objekte/[objektId]/+server';
import { GET as protokollGet } from '../../src/routes/api/protokoll/+server';
import { load as listeLoad } from '../../src/routes/(app)/kunden/+page.server';
import { actions as neuAktionen, load as neuLoad } from '../../src/routes/(app)/kunden/neu/+page.server';
import { actions as detailAktionen, load as detailLoad } from '../../src/routes/(app)/kunden/[id]/+page.server';
import {
	actions as bearbeitenAktionen,
	load as bearbeitenLoad
} from '../../src/routes/(app)/kunden/[id]/bearbeiten/+page.server';
import {
	actions as objektNeuAktionen,
	load as objektNeuLoad
} from '../../src/routes/(app)/kunden/[id]/objekte/neu/+page.server';
import {
	actions as objektSeiteAktionen,
	load as objektSeiteLoad
} from '../../src/routes/(app)/kunden/[id]/objekte/[objektId]/+page.server';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const jsonAnfrage = (methode: string, koerper?: unknown, typ: string | null = 'application/json') =>
	new Request('http://localhost/api/kunden', {
		method: methode,
		headers: typ ? { 'content-type': typ } : {},
		body: koerper === undefined ? undefined : typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
	});

const formAnfrage = (felder: Record<string, string | string[]>) => {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(felder)) for (const w of Array.isArray(v) ? v : [v]) body.append(k, w);
	return new Request('http://localhost/kunden', { method: 'POST', body });
};

const UNBEKANNT = '11111111-1111-4111-8111-111111111111';

describe('Kunden und Objekte', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string, betriebC: string;
	let chefAId: string, monteurAId: string, chefBId: string, chefCId: string;
	let chefA: Nutzer, monteurA: Nutzer, chefB: Nutzer, chefC: Nutzer, admin: Nutzer;

	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

	const liste = async (nutzer: Nutzer | null, suche?: string) => {
		const url = new URL('http://localhost/api/kunden');
		if (suche !== undefined) url.searchParams.set('suche', suche);
		return antwort(await listeGet({ locals: { nutzer }, url } as never));
	};
	const post = async (nutzer: Nutzer | null, koerper: unknown, typ?: string | null) =>
		antwort(await kundePost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper, typ) } as never));
	const get = async (nutzer: Nutzer | null, id: string) =>
		antwort(await kundeGet({ locals: { nutzer }, params: { id } } as never));
	const put = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await kundePut({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PUT', koerper) } as never));
	const del = async (nutzer: Nutzer | null, id: string) =>
		antwort(await kundeDelete({ locals: { nutzer }, params: { id } } as never));

	const objekte = async (nutzer: Nutzer | null, id: string) =>
		antwort(await objekteGet({ locals: { nutzer }, params: { id } } as never));
	const objektAnlegen = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await objektPost({ locals: { nutzer }, params: { id }, request: jsonAnfrage('POST', koerper) } as never));
	const objektHolen = async (nutzer: Nutzer | null, id: string, objektId: string) =>
		antwort(await objektGet({ locals: { nutzer }, params: { id, objektId } } as never));
	const objektAendern = async (nutzer: Nutzer | null, id: string, objektId: string, koerper: unknown) =>
		antwort(
			await objektPut({ locals: { nutzer }, params: { id, objektId }, request: jsonAnfrage('PUT', koerper) } as never)
		);
	const objektLoeschen = async (nutzer: Nutzer | null, id: string, objektId: string) =>
		antwort(await objektDelete({ locals: { nutzer }, params: { id, objektId } } as never));

	const protokoll = async (nutzer: Nutzer | null, tabelle: string, datensatz: string) => {
		const url = new URL('http://localhost/api/protokoll');
		url.searchParams.set('tabelle', tabelle);
		url.searchParams.set('datensatz', datensatz);
		return antwort(await protokollGet({ locals: { nutzer }, url } as never));
	};

	/** Legt direkt (Superuser) einen Kunden an, ohne die API. */
	const seedKunde = async (betrieb: string, felder: Record<string, unknown> = {}) => {
		const f = { art: 'privat', nachname: 'Mustermann', ...felder } as Record<string, any>;
		const [k] = await root`
			insert into app.kunden (betrieb_id, art, firma, vorname, nachname, email, telefon, ort)
			values (${betrieb}, ${f.art}, ${f.firma ?? null}, ${f.vorname ?? null}, ${f.nachname ?? null},
				${f.email ?? null}, ${f.telefon ?? null}, ${f.ort ?? null})
			returning id`;
		return k.id as string;
	};
	const seedObjekt = async (betrieb: string, kunde: string, bezeichnung = 'Einfamilienhaus') => {
		const [o] = await root`
			insert into app.objekte (betrieb_id, kunde_id, bezeichnung) values (${betrieb}, ${kunde}, ${bezeichnung})
			returning id`;
		return o.id as string;
	};

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		const [ohne] = await root`
			insert into app.tarife (schluessel, name, module, grenzen) values ('ohne-kunden', 'Ohne Kunden', ${['auftraege']}, '{}')
			returning id`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebC }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb C', ${ohne.id}, 'aktiv') returning id`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]}) returning id`)[0]
				.id as string;
		const benutzer = async (betrieb: string, rolleId: string, email: string, name: string) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betrieb}, ${email}, ${name}, 'x', ${rolleId}) returning id`)[0].id as string;
		chefAId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test', 'Chef A');
		monteurAId = await benutzer(
			betriebA,
			await rolle(betriebA, 'Monteur', VORLAGEN.monteur),
			'monteur-a@beispiel.test',
			'Monteur A'
		);
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test', 'Chef B');
		chefCId = await benutzer(betriebC, await rolle(betriebC, 'Chef', VORLAGEN.chef), 'chef-c@beispiel.test', 'Chef C');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		monteurA = nutzerVon(monteurAId, betriebA, VORLAGEN.monteur);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
		chefC = nutzerVon(chefCId, betriebC, VORLAGEN.chef);
		admin = nutzerVon('22222222-2222-4222-8222-222222222222', null, [], true);
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.kunden`;
		await root`delete from app.aenderungen where tabelle in ('kunden', 'objekte')`;
	});

	describe('Brief', () => {
		it('Privatkunde ohne Nachname → 400', async () => {
			const r = await post(chefA, { art: 'privat', vorname: 'Max' });
			expect(r.status).toBe(400);
			expect(r.koerper.fehler).toMatch(/Nachname/);
			expect(await root`select 1 from app.kunden`).toHaveLength(0);
		});

		it("Suche 'müller' findet 'Müller'", async () => {
			await seedKunde(betriebA, { nachname: 'Müller', vorname: 'Max' });
			await seedKunde(betriebA, { nachname: 'Schmidt' });
			const r = await liste(chefA, 'müller');
			expect(r.status).toBe(200);
			expect(r.koerper.map((k: any) => k.nachname)).toEqual(['Müller']);
		});

		it('Suche nach Telefon-Teilstring findet Kunden', async () => {
			await seedKunde(betriebA, { nachname: 'Telefon', telefon: '0171 1234567' });
			await seedKunde(betriebA, { nachname: 'Anders', telefon: '089 999' });
			const r = await liste(chefA, '12345');
			expect(r.koerper.map((k: any) => k.nachname)).toEqual(['Telefon']);
		});

		it('Monteur GET 200, POST 403', async () => {
			await seedKunde(betriebA);
			expect((await liste(monteurA)).status).toBe(200);
			const r = await post(monteurA, { art: 'privat', nachname: 'Neu' });
			expect(r.status).toBe(403);
			expect(await root`select 1 from app.kunden where nachname = 'Neu'`).toHaveLength(0);
		});

		it('Kunde aus Betrieb B im Kontext A → 404', async () => {
			const idB = await seedKunde(betriebB, { nachname: 'Fremd' });
			expect((await get(chefA, idB)).status).toBe(404);
			expect((await put(chefA, idB, { nachname: 'Gehackt' })).status).toBe(404);
			expect((await del(chefA, idB)).status).toBe(404);
			const [z] = await root`select nachname from app.kunden where id = ${idB}`;
			expect(z.nachname).toBe('Fremd');
		});
	});

	describe('Anlegen, Lesen, Ändern, Löschen', () => {
		it('POST legt an (201), trimmt, setzt Betrieb aus der Sitzung und ignoriert betrieb_id/id im Körper', async () => {
			const r = await post(chefA, {
				art: 'privat',
				vorname: '  Max ',
				nachname: ' Müller  ',
				email: 'max@beispiel.test',
				plz: 'CH-8001',
				betrieb_id: betriebB,
				id: UNBEKANNT
			});
			expect(r.status).toBe(201);
			expect(r.koerper).toMatchObject({
				art: 'privat',
				vorname: 'Max',
				nachname: 'Müller',
				email: 'max@beispiel.test',
				plz: 'CH-8001',
				name: 'Max Müller'
			});
			expect(r.koerper.id).not.toBe(UNBEKANNT);
			expect(r.koerper).not.toHaveProperty('betrieb_id');
			const [z] = await root`select betrieb_id from app.kunden where id = ${r.koerper.id}`;
			expect(z.betrieb_id).toBe(betriebA);
		});

		it('Firmenkunde braucht Firmennamen; mit Firmenname 201', async () => {
			expect((await post(chefA, { art: 'firma', nachname: 'Ansprechpartner' })).status).toBe(400);
			const r = await post(chefA, { art: 'firma', firma: 'Dachbau GmbH', nachname: 'Frau Dach' });
			expect(r.status).toBe(201);
			expect(r.koerper).toMatchObject({ art: 'firma', firma: 'Dachbau GmbH', nachname: 'Frau Dach', name: 'Dachbau GmbH' });
		});

		it('Validierung: Längen, E-Mail, Typen, Art', async () => {
			const basis = { art: 'privat', nachname: 'Test' };
			const faelle: [string, unknown, RegExp][] = [
				['Name 201 Zeichen', { ...basis, nachname: 'x'.repeat(201) }, /höchstens 200/],
				['Notiz 2001 Zeichen', { ...basis, notiz: 'x'.repeat(2001) }, /höchstens 2000/],
				['E-Mail ohne @', { ...basis, email: 'kein-email' }, /E-Mail/],
				['Nachname als Zahl', { ...basis, nachname: 5 }, /Text/],
				['unbekannte Art', { art: 'verein', nachname: 'x' }, /Art/],
				['Art fehlt', { nachname: 'x' }, /Art/]
			];
			for (const [name, koerper, muster] of faelle) {
				const r = await post(chefA, koerper);
				expect(r.status, name).toBe(400);
				expect(r.koerper.fehler, name).toMatch(muster);
			}
			expect(await root`select 1 from app.kunden`).toHaveLength(0);
		});

		it('Grenzwerte werden angenommen (200 Zeichen Name, 2000 Zeichen Notiz)', async () => {
			const r = await post(chefA, { art: 'privat', nachname: 'x'.repeat(200), notiz: 'n'.repeat(2000) });
			expect(r.status).toBe(201);
		});

		it('ungültiges JSON → 400, falscher Content-Type → 415, Liste statt Objekt → 400', async () => {
			expect((await post(chefA, '{kaputt')).status).toBe(400);
			expect((await post(chefA, '{"art":"privat","nachname":"x"}', 'text/plain')).status).toBe(415);
			expect((await post(chefA, '{"art":"privat","nachname":"x"}', null)).status).toBe(415);
			expect((await post(chefA, [])).status).toBe(400);
		});

		it('GET /api/kunden/[id] liefert den Kunden; kaputte ID → 404', async () => {
			const id = await seedKunde(betriebA, { nachname: 'Lesbar' });
			const r = await get(monteurA, id);
			expect(r.status).toBe(200);
			expect(r.koerper).toMatchObject({ id, nachname: 'Lesbar' });
			expect((await get(chefA, 'kein-uuid')).status).toBe(404);
			expect((await get(chefA, UNBEKANNT)).status).toBe(404);
		});

		it('PUT ändert teilweise (Rest bleibt), validiert das Ergebnis und setzt geaendert', async () => {
			const r1 = await post(chefA, { art: 'privat', vorname: 'Max', nachname: 'Müller', ort: 'Köln' });
			const id = r1.koerper.id as string;
			const r2 = await put(chefA, id, { ort: '  Bonn ' });
			expect(r2.status).toBe(200);
			expect(r2.koerper).toMatchObject({ vorname: 'Max', nachname: 'Müller', ort: 'Bonn' });
			expect(new Date(r2.koerper.geaendert).getTime()).toBeGreaterThanOrEqual(new Date(r1.koerper.geaendert).getTime());
			// Nachname leeren bei Privat → 400, nichts geändert
			expect((await put(chefA, id, { nachname: '' })).status).toBe(400);
			// Art wechseln auf Firma ohne Firmenname → 400
			expect((await put(chefA, id, { art: 'firma' })).status).toBe(400);
			expect((await put(chefA, id, { art: 'firma', firma: 'Neu AG' })).status).toBe(200);
			const [z] = await root`select art, firma, ort from app.kunden where id = ${id}`;
			expect(z).toMatchObject({ art: 'firma', firma: 'Neu AG', ort: 'Bonn' });
		});

		it('PUT: betrieb_id/id im Körper werden ignoriert; leerer Körper → 400', async () => {
			const id = await seedKunde(betriebA);
			const r = await put(chefA, id, { nachname: 'Neu', betrieb_id: betriebB, id: UNBEKANNT });
			expect(r.status).toBe(200);
			const [z] = await root`select id, betrieb_id from app.kunden where nachname = 'Neu'`;
			expect(z).toMatchObject({ id, betrieb_id: betriebA });
			expect((await put(chefA, id, {})).status).toBe(400);
		});

		it('DELETE → 204, löscht auch die Objekte; zweites DELETE → 404', async () => {
			const id = await seedKunde(betriebA);
			await seedObjekt(betriebA, id);
			const r = await del(chefA, id);
			expect(r.status).toBe(204);
			expect(await root`select 1 from app.kunden`).toHaveLength(0);
			expect(await root`select 1 from app.objekte`).toHaveLength(0);
			expect((await del(chefA, id)).status).toBe(404);
		});
	});

	describe('Rechte, Tarif, Anmeldung', () => {
		it('ohne Anmeldung 401, Plattform-Admin ohne Betrieb 403', async () => {
			const id = await seedKunde(betriebA);
			for (const nutzer of [null, admin]) {
				const erwartet = nutzer ? 403 : 401;
				expect((await liste(nutzer)).status).toBe(erwartet);
				expect((await post(nutzer, { art: 'privat', nachname: 'x' })).status).toBe(erwartet);
				expect((await get(nutzer, id)).status).toBe(erwartet);
				expect((await put(nutzer, id, { ort: 'x' })).status).toBe(erwartet);
				expect((await del(nutzer, id)).status).toBe(erwartet);
				expect((await objekte(nutzer, id)).status).toBe(erwartet);
				expect((await objektAnlegen(nutzer, id, { bezeichnung: 'x' })).status).toBe(erwartet);
			}
		});

		it('Monteur (nur kunden.lesen): Lesen ok, jedes Schreiben 403, Daten unverändert', async () => {
			const id = await seedKunde(betriebA, { nachname: 'Unberührt' });
			const oid = await seedObjekt(betriebA, id);
			expect((await get(monteurA, id)).status).toBe(200);
			expect((await objekte(monteurA, id)).status).toBe(200);
			expect((await objektHolen(monteurA, id, oid)).status).toBe(200);
			expect((await put(monteurA, id, { ort: 'x' })).status).toBe(403);
			expect((await del(monteurA, id)).status).toBe(403);
			expect((await objektAnlegen(monteurA, id, { bezeichnung: 'x' })).status).toBe(403);
			expect((await objektAendern(monteurA, id, oid, { bezeichnung: 'x' })).status).toBe(403);
			expect((await objektLoeschen(monteurA, id, oid)).status).toBe(403);
			expect(await root`select 1 from app.kunden where nachname = 'Unberührt' and ort is null`).toHaveLength(1);
			expect(await root`select 1 from app.objekte where bezeichnung = 'Einfamilienhaus'`).toHaveLength(1);
		});

		it('Nutzer mit nur kunden.bearbeiten (ohne lesen) darf nicht lesen', async () => {
			const schreiber = nutzerVon(chefAId, betriebA, ['kunden.bearbeiten']);
			expect((await liste(schreiber)).status).toBe(403);
		});

		it('Betrieb ohne Modul kunden → 402 mit tarifMit, überall', async () => {
			const r = await liste(chefC);
			expect(r.status).toBe(402);
			expect(r.koerper.tarifMit).toEqual(expect.arrayContaining(['basis']));
			expect((await post(chefC, { art: 'privat', nachname: 'x' })).status).toBe(402);
			expect((await get(chefC, UNBEKANNT)).status).toBe(402);
			expect((await put(chefC, UNBEKANNT, { ort: 'x' })).status).toBe(402);
			expect((await del(chefC, UNBEKANNT)).status).toBe(402);
			expect((await objekte(chefC, UNBEKANNT)).status).toBe(402);
			expect((await objektAnlegen(chefC, UNBEKANNT, { bezeichnung: 'x' })).status).toBe(402);
			expect((await objektHolen(chefC, UNBEKANNT, UNBEKANNT)).status).toBe(402);
			expect((await objektAendern(chefC, UNBEKANNT, UNBEKANNT, { bezeichnung: 'x' })).status).toBe(402);
			expect((await objektLoeschen(chefC, UNBEKANNT, UNBEKANNT)).status).toBe(402);
		});

		it('Protokoll-API für kunden/objekte prüft zusätzlich das Modul (402), Recht zuerst (403)', async () => {
			expect((await protokoll(chefC, 'kunden', UNBEKANNT)).status).toBe(402);
			expect((await protokoll(chefC, 'objekte', UNBEKANNT)).status).toBe(402);
			const ohneRecht = nutzerVon(chefCId, betriebC, ['auftraege.lesen']);
			expect((await protokoll(ohneRecht, 'kunden', UNBEKANNT)).status).toBe(403);
			// andere Tabellen sind vom Modul unabhängig
			expect((await protokoll(chefC, 'rollen', UNBEKANNT)).status).toBe(200);
			// mit Modul: Monteur (kunden.lesen) darf lesen
			expect((await protokoll(monteurA, 'kunden', UNBEKANNT)).status).toBe(200);
		});
	});

	describe('Suche', () => {
		it('ist unabhängig von Groß-/Kleinschreibung, Umlaute bleiben erhalten', async () => {
			await seedKunde(betriebA, { nachname: 'Müller' });
			await seedKunde(betriebA, { nachname: 'Mueller' });
			await seedKunde(betriebA, { nachname: 'Öztürk', ort: 'ÜBERLINGEN' });
			expect((await liste(chefA, 'MÜLLER')).koerper.map((k: any) => k.nachname)).toEqual(['Müller']);
			expect((await liste(chefA, 'müller')).koerper.map((k: any) => k.nachname)).toEqual(['Müller']);
			expect((await liste(chefA, 'öZtÜrK')).koerper).toHaveLength(1);
			expect((await liste(chefA, 'überlingen')).koerper).toHaveLength(1);
			expect((await liste(chefA, 'mueller')).koerper.map((k: any) => k.nachname)).toEqual(['Mueller']);
		});

		it('durchsucht Firma, Vorname, Nachname, Ort, Telefon und E-Mail', async () => {
			await seedKunde(betriebA, { art: 'firma', firma: 'Zimmerei Holzwurm', nachname: null });
			await seedKunde(betriebA, { vorname: 'Berta', nachname: 'Bauer', ort: 'Passau', email: 'berta@grün.test' });
			for (const [suche, anzahl] of [
				['holzwurm', 1],
				['berta', 1],
				['bauer', 1],
				['passau', 1],
				['grün.test', 1],
				['zzz', 0]
			] as const) {
				expect((await liste(chefA, suche)).koerper, suche).toHaveLength(anzahl);
			}
		});

		it('mehrere Wörter müssen alle (in beliebigen Feldern) vorkommen', async () => {
			await seedKunde(betriebA, { vorname: 'Max', nachname: 'Müller', ort: 'Köln' });
			await seedKunde(betriebA, { vorname: 'Max', nachname: 'Schmidt', ort: 'Köln' });
			expect((await liste(chefA, 'max müller')).koerper).toHaveLength(1);
			expect((await liste(chefA, 'köln max')).koerper).toHaveLength(2);
			expect((await liste(chefA, 'max bonn')).koerper).toHaveLength(0);
		});

		it('Telefonsuche ignoriert Leerzeichen und Striche in der Nummer', async () => {
			await seedKunde(betriebA, { nachname: 'Tel', telefon: '+49 (171) 123-45 67' });
			expect((await liste(chefA, '1234567')).koerper).toHaveLength(1);
			expect((await liste(chefA, '123-45')).koerper).toHaveLength(1);
			expect((await liste(chefA, '7654')).koerper).toHaveLength(0);
		});

		it('LIKE-Platzhalter in der Eingabe wirken nicht (% _ \\)', async () => {
			await seedKunde(betriebA, { nachname: 'Normal' });
			await seedKunde(betriebA, { nachname: 'Prozent%Mann' });
			await seedKunde(betriebA, { nachname: 'Unter_Strich' });
			await seedKunde(betriebA, { nachname: 'Rück\\Schlag' });
			expect((await liste(chefA, '%')).koerper.map((k: any) => k.nachname)).toEqual(['Prozent%Mann']);
			expect((await liste(chefA, '_')).koerper.map((k: any) => k.nachname)).toEqual(['Unter_Strich']);
			expect((await liste(chefA, 'N_rmal')).koerper).toHaveLength(0);
			expect((await liste(chefA, 'N%l')).koerper).toHaveLength(0);
			expect((await liste(chefA, '\\')).koerper.map((k: any) => k.nachname)).toEqual(['Rück\\Schlag']);
			expect((await liste(chefA, 'Prozent%Mann')).koerper).toHaveLength(1);
			expect((await liste(chefA, 'Prozent_Mann')).koerper).toHaveLength(0);
		});

		it('höchstens 50 Treffer, nach Name sortiert (Firma nach Firmenname, Privat nach Nachname)', async () => {
			for (let i = 0; i < 60; i++) await seedKunde(betriebA, { nachname: `Kunde${String(i).padStart(2, '0')}` });
			const r = await liste(chefA);
			expect(r.koerper).toHaveLength(50);
			expect(r.koerper[0].nachname).toBe('Kunde00');
			expect(r.koerper[49].nachname).toBe('Kunde49');
			expect((await liste(chefA, 'kunde')).koerper).toHaveLength(50);
		});

		it('Sortierung gemischt: Firma und Privatkunden nach Name, Umlaute einsortiert', async () => {
			await seedKunde(betriebA, { art: 'firma', firma: 'Bau GmbH', nachname: null });
			await seedKunde(betriebA, { nachname: 'Ärmel' });
			await seedKunde(betriebA, { nachname: 'Zeller', vorname: 'Anna' });
			await seedKunde(betriebA, { nachname: 'Zeller', vorname: 'Adam' });
			const namen = (await liste(chefA)).koerper.map((k: any) => k.name);
			expect(namen).toEqual(['Ärmel', 'Bau GmbH', 'Adam Zeller', 'Anna Zeller']);
		});

		it('findet nur Kunden des eigenen Betriebs', async () => {
			await seedKunde(betriebA, { nachname: 'Meier' });
			await seedKunde(betriebB, { nachname: 'Meier' });
			expect((await liste(chefA, 'meier')).koerper).toHaveLength(1);
			expect((await liste(chefB, 'meier')).koerper).toHaveLength(1);
			expect((await liste(chefA)).koerper).toHaveLength(1);
		});

		it('zu langer Suchbegriff → 400; leere Suche liefert Liste', async () => {
			expect((await liste(chefA, 'x'.repeat(101))).status).toBe(400);
			await seedKunde(betriebA);
			expect((await liste(chefA, '   ')).koerper).toHaveLength(1);
		});

		it('SQL-Einschleusung in der Suche ist wirkungslos', async () => {
			await seedKunde(betriebA, { nachname: "O'Brien" });
			expect((await liste(chefA, "'; drop table app.kunden; --")).koerper).toHaveLength(0);
			expect((await liste(chefA, "o'brien")).koerper).toHaveLength(1);
		});
	});

	describe('Objekte', () => {
		it('anlegen (201), auflisten, lesen, ändern, löschen', async () => {
			const kunde = await seedKunde(betriebA);
			const r1 = await objektAnlegen(chefA, kunde, {
				bezeichnung: ' Haus Nord ',
				strasse: 'Hauptstr. 1',
				plz: 'A-1010',
				ort: 'Wien',
				notiz: 'Schlüssel beim Nachbarn',
				betrieb_id: betriebB,
				kunde_id: UNBEKANNT
			});
			expect(r1.status).toBe(201);
			expect(r1.koerper).toMatchObject({ bezeichnung: 'Haus Nord', plz: 'A-1010', kundeId: kunde });
			const oid = r1.koerper.id as string;
			const [z] = await root`select betrieb_id, kunde_id from app.objekte where id = ${oid}`;
			expect(z).toMatchObject({ betrieb_id: betriebA, kunde_id: kunde });

			const l = await objekte(monteurA, kunde);
			expect(l.status).toBe(200);
			expect(l.koerper.map((o: any) => o.bezeichnung)).toEqual(['Haus Nord']);
			expect((await objektHolen(monteurA, kunde, oid)).koerper).toMatchObject({ id: oid, ort: 'Wien' });

			const r2 = await objektAendern(chefA, kunde, oid, { ort: 'Graz' });
			expect(r2.status).toBe(200);
			expect(r2.koerper).toMatchObject({ bezeichnung: 'Haus Nord', ort: 'Graz' });
			expect((await objektAendern(chefA, kunde, oid, { bezeichnung: '' })).status).toBe(400);

			expect((await objektLoeschen(chefA, kunde, oid)).status).toBe(204);
			expect((await objektHolen(chefA, kunde, oid)).status).toBe(404);
		});

		it('Validierung: Bezeichnung Pflicht, Längen', async () => {
			const kunde = await seedKunde(betriebA);
			expect((await objektAnlegen(chefA, kunde, {})).status).toBe(400);
			expect((await objektAnlegen(chefA, kunde, { bezeichnung: '  ' })).status).toBe(400);
			expect((await objektAnlegen(chefA, kunde, { bezeichnung: 'x'.repeat(201) })).status).toBe(400);
			expect((await objektAnlegen(chefA, kunde, { bezeichnung: 'x', notiz: 'n'.repeat(2001) })).status).toBe(400);
			expect((await objektAnlegen(chefA, kunde, { bezeichnung: 'x', ort: 12 })).status).toBe(400);
			expect(await root`select 1 from app.objekte`).toHaveLength(0);
		});

		it('Objekte eines Kunden stehen nicht unter einem anderen Kunden (gleicher Betrieb) → 404', async () => {
			const k1 = await seedKunde(betriebA, { nachname: 'Eins' });
			const k2 = await seedKunde(betriebA, { nachname: 'Zwei' });
			const o1 = await seedObjekt(betriebA, k1, 'Gehört Eins');
			expect((await objektHolen(chefA, k2, o1)).status).toBe(404);
			expect((await objektAendern(chefA, k2, o1, { bezeichnung: 'Umgezogen' })).status).toBe(404);
			expect((await objektLoeschen(chefA, k2, o1)).status).toBe(404);
			expect((await objekte(chefA, k2)).koerper).toEqual([]);
			expect((await objektHolen(chefA, k1, o1)).status).toBe(200);
			const [z] = await root`select bezeichnung, kunde_id from app.objekte where id = ${o1}`;
			expect(z).toMatchObject({ bezeichnung: 'Gehört Eins', kunde_id: k1 });
		});

		it('kunde_id eines Objekts lässt sich per PUT nicht ändern', async () => {
			const k1 = await seedKunde(betriebA);
			const k2 = await seedKunde(betriebA, { nachname: 'Zwei' });
			const o = await seedObjekt(betriebA, k1);
			await objektAendern(chefA, k1, o, { bezeichnung: 'Neu', kunde_id: k2, kundeId: k2 });
			const [z] = await root`select kunde_id from app.objekte where id = ${o}`;
			expect(z.kunde_id).toBe(k1);
		});

		it('mandantenfremd: alles → 404, nichts wird verändert', async () => {
			const kB = await seedKunde(betriebB, { nachname: 'Fremd' });
			const oB = await seedObjekt(betriebB, kB, 'Fremdes Haus');
			expect((await objekte(chefA, kB)).status).toBe(404);
			expect((await objektAnlegen(chefA, kB, { bezeichnung: 'Eingeschleust' })).status).toBe(404);
			expect((await objektHolen(chefA, kB, oB)).status).toBe(404);
			expect((await objektAendern(chefA, kB, oB, { bezeichnung: 'Gehackt' })).status).toBe(404);
			expect((await objektLoeschen(chefA, kB, oB)).status).toBe(404);
			// auch mit einem eigenen Kunden in der URL, aber fremder Objekt-ID
			const kA = await seedKunde(betriebA);
			expect((await objektHolen(chefA, kA, oB)).status).toBe(404);
			expect((await objektAendern(chefA, kA, oB, { bezeichnung: 'Gehackt' })).status).toBe(404);
			expect((await objektLoeschen(chefA, kA, oB)).status).toBe(404);
			expect(await root`select 1 from app.objekte where bezeichnung = 'Fremdes Haus'`).toHaveLength(1);
			expect(await root`select 1 from app.objekte where betrieb_id = ${betriebA}`).toHaveLength(0);
		});

		it('kaputte IDs → 404', async () => {
			const kunde = await seedKunde(betriebA);
			expect((await objekte(chefA, 'x')).status).toBe(404);
			expect((await objektHolen(chefA, kunde, 'x')).status).toBe(404);
			expect((await objektAnlegen(chefA, UNBEKANNT, { bezeichnung: 'x' })).status).toBe(404);
		});
	});

	describe('Datenbank: Mandantentrennung (RLS) und Rechte', () => {
		it('beide Tabellen: RLS aktiv und erzwungen', async () => {
			const z = await root`
				select relname, relrowsecurity, relforcerowsecurity from pg_class
				where relnamespace = 'app'::regnamespace and relname in ('kunden', 'objekte') order by relname`;
			expect(z).toMatchObject([
				{ relname: 'kunden', relrowsecurity: true, relforcerowsecurity: true },
				{ relname: 'objekte', relrowsecurity: true, relforcerowsecurity: true }
			]);
			const p = await root`
				select tablename, policyname, qual, with_check from pg_policies
				where schemaname = 'app' and tablename in ('kunden', 'objekte')`;
			expect(p).toHaveLength(2);
			for (const pol of p) {
				// pg_policies zeigt den normalisierten Ausdruck (mit ::text-Casts)
				const strikt = /betrieb_id = \(NULLIF\(current_setting\('app\.betrieb_id'::text, true\), ''::text\)\)::uuid/i;
				expect(pol.qual).toMatch(strikt);
				expect(pol.with_check).toMatch(strikt);
			}
		});

		it('crm_app sieht ohne Betriebskontext nichts und im Kontext nur den eigenen Betrieb', async () => {
			const a = await seedKunde(betriebA);
			await seedKunde(betriebB);
			await seedObjekt(betriebA, a);
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				expect(await app`select 1 from app.kunden`).toHaveLength(0);
				expect(await app`select 1 from app.objekte`).toHaveLength(0);
			} finally {
				await app.end();
			}
			const sichtbar = await alsApp(betriebA, chefAId, (tx) => tx`select betrieb_id from app.kunden`);
			expect(sichtbar.map((z) => z.betrieb_id)).toEqual([betriebA]);
		});

		it('Einfügen mit fremder betrieb_id scheitert (WITH CHECK)', async () => {
			await expect(
				alsApp(
					betriebA,
					chefAId,
					(tx) => tx`insert into app.kunden (betrieb_id, art, nachname) values (${betriebB}, 'privat', 'Fremd')`
				)
			).rejects.toMatchObject({ code: '42501' });
		});

		it('Ändern und Löschen fremder Zeilen trifft nichts', async () => {
			const idB = await seedKunde(betriebB);
			const u = await alsApp(betriebA, chefAId, (tx) => tx`update app.kunden set ort = 'x' where id = ${idB} returning id`);
			const d = await alsApp(betriebA, chefAId, (tx) => tx`delete from app.kunden where id = ${idB} returning id`);
			expect(u).toHaveLength(0);
			expect(d).toHaveLength(0);
		});

		it('crm_app darf betrieb_id und id nicht ändern (Spaltenrechte)', async () => {
			const idA = await seedKunde(betriebA);
			const oA = await seedObjekt(betriebA, idA);
			for (const sql of [
				(tx: postgres.TransactionSql) => tx`update app.kunden set betrieb_id = ${betriebB} where id = ${idA}`,
				(tx: postgres.TransactionSql) => tx`update app.kunden set id = ${UNBEKANNT} where id = ${idA}`,
				(tx: postgres.TransactionSql) => tx`update app.objekte set betrieb_id = ${betriebB} where id = ${oA}`,
				(tx: postgres.TransactionSql) => tx`update app.objekte set kunde_id = ${idA} where id = ${oA}`
			]) {
				await expect(alsApp(betriebA, chefAId, sql)).rejects.toMatchObject({ code: '42501' });
			}
		});

		it('Objekt kann nicht auf einen Kunden eines anderen Betriebs zeigen (zusammengesetzter Fremdschlüssel)', async () => {
			const kB = await seedKunde(betriebB);
			// Eigener Betrieb in der Zeile, fremder Kunde: der Fremdschlüssel (kunde_id, betrieb_id) findet keinen Treffer.
			await expect(
				alsApp(
					betriebA,
					chefAId,
					(tx) => tx`insert into app.objekte (betrieb_id, kunde_id, bezeichnung) values (${betriebA}, ${kB}, 'x')`
				)
			).rejects.toMatchObject({ code: '23503' });
			// Auch der Superuser kommt nicht daran vorbei.
			await expect(
				root`insert into app.objekte (betrieb_id, kunde_id, bezeichnung) values (${betriebA}, ${kB}, 'x')`
			).rejects.toMatchObject({ code: '23503' });
			expect(await root`select 1 from app.objekte`).toHaveLength(0);
		});

		it('crm_admin und crm_auth haben keine Rechte auf kunden und objekte', async () => {
			for (const url of [db.urlAdmin, db.urlAuth]) {
				const s = postgres(url, { max: 1, onnotice: () => {} });
				try {
					for (const tabelle of ['kunden', 'objekte']) {
						await expect(s.unsafe(`select 1 from app.${tabelle}`)).rejects.toMatchObject({ code: '42501' });
						await expect(s.unsafe(`delete from app.${tabelle}`)).rejects.toMatchObject({ code: '42501' });
					}
				} finally {
					await s.end();
				}
			}
		});

		it('Check-Constraints in der Datenbank: Privat braucht Nachname, Firma braucht Firmenname, Art begrenzt', async () => {
			await expect(
				root`insert into app.kunden (betrieb_id, art) values (${betriebA}, 'privat')`
			).rejects.toMatchObject({ code: '23514' });
			await expect(
				root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'firma', 'Nur Nachname')`
			).rejects.toMatchObject({ code: '23514' });
			await expect(
				root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'verein', 'x')`
			).rejects.toMatchObject({ code: '23514' });
			await expect(
				root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', ${'x'.repeat(201)})`
			).rejects.toMatchObject({ code: '23514' });
		});

		it('Löschen eines Betriebs löscht dessen Kunden und Objekte', async () => {
			const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
			const [{ id: tmp }] = await root`
				insert into app.betriebe (name, tarif_id) values ('Temporär', ${premium.id}) returning id`;
			const k = await seedKunde(tmp);
			await seedObjekt(tmp, k);
			await root`delete from app.betriebe where id = ${tmp}`;
			expect(await root`select 1 from app.kunden where betrieb_id = ${tmp}`).toHaveLength(0);
			expect(await root`select 1 from app.objekte where betrieb_id = ${tmp}`).toHaveLength(0);
			await root`delete from app.aenderungen where betrieb_id = ${tmp}`;
		});
	});

	describe('Änderungsprotokoll', () => {
		it('Anlegen, Ändern, Löschen über die API stehen im Protokoll mit Benutzer und vorher/nachher', async () => {
			const r = await post(chefA, { art: 'privat', nachname: 'Müller', ort: 'Köln' });
			const id = r.koerper.id as string;
			await put(chefA, id, { ort: 'Bonn' });
			await del(chefA, id);
			const z = await root`select * from app.aenderungen where tabelle = 'kunden' and datensatz_id = ${id} order by id`;
			expect(z.map((e) => e.aktion)).toEqual(['angelegt', 'geaendert', 'geloescht']);
			expect(z.every((e) => e.benutzer_id === chefAId && e.betrieb_id === betriebA)).toBe(true);
			expect(z[1].vorher).toMatchObject({ ort: 'Köln' });
			expect(z[1].nachher).toMatchObject({ ort: 'Bonn' });
		});

		it('Objekte werden protokolliert, auch beim Löschen über den Kunden (Kaskade)', async () => {
			const k = (await post(chefA, { art: 'privat', nachname: 'M' })).koerper.id as string;
			const o = (await objektAnlegen(chefA, k, { bezeichnung: 'Haus' })).koerper.id as string;
			await del(chefA, k);
			const z = await root`select aktion, benutzer_id from app.aenderungen where tabelle = 'objekte' and datensatz_id = ${o} order by id`;
			expect(z.map((e) => e.aktion)).toEqual(['angelegt', 'geloescht']);
			expect(z[1].benutzer_id).toBe(chefAId);
		});

		it('jede Spalte ist protokolliert oder ausdrücklich ausgeschlossen (nur "geaendert" ist ausgeschlossen)', async () => {
			const k = await seedKunde(betriebA);
			const o = await seedObjekt(betriebA, k);
			for (const [tabelle, id] of [
				['kunden', k],
				['objekte', o]
			] as const) {
				const spalten = (
					await root`select column_name from information_schema.columns where table_schema = 'app' and table_name = ${tabelle}`
				).map((s) => s.column_name as string);
				const [e] = await root`
					select nachher from app.aenderungen where tabelle = ${tabelle} and datensatz_id = ${id} and aktion = 'angelegt'`;
				const protokolliert = Object.keys(e.nachher);
				for (const s of spalten) {
					expect(protokolliert.includes(s) !== ['geaendert'].includes(s), `${tabelle}.${s}`).toBe(true);
				}
			}
		});

		it('GET /api/protokoll liefert den Verlauf eines Kunden (Monteur darf lesen), nicht den eines fremden Betriebs', async () => {
			const r = await post(chefA, { art: 'privat', nachname: 'Verlauf' });
			const id = r.koerper.id as string;
			await put(chefA, id, { ort: 'Ulm' });
			const v = await protokoll(monteurA, 'kunden', id);
			expect(v.status).toBe(200);
			expect(v.koerper.eintraege.map((e: any) => e.aktion)).toEqual(['geaendert', 'angelegt']);
			expect(v.koerper.eintraege[0].benutzerName).toBe('Chef A');
			const fremd = await protokoll(chefB, 'kunden', id);
			expect(fremd.koerper.eintraege).toEqual([]);
		});

		it('geaendert wird bei jedem Update fortgeschrieben (Trigger), auch bei direktem SQL', async () => {
			const k = await seedKunde(betriebA);
			const [vorher] = await root`select geaendert from app.kunden where id = ${k}`;
			await new Promise((r) => setTimeout(r, 20));
			await alsApp(betriebA, chefAId, (tx) => tx`update app.kunden set ort = 'Neu' where id = ${k}`);
			const [nachher] = await root`select geaendert from app.kunden where id = ${k}`;
			expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
		});
	});

	describe('Seiten', () => {
		const ort = (nutzer: Nutzer | null) => ({ locals: { nutzer } });

		it('Liste: Suche aus ?suche=, Treffer, Monteur sieht sie auch; Gast → Weiterleitung; Modul fehlt → 402', async () => {
			await seedKunde(betriebA, { nachname: 'Müller' });
			await seedKunde(betriebA, { nachname: 'Schmidt' });
			const url = new URL('http://localhost/kunden?suche=m%C3%BCller');
			const d = (await listeLoad({ ...ort(monteurA), url } as never)) as any;
			expect(d.suche).toBe('müller');
			expect(d.kunden.map((k: any) => k.nachname)).toEqual(['Müller']);
			expect(d.darfBearbeiten).toBe(false);
			expect(((await listeLoad({ ...ort(chefA), url: new URL('http://localhost/kunden') } as never)) as any).darfBearbeiten).toBe(true);
			await expect(listeLoad({ ...ort(null), url } as never)).rejects.toMatchObject({ status: 303, location: '/anmelden' });
			await expect(listeLoad({ ...ort(chefC), url } as never)).rejects.toMatchObject({ status: 402 });
			await expect(listeLoad({ ...ort(admin), url } as never)).rejects.toMatchObject({ status: 403 });
		});

		it('Neu: Anlegen leitet auf die Detailseite weiter; Fehler bleiben mit Eingaben sichtbar; Monteur 403', async () => {
			await expect(
				neuAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage({ art: 'privat', vorname: 'Max', nachname: 'Müller', plz: 'CH-8001' })
				} as never)
			).rejects.toMatchObject({ status: 303 });
			const [k] = await root`select id, plz, betrieb_id from app.kunden where nachname = 'Müller'`;
			expect(k).toMatchObject({ plz: 'CH-8001', betrieb_id: betriebA });

			const fehler = (await neuAktionen.anlegen({
				...ort(chefA),
				request: formAnfrage({ art: 'privat', vorname: 'Nur Vorname' })
			} as never)) as any;
			expect(fehler.status).toBe(400);
			expect(fehler.data.fehler).toMatch(/Nachname/);
			expect(fehler.data.werte).toMatchObject({ art: 'privat', vorname: 'Nur Vorname' });

			const verboten = (await neuAktionen.anlegen({
				...ort(monteurA),
				request: formAnfrage({ art: 'privat', nachname: 'Neu' })
			} as never)) as any;
			expect(verboten.status).toBe(403);
			await expect(neuLoad(ort(monteurA) as never)).rejects.toMatchObject({ status: 403 });
			expect(await root`select 1 from app.kunden where nachname = 'Neu'`).toHaveLength(0);
		});

		it('Detail: Kunde, Objekte und Verlauf; fremder Kunde → 404; Monteur darf lesen, nicht bearbeiten', async () => {
			const r = await post(chefA, { art: 'privat', nachname: 'Detail', ort: 'Köln' });
			const id = r.koerper.id as string;
			await put(chefA, id, { ort: 'Bonn' });
			await objektAnlegen(chefA, id, { bezeichnung: 'Haus am See' });
			const d = (await detailLoad({ ...ort(monteurA), params: { id } } as never)) as any;
			expect(d.kunde).toMatchObject({ id, nachname: 'Detail', ort: 'Bonn' });
			expect(d.objekte.map((o: any) => o.bezeichnung)).toEqual(['Haus am See']);
			expect(d.verlauf.map((v: any) => v.titel)).toEqual(['Geändert', 'Angelegt']);
			expect(d.verlauf[0].aenderungen).toEqual([{ feld: 'Ort', alt: 'Köln', neu: 'Bonn' }]);
			expect(d.verlauf[0].wer).toBe('Chef A');
			expect(d.darfBearbeiten).toBe(false);

			const idB = await seedKunde(betriebB);
			await expect(detailLoad({ ...ort(chefA), params: { id: idB } } as never)).rejects.toMatchObject({ status: 404 });
			await expect(detailLoad({ ...ort(chefA), params: { id: 'kaputt' } } as never)).rejects.toMatchObject({ status: 404 });
			await expect(detailLoad({ ...ort(chefC), params: { id } } as never)).rejects.toMatchObject({ status: 402 });
		});

		it('Detail: Löschen (Chef) leitet zur Liste; Monteur 403; fremder Kunde 404', async () => {
			const id = await seedKunde(betriebA);
			const idB = await seedKunde(betriebB);
			expect(((await detailAktionen.loeschen({ ...ort(monteurA), params: { id } } as never)) as any).status).toBe(403);
			expect(((await detailAktionen.loeschen({ ...ort(chefA), params: { id: idB } } as never)) as any).status).toBe(404);
			await expect(detailAktionen.loeschen({ ...ort(chefA), params: { id } } as never)).rejects.toMatchObject({
				status: 303,
				location: '/kunden'
			});
			expect(await root`select 1 from app.kunden`).toHaveLength(1);
		});

		it('Bearbeiten: Laden, Speichern, Validierungsfehler, Monteur 403, fremder Kunde 404', async () => {
			const id = await seedKunde(betriebA, { nachname: 'Alt' });
			const idB = await seedKunde(betriebB);
			const l = (await bearbeitenLoad({ ...ort(chefA), params: { id } } as never)) as any;
			expect(l.kunde.nachname).toBe('Alt');
			await expect(bearbeitenLoad({ ...ort(monteurA), params: { id } } as never)).rejects.toMatchObject({ status: 403 });
			await expect(bearbeitenLoad({ ...ort(chefA), params: { id: idB } } as never)).rejects.toMatchObject({ status: 404 });

			await expect(
				bearbeitenAktionen.speichern({
					...ort(chefA),
					params: { id },
					request: formAnfrage({ art: 'privat', nachname: 'Neu', ort: 'Ulm' })
				} as never)
			).rejects.toMatchObject({ status: 303, location: `/kunden/${id}` });
			expect((await root`select nachname, ort from app.kunden where id = ${id}`)[0]).toMatchObject({
				nachname: 'Neu',
				ort: 'Ulm'
			});
			const fehler = (await bearbeitenAktionen.speichern({
				...ort(chefA),
				params: { id },
				request: formAnfrage({ art: 'privat', nachname: '' })
			} as never)) as any;
			expect(fehler.status).toBe(400);
			expect(fehler.data.werte).toMatchObject({ art: 'privat', nachname: '' });
			const fremd = (await bearbeitenAktionen.speichern({
				...ort(chefA),
				params: { id: idB },
				request: formAnfrage({ art: 'privat', nachname: 'Gehackt' })
			} as never)) as any;
			expect(fremd.status).toBe(404);
			expect((await root`select nachname from app.kunden where id = ${idB}`)[0].nachname).toBe('Mustermann');
		});

		it('Objekt-Seiten: Anlegen, Bearbeiten, Löschen; Objekt unter falschem/fremdem Kunden → 404', async () => {
			const k1 = await seedKunde(betriebA, { nachname: 'Eins' });
			const k2 = await seedKunde(betriebA, { nachname: 'Zwei' });
			const kB = await seedKunde(betriebB);
			await expect(
				objektNeuAktionen.anlegen({
					...ort(chefA),
					params: { id: k1 },
					request: formAnfrage({ bezeichnung: 'Neubau', ort: 'Wien' })
				} as never)
			).rejects.toMatchObject({ status: 303, location: `/kunden/${k1}` });
			const [o] = await root`select id, kunde_id from app.objekte where bezeichnung = 'Neubau'`;
			expect(o.kunde_id).toBe(k1);

			const fehler = (await objektNeuAktionen.anlegen({
				...ort(chefA),
				params: { id: k1 },
				request: formAnfrage({ bezeichnung: '' })
			} as never)) as any;
			expect(fehler.status).toBe(400);
			const fremd = (await objektNeuAktionen.anlegen({
				...ort(chefA),
				params: { id: kB },
				request: formAnfrage({ bezeichnung: 'Eingeschleust' })
			} as never)) as any;
			expect(fremd.status).toBe(404);
			await expect(objektNeuLoad({ ...ort(monteurA), params: { id: k1 } } as never)).rejects.toMatchObject({ status: 403 });
			await expect(objektNeuLoad({ ...ort(chefA), params: { id: kB } } as never)).rejects.toMatchObject({ status: 404 });

			const l = (await objektSeiteLoad({ ...ort(chefA), params: { id: k1, objektId: o.id } } as never)) as any;
			expect(l.objekt.bezeichnung).toBe('Neubau');
			expect(l.kunde.id).toBe(k1);
			await expect(
				objektSeiteLoad({ ...ort(chefA), params: { id: k2, objektId: o.id } } as never)
			).rejects.toMatchObject({ status: 404 });

			await expect(
				objektSeiteAktionen.speichern({
					...ort(chefA),
					params: { id: k1, objektId: o.id },
					request: formAnfrage({ bezeichnung: 'Umbau', ort: 'Graz' })
				} as never)
			).rejects.toMatchObject({ status: 303, location: `/kunden/${k1}` });
			expect((await root`select bezeichnung, ort from app.objekte where id = ${o.id}`)[0]).toMatchObject({
				bezeichnung: 'Umbau',
				ort: 'Graz'
			});
			const falsch = (await objektSeiteAktionen.speichern({
				...ort(chefA),
				params: { id: k2, objektId: o.id },
				request: formAnfrage({ bezeichnung: 'Gehackt' })
			} as never)) as any;
			expect(falsch.status).toBe(404);
			expect(
				((await objektSeiteAktionen.loeschen({ ...ort(monteurA), params: { id: k1, objektId: o.id } } as never)) as any).status
			).toBe(403);
			await expect(
				objektSeiteAktionen.loeschen({ ...ort(chefA), params: { id: k1, objektId: o.id } } as never)
			).rejects.toMatchObject({ status: 303, location: `/kunden/${k1}` });
			expect(await root`select 1 from app.objekte`).toHaveLength(0);
		});
	});
});
