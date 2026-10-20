import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listeQuellen } from '../../src/lib/server/quellen';
import { frischeTestDb, type TestDb } from './setup';
import { leereAngebote } from './hilfe-1c';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { berlinTag } from '../../src/lib/zeit';
import { ApiFehler } from '../../src/lib/server/fehler';
import {
	aendereAuftrag,
	holeAuftrag,
	legeAuftragAn,
	listeAuftraege,
	loescheAuftrag,
	setzeStatus,
	type Sicht
} from '../../src/lib/server/auftraege';
import { GET as listeGet, POST as auftragPost } from '../../src/routes/api/auftraege/+server';
import {
	DELETE as auftragDelete,
	GET as auftragGet,
	PATCH as auftragPatch
} from '../../src/routes/api/auftraege/[id]/+server';
import { POST as statusPost } from '../../src/routes/api/auftraege/[id]/status/+server';
import { GET as protokollGet } from '../../src/routes/api/protokoll/+server';
import { DELETE as kundeDelete } from '../../src/routes/api/kunden/[id]/+server';
import { load as listeLoad } from '../../src/routes/(app)/auftraege/+page.server';
import { actions as neuAktionen, load as neuLoad } from '../../src/routes/(app)/auftraege/neu/+page.server';
import { actions as detailAktionen, load as detailLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import {
	actions as bearbeitenAktionen,
	load as bearbeitenLoad
} from '../../src/routes/(app)/auftraege/[id]/bearbeiten/+page.server';
import { load as kundeDetailLoad } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { load as plantafelLoad } from '../../src/routes/(app)/plantafel/+page.server';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const UNBEKANNT = '11111111-1111-4111-8111-111111111111';

const jsonAnfrage = (methode: string, koerper?: unknown, typ: string | null = 'application/json') =>
	new Request('http://localhost/api/auftraege', {
		method: methode,
		headers: typ ? { 'content-type': typ } : {},
		body: koerper === undefined ? undefined : typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
	});

const formAnfrage = (felder: Record<string, string>) => {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(felder)) body.append(k, v);
	return new Request('http://localhost/auftraege', { method: 'POST', body });
};
const JAHR = berlinTag(new Date()).slice(0, 4);

describe('Aufträge und Aufgaben', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string, betriebC: string;
	let chefAId: string, monteurAId: string, monteur2AId: string, bueroAId: string, chefBId: string, chefCId: string;
	let chefA: Nutzer, monteurA: Nutzer, monteur2A: Nutzer, bueroA: Nutzer, chefB: Nutzer, chefC: Nutzer, admin: Nutzer;
	let kundeA: string, kunde2A: string, kundeB: string;
	let objektA: string, objekt2A: string, objektB: string;

	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

	const kA = () => ({ betriebId: betriebA, benutzerId: chefAId });
	const alle = (): Sicht => ({ alle: true, benutzerId: chefAId });
	const eigene = (id: string): Sicht => ({ alle: false, benutzerId: id });

	const liste = async (nutzer: Nutzer | null, params: Record<string, string> = {}) => {
		const url = new URL('http://localhost/api/auftraege');
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		return antwort(await listeGet({ locals: { nutzer }, url } as never));
	};
	const post = async (nutzer: Nutzer | null, koerper: unknown, typ?: string | null) =>
		antwort(await auftragPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper, typ) } as never));
	const get = async (nutzer: Nutzer | null, id: string) =>
		antwort(await auftragGet({ locals: { nutzer }, params: { id } } as never));
	const patch = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await auftragPatch({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PATCH', koerper) } as never));
	const del = async (nutzer: Nutzer | null, id: string) =>
		antwort(await auftragDelete({ locals: { nutzer }, params: { id } } as never));
	const status = async (nutzer: Nutzer | null, id: string, nach: unknown) =>
		antwort(
			await statusPost({ locals: { nutzer }, params: { id }, request: jsonAnfrage('POST', { status: nach }) } as never)
		);
	const protokoll = async (nutzer: Nutzer | null, tabelle: string, datensatz: string) => {
		const url = new URL('http://localhost/api/protokoll');
		url.searchParams.set('tabelle', tabelle);
		url.searchParams.set('datensatz', datensatz);
		return antwort(await protokollGet({ locals: { nutzer }, url } as never));
	};
	const seedTodo = async (betrieb: string, auftrag: string | null, zustaendig: string | null, titel = 'Material') =>
		(
			await root`
				insert into app.todos (betrieb_id, auftrag_id, titel, zustaendig_id)
				values (${betrieb}, ${auftrag}, ${titel}, ${zustaendig}) returning id`
		)[0].id as string;

	/** Auftrag direkt per SQL (als crm_app im Betriebskontext, damit die Nummer wie im Betrieb entsteht). */
	const sqlAuftrag = async (betrieb: string, benutzer: string, kunde: string, titel = 'Badsanierung', objekt: string | null = null) =>
		(
			await alsApp(
				betrieb,
				benutzer,
				(tx) => tx`
					insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id)
					values (${betrieb}, ${titel}, ${kunde}, ${objekt}) returning id, nummer, status`
			)
		)[0] as { id: string; nummer: string; status: string };

	const seedKunde = async (betrieb: string, nachname: string) =>
		(await root`insert into app.kunden (betrieb_id, art, nachname) values (${betrieb}, 'privat', ${nachname}) returning id`)[0]
			.id as string;
	const seedObjekt = async (betrieb: string, kunde: string, bezeichnung: string) =>
		(
			await root`
				insert into app.objekte (betrieb_id, kunde_id, bezeichnung, strasse, plz, ort)
				values (${betrieb}, ${kunde}, ${bezeichnung}, 'Hauptstraße 1', '20095', 'Hamburg') returning id`
		)[0].id as string;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		const [ohne] = await root`
			insert into app.tarife (schluessel, name, module, grenzen) values ('nur-kunden', 'Nur Kunden', ${['kunden']}, '{}')
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
		const monteurRolle = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		chefAId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test', 'Chef A');
		bueroAId = await benutzer(betriebA, await rolle(betriebA, 'Büro', VORLAGEN.buero), 'buero-a@beispiel.test', 'Büro A');
		monteurAId = await benutzer(betriebA, monteurRolle, 'monteur-a@beispiel.test', 'Ali Monteur');
		monteur2AId = await benutzer(betriebA, monteurRolle, 'monteur2-a@beispiel.test', 'Mehmet Monteur');
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test', 'Chef B');
		chefCId = await benutzer(betriebC, await rolle(betriebC, 'Chef', VORLAGEN.chef), 'chef-c@beispiel.test', 'Chef C');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		bueroA = nutzerVon(bueroAId, betriebA, VORLAGEN.buero);
		monteurA = nutzerVon(monteurAId, betriebA, VORLAGEN.monteur);
		monteur2A = nutzerVon(monteur2AId, betriebA, VORLAGEN.monteur);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
		chefC = nutzerVon(chefCId, betriebC, VORLAGEN.chef);
		admin = nutzerVon('22222222-2222-4222-8222-222222222222', null, [], true);
		kundeA = await seedKunde(betriebA, 'Müller');
		kunde2A = await seedKunde(betriebA, 'Schmidt');
		kundeB = await seedKunde(betriebB, 'Fremd');
		objektA = await seedObjekt(betriebA, kundeA, 'Haus Müller');
		objekt2A = await seedObjekt(betriebA, kunde2A, 'Haus Schmidt');
		objektB = await seedObjekt(betriebB, kundeB, 'Haus Fremd');
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.auftraege`;
		await root`delete from app.todos`;
		await root`delete from app.auftrag_nummern`;
		await root`delete from app.aenderungen where tabelle in ('auftraege', 'todos')`;
	});

	describe('Schema und Mandantentrennung', () => {
		it('vergibt Nummern je Betrieb und Jahr: A-2026-0001, A-2026-0002; Betrieb B beginnt wieder bei 0001', async () => {
			const a1 = await sqlAuftrag(betriebA, chefAId, kundeA);
			const a2 = await sqlAuftrag(betriebA, chefAId, kundeA, 'Fliesen');
			const b1 = await sqlAuftrag(betriebB, chefBId, kundeB);
			expect(a1.nummer).toBe(`A-${JAHR}-0001`);
			expect(a2.nummer).toBe(`A-${JAHR}-0002`);
			expect(b1.nummer).toBe(`A-${JAHR}-0001`);
			expect(a1.status).toBe('anfrage');
		});

		it('Nummernkreis: abgebrochene Transaktion hinterlässt keine Lücke; Nummer ist nicht wählbar oder änderbar', async () => {
			await expect(
				alsApp(betriebA, chefAId, async (tx) => {
					await tx`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'x', ${kundeA})`;
					throw new Error('Abbruch');
				})
			).rejects.toThrow('Abbruch');
			expect((await sqlAuftrag(betriebA, chefAId, kundeA)).nummer).toBe(`A-${JAHR}-0001`);
			await expect(
				alsApp(betriebA, chefAId, (tx) =>
					tx`insert into app.auftraege (betrieb_id, titel, kunde_id, nummer) values (${betriebA}, 'x', ${kundeA}, 'A-1')`
				)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.auftraege set nummer = 'A-1'`)
			).rejects.toMatchObject({ code: '42501' });
			// crm_app darf den Nummernkreis weder lesen noch die Funktion direkt aufrufen
			await expect(alsApp(betriebA, chefAId, (tx) => tx`select * from app.auftrag_nummern`)).rejects.toMatchObject({
				code: '42501'
			});
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`select app.naechste_auftragsnummer(${betriebB}::uuid)`)
			).rejects.toMatchObject({ code: '42501' });
		});

		it('Betrieb B sieht und ändert keine Aufträge/Aufgaben von A (RLS)', async () => {
			const a = await sqlAuftrag(betriebA, chefAId, kundeA);
			await root`insert into app.todos (betrieb_id, auftrag_id, titel) values (${betriebA}, ${a.id}, 'Material bestellen')`;
			const sicht = await alsApp(betriebB, chefBId, async (tx) => ({
				auftraege: await tx`select 1 from app.auftraege`,
				todos: await tx`select 1 from app.todos`,
				u: await tx`update app.auftraege set titel = 'Gehackt' returning id`,
				t: await tx`update app.todos set titel = 'Gehackt' returning id`,
				d: await tx`delete from app.auftraege returning id`
			}));
			expect(sicht.auftraege).toHaveLength(0);
			expect(sicht.todos).toHaveLength(0);
			expect(sicht.u).toHaveLength(0);
			expect(sicht.t).toHaveLength(0);
			expect(sicht.d).toHaveLength(0);
			expect(await root`select 1 from app.auftraege where titel = 'Badsanierung'`).toHaveLength(1);
			// ohne Kontext sieht crm_app nichts
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				expect(await app`select 1 from app.auftraege`).toHaveLength(0);
				expect(await app`select 1 from app.todos`).toHaveLength(0);
			} finally {
				await app.end();
			}
			// Einfügen mit fremder betrieb_id scheitert (WITH CHECK)
			await expect(
				alsApp(betriebB, chefBId, (tx) => tx`insert into app.todos (betrieb_id, titel) values (${betriebA}, 'x')`)
			).rejects.toMatchObject({ code: '42501' });
		});

		it('RLS aktiv und erzwungen; crm_admin und crm_auth ohne Zugriff', async () => {
			const z = await root`
				select relname, relrowsecurity, relforcerowsecurity from pg_class
				where relnamespace = 'app'::regnamespace and relname in ('auftraege', 'todos', 'auftrag_nummern') order by relname`;
			expect(z).toMatchObject([
				{ relname: 'auftraege', relrowsecurity: true, relforcerowsecurity: true },
				{ relname: 'auftrag_nummern', relrowsecurity: true, relforcerowsecurity: true },
				{ relname: 'todos', relrowsecurity: true, relforcerowsecurity: true }
			]);
			for (const url of [db.urlAdmin, db.urlAuth]) {
				const s = postgres(url, { max: 1, onnotice: () => {} });
				try {
					for (const tabelle of ['auftraege', 'todos', 'auftrag_nummern']) {
						await expect(s.unsafe(`select 1 from app.${tabelle}`)).rejects.toMatchObject({ code: '42501' });
					}
				} finally {
					await s.end();
				}
			}
		});

		it('Objekt eines anderen Kunden wird abgelehnt (23514)', async () => {
			await expect(sqlAuftrag(betriebA, chefAId, kundeA, 'x', objekt2A)).rejects.toMatchObject({ code: '23514' });
			const ok = await sqlAuftrag(betriebA, chefAId, kundeA, 'x', objektA);
			// auch beim Ändern
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.auftraege set kunde_id = ${kunde2A} where id = ${ok.id}`)
			).rejects.toMatchObject({ code: '23514' });
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.auftraege set objekt_id = ${objekt2A} where id = ${ok.id}`)
			).rejects.toMatchObject({ code: '23514' });
		});

		it('Kunde aus Betrieb B wird abgelehnt (23503)', async () => {
			await expect(sqlAuftrag(betriebA, chefAId, kundeB)).rejects.toMatchObject({ code: '23503' });
			await expect(
				root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'x', ${kundeB})`
			).rejects.toMatchObject({ code: '23503' });
			// fremdes Objekt (auch als Superuser nicht)
			await expect(
				root`insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id) values (${betriebB}, 'x', ${kundeB}, ${objektA})`
			).rejects.toMatchObject({ code: '23514' });
		});

		it('zustaendig_id aus anderem Betrieb wird abgelehnt (23503)', async () => {
			await expect(
				alsApp(betriebA, chefAId, (tx) =>
					tx`insert into app.todos (betrieb_id, titel, zustaendig_id) values (${betriebA}, 'x', ${chefBId})`
				)
			).rejects.toMatchObject({ code: '23503' });
			// Aufgabe an einem fremden Auftrag ebenso
			const b = await sqlAuftrag(betriebB, chefBId, kundeB);
			await expect(
				alsApp(betriebA, chefAId, (tx) =>
					tx`insert into app.todos (betrieb_id, titel, auftrag_id) values (${betriebA}, 'x', ${b.id})`
				)
			).rejects.toMatchObject({ code: '23503' });
		});

		it('Check-Constraints: Titel 1–200 Zeichen, Status nur aus der Kette, Beschreibung ≤ 4000', async () => {
			const faelle = [
				root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, '  ', ${kundeA})`,
				root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, ${'x'.repeat(201)}, ${kundeA})`,
				root`insert into app.auftraege (betrieb_id, titel, kunde_id, status) values (${betriebA}, 'x', ${kundeA}, 'erledigt')`,
				root`insert into app.auftraege (betrieb_id, titel, kunde_id, beschreibung) values (${betriebA}, 'x', ${kundeA}, ${'x'.repeat(4001)})`,
				root`insert into app.todos (betrieb_id, titel) values (${betriebA}, '')`,
				root`insert into app.todos (betrieb_id, titel) values (${betriebA}, ${'x'.repeat(201)})`
			];
			for (const f of faelle) await expect(f).rejects.toMatchObject({ code: '23514' });
		});

		it('Kunde mit Aufträgen lässt sich nicht löschen (Aufträge bleiben); Objekt löschen leert objekt_id', async () => {
			const a = await sqlAuftrag(betriebA, chefAId, kundeA, 'x', objektA);
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`delete from app.kunden where id = ${kundeA}`)
			).rejects.toMatchObject({ code: '23503' });
			const tmpObjekt = await seedObjekt(betriebA, kundeA, 'Abriss');
			await alsApp(betriebA, chefAId, (tx) => tx`update app.auftraege set objekt_id = ${tmpObjekt} where id = ${a.id}`);
			await alsApp(betriebA, chefAId, (tx) => tx`delete from app.objekte where id = ${tmpObjekt}`);
			const [z] = await root`select objekt_id, betrieb_id from app.auftraege where id = ${a.id}`;
			expect(z).toEqual({ objekt_id: null, betrieb_id: betriebA });
		});

		it('Auftrag löschen löscht seine Aufgaben (Kaskade)', async () => {
			const a = await sqlAuftrag(betriebA, chefAId, kundeA);
			await root`insert into app.todos (betrieb_id, auftrag_id, titel) values (${betriebA}, ${a.id}, 'x')`;
			await alsApp(betriebA, chefAId, (tx) => tx`delete from app.auftraege where id = ${a.id}`);
			expect(await root`select 1 from app.todos`).toHaveLength(0);
		});

		it('Änderung am Auftrag landet im Änderungsprotokoll', async () => {
			const a = await sqlAuftrag(betriebA, chefAId, kundeA);
			await alsApp(betriebA, chefAId, (tx) => tx`update app.auftraege set status = 'angebot' where id = ${a.id}`);
			const z = await root`
				select aktion, benutzer_id, vorher, nachher from app.aenderungen
				where tabelle = 'auftraege' and datensatz_id = ${a.id} order by id`;
			expect(z.map((e) => e.aktion)).toEqual(['angelegt', 'geaendert']);
			expect(z[1].benutzer_id).toBe(chefAId);
			expect(z[1].vorher).toMatchObject({ status: 'anfrage' });
			expect(z[1].nachher).toMatchObject({ status: 'angebot' });
			expect(z[0].nachher).toMatchObject({ nummer: `A-${JAHR}-0001` });
		});

		it('jede Spalte von auftraege und todos ist protokolliert oder ausgeschlossen (nur "geaendert")', async () => {
			const a = await sqlAuftrag(betriebA, chefAId, kundeA);
			const [t] = await root`insert into app.todos (betrieb_id, titel) values (${betriebA}, 'x') returning id`;
			for (const [tabelle, id] of [
				['auftraege', a.id],
				['todos', t.id]
			] as const) {
				const spalten = (
					await root`select column_name from information_schema.columns where table_schema = 'app' and table_name = ${tabelle}`
				).map((s) => s.column_name as string);
				const [e] = await root`
					select nachher from app.aenderungen where tabelle = ${tabelle} and datensatz_id = ${id} and aktion = 'angelegt'`;
				for (const s of spalten) {
					expect(Object.keys(e.nachher).includes(s) !== (s === 'geaendert'), `${tabelle}.${s}`).toBe(true);
				}
			}
		});
	});

	describe('Dienst', () => {
		it('legeAuftragAn liefert Status anfrage und Nummer A-<Jahr>-0001, Kunde und Objekt aufgelöst', async () => {
			const a = await legeAuftragAn(kA(), {
				titel: '  Badsanierung ',
				kundeId: kundeA,
				objektId: objektA,
				beschreibung: 'Wanne raus, Dusche rein',
				geplantAb: '2026-10-26'
			});
			expect(a).toMatchObject({
				nummer: `A-${JAHR}-0001`,
				status: 'anfrage',
				titel: 'Badsanierung',
				kundeId: kundeA,
				kundeName: 'Müller',
				objektId: objektA,
				objektBezeichnung: 'Haus Müller',
				beschreibung: 'Wanne raus, Dusche rein',
				geplantAb: '2026-10-26'
			});
		});

		it('Eingabeprüfung: Titel, Kunde, Objekt, Datum → 400', async () => {
			const basis = { titel: 'x', kundeId: kundeA };
			const faelle: [string, Record<string, unknown>, RegExp][] = [
				['Titel fehlt', { kundeId: kundeA }, /Titel/],
				['Titel leer', { ...basis, titel: '   ' }, /Titel/],
				['Titel 201', { ...basis, titel: 'x'.repeat(201) }, /höchstens 200/],
				['Kunde fehlt', { titel: 'x' }, /Kunde/],
				['Kunde kaputt', { ...basis, kundeId: 'kein-uuid' }, /Kunde/],
				['Kunde fremd', { ...basis, kundeId: kundeB }, /Kunde/],
				['Objekt kaputt', { ...basis, objektId: 'x' }, /Objekt/],
				['Objekt anderer Kunde', { ...basis, objektId: objekt2A }, /Objekt/],
				['Objekt fremd', { ...basis, objektId: objektB }, /Objekt/],
				['Datum kaputt', { ...basis, geplantAb: '2026-02-30' }, /Datum/],
				['Beschreibung 4001', { ...basis, beschreibung: 'x'.repeat(4001) }, /höchstens 4000/]
			];
			for (const [name, e, muster] of faelle) {
				const fehler = await legeAuftragAn(kA(), e).catch((x) => x);
				expect(fehler, name).toBeInstanceOf(ApiFehler);
				expect(fehler.status, name).toBe(400);
				expect(fehler.message, name).toMatch(muster);
			}
			expect(await root`select 1 from app.auftraege`).toHaveLength(0);
		});

		it('setzeStatus: anfrage→beauftragt 409, anfrage→angebot ok, zurück ok, unbekannt 400', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'x', kundeId: kundeA });
			const f = await setzeStatus(kA(), a.id, 'beauftragt').catch((x) => x);
			expect(f).toMatchObject({ status: 409, message: 'Statuswechsel nicht erlaubt' });
			expect((await setzeStatus(kA(), a.id, 'angebot')).status).toBe('angebot');
			expect((await setzeStatus(kA(), a.id, 'anfrage')).status).toBe('anfrage');
			expect(await setzeStatus(kA(), a.id, 'erledigt' as never).catch((x) => x.status)).toBe(400);
			expect(await setzeStatus(kA(), UNBEKANNT, 'angebot').catch((x) => x.status)).toBe(404);
		});

		it('setzeStatus mit Sprung (Statusleiste, msg 2581): beliebige Station, gleicher Status 409', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'x', kundeId: kundeA });
			const alle = { alle: true, benutzerId: kA().benutzerId };
			expect((await setzeStatus(kA(), a.id, 'in_arbeit', alle, { sprung: true })).status).toBe('in_arbeit');
			expect((await setzeStatus(kA(), a.id, 'anfrage', alle, { sprung: true })).status).toBe('anfrage');
			expect(await setzeStatus(kA(), a.id, 'anfrage', alle, { sprung: true }).catch((x) => x.status)).toBe(409);
		});

		it('loescheAuftrag: im Status angebot 409, als Anfrage ok, danach 404', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'x', kundeId: kundeA });
			await setzeStatus(kA(), a.id, 'angebot');
			expect(await loescheAuftrag(kA(), a.id).catch((x) => [x.status, x.message])).toEqual([
				409,
				'Nur Anfragen können gelöscht werden'
			]);
			await setzeStatus(kA(), a.id, 'anfrage');
			await loescheAuftrag(kA(), a.id);
			expect(await loescheAuftrag(kA(), a.id).catch((x) => x.status)).toBe(404);
		});

		it('Monteur (nur auftraege.lesen): sieht nur Aufträge mit eigenem Aufgabe; fremder Auftrag → 404', async () => {
			const mit = await legeAuftragAn(kA(), { titel: 'Mit Aufgabe', kundeId: kundeA });
			const ohne = await legeAuftragAn(kA(), { titel: 'Ohne', kundeId: kundeA });
			const anderer = await legeAuftragAn(kA(), { titel: 'Kollege', kundeId: kundeA });
			await seedTodo(betriebA, mit.id, monteurAId);
			await seedTodo(betriebA, anderer.id, monteur2AId);
			await seedTodo(betriebA, null, monteurAId); // allgemeines Aufgabe macht keinen Auftrag sichtbar
			const k = { betriebId: betriebA, benutzerId: monteurAId };
			expect((await listeAuftraege(k, eigene(monteurAId), {})).map((a) => a.titel)).toEqual(['Mit Aufgabe']);
			expect((await holeAuftrag(k, eigene(monteurAId), mit.id)).titel).toBe('Mit Aufgabe');
			for (const id of [ohne.id, anderer.id, UNBEKANNT, 'kaputt']) {
				expect(await holeAuftrag(k, eigene(monteurAId), id).catch((x) => x.status), id).toBe(404);
			}
			expect((await listeAuftraege(kA(), alle(), {})).map((a) => a.titel).sort()).toEqual(['Kollege', 'Mit Aufgabe', 'Ohne']);
		});

		it('Liste: Filter Status/Kunde, Suche über Nummer, Titel und Kundenname, neueste zuerst, höchstens 100', async () => {
			const a1 = await legeAuftragAn(kA(), { titel: 'Badsanierung', kundeId: kundeA });
			const a2 = await legeAuftragAn(kA(), { titel: 'Fliesen legen', kundeId: kunde2A });
			await setzeStatus(kA(), a2.id, 'angebot');
			const titel = async (f: Parameters<typeof listeAuftraege>[2]) =>
				(await listeAuftraege(kA(), alle(), f)).map((a) => a.titel);
			expect(await titel({})).toEqual(['Fliesen legen', 'Badsanierung']);
			expect(await titel({ status: 'angebot' })).toEqual(['Fliesen legen']);
			expect(await titel({ kundeId: kundeA })).toEqual(['Badsanierung']);
			expect(await titel({ suche: 'schmidt' })).toEqual(['Fliesen legen']);
			expect(await titel({ suche: 'BAD' })).toEqual(['Badsanierung']);
			expect(await titel({ suche: a1.nummer })).toEqual(['Badsanierung']);
			expect(await titel({ suche: 'müller fliesen' })).toEqual([]);
			expect(await titel({ suche: '%' })).toEqual([]);
			for (let i = 0; i < 101; i++) {
				await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, ${'Masse ' + i}, ${kundeA})`;
			}
			expect(await listeAuftraege(kA(), alle(), {})).toHaveLength(100);
		});
	});

	describe('API', () => {
		it('POST legt an (201), Betrieb aus der Sitzung, status/nummer im Körper werden ignoriert', async () => {
			const r = await post(chefA, {
				titel: 'Dach',
				kundeId: kundeA,
				status: 'abgerechnet',
				nummer: 'X-1',
				betrieb_id: betriebB
			});
			expect(r.status).toBe(201);
			expect(r.koerper).toMatchObject({ titel: 'Dach', status: 'anfrage', nummer: `A-${JAHR}-0001` });
			const [z] = await root`select betrieb_id from app.auftraege where id = ${r.koerper.id}`;
			expect(z.betrieb_id).toBe(betriebA);
			expect((await post(chefA, '{kaputt')).status).toBe(400);
			expect((await post(chefA, '{"titel":"x"}', 'text/plain')).status).toBe(415);
		});

		it('Büro ohne auftraege.bearbeiten → POST 403; Tarif ohne Modul auftraege → 402; Gast 401, Admin 403', async () => {
			const ohneBearbeiten = nutzerVon(
				bueroAId,
				betriebA,
				VORLAGEN.buero.filter((r) => r !== 'auftraege.bearbeiten')
			);
			expect((await post(ohneBearbeiten, { titel: 'x', kundeId: kundeA })).status).toBe(403);
			expect((await liste(ohneBearbeiten)).status).toBe(200);
			const r = await liste(chefC);
			expect(r.status).toBe(402);
			expect(r.koerper.tarifMit).toEqual(expect.arrayContaining(['basis']));
			expect((await post(chefC, { titel: 'x', kundeId: kundeA })).status).toBe(402);
			expect((await get(chefC, UNBEKANNT)).status).toBe(402);
			expect((await status(chefC, UNBEKANNT, 'angebot')).status).toBe(402);
			expect((await liste(null)).status).toBe(401);
			expect((await liste(admin)).status).toBe(403);
			// ohne jedes Auftragsrecht
			expect((await liste(nutzerVon(chefAId, betriebA, ['kunden.lesen']))).status).toBe(403);
		});

		it('Monteur: Liste nur eigene, fremder Auftrag GET 404, Schreiben 403', async () => {
			const meins = (await post(chefA, { titel: 'Meins', kundeId: kundeA })).koerper.id as string;
			const fremd = (await post(chefA, { titel: 'Fremd', kundeId: kundeA })).koerper.id as string;
			await seedTodo(betriebA, meins, monteurAId);
			expect((await liste(monteurA)).koerper.map((a: any) => a.titel)).toEqual(['Meins']);
			expect((await get(monteurA, meins)).status).toBe(200);
			expect((await get(monteurA, fremd)).status).toBe(404);
			expect((await patch(monteurA, meins, { titel: 'x' })).status).toBe(403);
			expect((await status(monteurA, meins, 'angebot')).status).toBe(403);
			expect((await del(monteurA, meins)).status).toBe(403);
			// Verlauf eines fremden Auftrags: 404 (nicht sichtbar), eigener: 200
			expect((await protokoll(monteurA, 'auftraege', fremd)).status).toBe(404);
			expect((await protokoll(monteurA, 'auftraege', meins)).status).toBe(200);
			expect((await protokoll(chefA, 'auftraege', fremd)).status).toBe(200);
		});

		it('GET-Filter: ungültiger Status oder Kunde → 400', async () => {
			expect((await liste(chefA, { status: 'erledigt' })).status).toBe(400);
			expect((await liste(chefA, { kunde: 'x' })).status).toBe(400);
			expect((await liste(chefA, { status: 'anfrage', kunde: kundeA, suche: 'x' })).status).toBe(200);
		});

		it('PATCH ändert teilweise; Kundenwechsel ohne Objekt leert das Objekt; fremder Betrieb 404', async () => {
			const id = (await post(chefA, { titel: 'Alt', kundeId: kundeA, objektId: objektA })).koerper.id as string;
			const r = await patch(chefA, id, { titel: 'Neu' });
			expect(r.status).toBe(200);
			expect(r.koerper).toMatchObject({ titel: 'Neu', objektId: objektA, status: 'anfrage' });
			const w = await patch(chefA, id, { kundeId: kunde2A });
			expect(w.koerper).toMatchObject({ kundeId: kunde2A, objektId: null });
			expect((await patch(chefA, id, { objektId: objektA })).status).toBe(400);
			expect((await patch(chefA, id, {})).status).toBe(400);
			// Status lässt sich nicht per PATCH ändern
			await patch(chefA, id, { status: 'abgerechnet' });
			expect((await get(chefA, id)).koerper.status).toBe('anfrage');
			expect((await patch(chefB, id, { titel: 'Gehackt' })).status).toBe(404);
			expect((await get(chefB, id)).status).toBe(404);
			expect((await del(chefB, id)).status).toBe(404);
		});

		it('Status-Endpunkt: ein Schritt 200, zwei Schritte 409; DELETE nur als Anfrage (204), sonst 409', async () => {
			const id = (await post(chefA, { titel: 'x', kundeId: kundeA })).koerper.id as string;
			expect((await status(chefA, id, 'beauftragt')).status).toBe(409);
			expect((await status(chefA, id, 'angebot')).koerper.status).toBe('angebot');
			expect((await status(chefA, id, 'nix')).status).toBe(400);
			expect((await del(chefA, id)).status).toBe(409);
			await status(chefA, id, 'anfrage');
			expect((await del(chefA, id)).status).toBe(204);
		});

		it('Kunde mit Aufträgen löschen → 409 mit klarer Meldung; Auftrag bleibt', async () => {
			const k = await seedKunde(betriebA, 'Mit Auftrag');
			await post(chefA, { titel: 'x', kundeId: k });
			const r = await antwort(await kundeDelete({ locals: { nutzer: chefA }, params: { id: k } } as never));
			expect(r.status).toBe(409);
			expect(r.koerper.fehler).toMatch(/Aufträge/);
			expect(await root`select 1 from app.kunden where id = ${k}`).toHaveLength(1);
		});
	});

	describe('Seiten', () => {
		const ort = (nutzer: Nutzer | null) => ({ locals: { nutzer } });

		it('Liste: Status-Reiter und Suche aus der URL; Monteur sieht nur eigene; Gast → Anmeldung; 402 ohne Modul', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Badsanierung', kundeId: kundeA });
			await legeAuftragAn(kA(), { titel: 'Anderes', kundeId: kundeA });
			await seedTodo(betriebA, a.id, monteurAId);
			const url = new URL('http://localhost/auftraege?ansicht=liste&status=anfrage&suche=bad');
			const d = (await listeLoad({ ...ort(chefA), url } as never)) as any;
			expect(d.status).toBe('anfrage');
			expect(d.suche).toBe('bad');
			expect(d.auftraege.map((x: any) => x.titel)).toEqual(['Badsanierung']);
			expect(d.darfBearbeiten).toBe(true);
			const m = (await listeLoad({ ...ort(monteurA), url: new URL('http://localhost/auftraege?ansicht=liste') } as never)) as any;
			expect(m.auftraege.map((x: any) => x.titel)).toEqual(['Badsanierung']);
			expect(m.darfBearbeiten).toBe(false);
			// unbekannter Status im Reiter → Alle statt Fehlerseite
			const u = (await listeLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege?ansicht=liste&status=xyz') } as never)) as any;
			expect(u.status).toBeNull();
			await expect(listeLoad({ ...ort(null), url } as never)).rejects.toMatchObject({ status: 303, location: '/anmelden' });
			await expect(listeLoad({ ...ort(chefC), url } as never)).rejects.toMatchObject({ status: 402 });
			await expect(listeLoad({ ...ort(admin), url } as never)).rejects.toMatchObject({ status: 403 });
		});

		it('Board (Standard): Spalten je Status mit Anzahl, nächster Termin, Angebotswert nur mit Preisrecht, Monteur nur eigene', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Badsanierung', kundeId: kundeA, objektId: objektA, zustaendige: [monteurAId] });
			const b = await legeAuftragAn(kA(), { titel: 'Fliesen', kundeId: kunde2A });
			await legeAuftragAn(kA(), { titel: 'Dach', kundeId: kunde2A });
			await setzeStatus(kA(), b.id, 'angebot');
			// Termine: einer vorbei, einer morgen, einer übermorgen → „nächster“ ist morgen
			const morgen = new Date(Date.now() + 24 * 3600_000);
			for (const [beginn, std] of [[new Date(Date.now() - 48 * 3600_000), 2], [new Date(morgen.getTime() + 24 * 3600_000), 2], [morgen, 3]] as const) {
				await root`
					insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
					values (${betriebA}, ${b.id}, ${chefAId}, ${beginn}, ${new Date(beginn.getTime() + std * 3600_000)})`;
			}
			// Angebote: abgelehntes zählt nicht, Entwurf (2,5 × 80,01 € = 200,025 € → kaufmännisch 200,03 €) schon
			const angebot = async (st: string, preisCent: number, menge: number) => {
				const [an] = await root`
					insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, status)
					values (${betriebA}, ${b.id}, current_date + 30, 'entwurf') returning id`;
				await root`
					insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
					values (${betriebA}, ${an.id}, 1, 'Arbeit', ${menge}, 'h', ${preisCent})`;
				// Status direkt setzen (Schutz-Trigger aus) – hier geht es nur ums Lesen
				await root.begin(async (tx) => {
					await tx`set local session_replication_role = replica`;
					await tx`update app.angebote set status = ${st} where id = ${an.id}`;
				});
			};
			try {
				await angebot('abgelehnt', 999_99, 1);
				await angebot('entwurf', 8_001, 2.5);
				const d = (await listeLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege') } as never)) as any;
				expect(d.ansicht).toBe('board');
				expect(d.auftraege).toEqual([]);
				expect(d.mitPreisen).toBe(true);
				expect(d.board.spalten.map((s: any) => s.status)).toEqual(['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet']);
				const anfrage = d.board.spalten[0];
				expect(anfrage.anzahl).toBe(2);
				expect(anfrage.karten.map((k: any) => k.titel)).toEqual(['Dach', 'Badsanierung']);
				const bad = anfrage.karten[1];
				expect(bad.objektBezeichnung).toBe('Haus Müller');
				expect(bad.adresse).toBe('Hauptstraße 1, 20095 Hamburg');
				expect(bad.zustaendige).toEqual([{ id: monteurAId, name: 'Ali Monteur' }]);
				expect(bad.naechsterTermin).toBeNull();
				expect(bad.angebotNettoCent).toBeNull();
				const fliesen = d.board.spalten[1].karten[0];
				expect(fliesen.titel).toBe('Fliesen');
				expect(new Date(fliesen.naechsterTermin).getTime()).toBe(morgen.getTime());
				expect(fliesen.angebotNettoCent).toBe(20_003);
				expect(fliesen.angebotStatus).toBe('entwurf');
				// Suche wirkt auch auf das Board
				const s = (await listeLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege?suche=flies') } as never)) as any;
				expect(s.board.spalten.flatMap((x: any) => x.karten.map((k: any) => k.titel))).toEqual(['Fliesen']);
				// „Meine“ auf dem Board: Chef hat nur in „Fliesen“ Termine
				const mn = (await listeLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege?meine=1') } as never)) as any;
				expect(mn.meine).toBe(true);
				expect(mn.board.spalten.flatMap((x: any) => x.karten.map((k: any) => k.titel))).toEqual(['Fliesen']);
				// Monteur: nur eigene Aufträge, keine Preise
				const m = (await listeLoad({ ...ort(monteurA), url: new URL('http://localhost/auftraege') } as never)) as any;
				expect(m.mitPreisen).toBe(false);
				expect(m.darfBearbeiten).toBe(false);
				expect(m.board.spalten.flatMap((x: any) => x.karten.map((k: any) => k.titel))).toEqual(['Badsanierung']);
				expect(m.board.spalten.flatMap((x: any) => x.karten).every((k: any) => k.angebotNettoCent === null)).toBe(true);
				// Verschieben über die API: ein Schritt ok, Sprung 409, Monteur 403
				expect((await status(chefA, a.id, 'beauftragt')).status).toBe(409);
				expect((await status(monteurA, a.id, 'angebot')).status).toBe(403);
				expect((await status(chefA, a.id, 'angebot')).status).toBe(200);
				const n = (await listeLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege') } as never)) as any;
				expect(n.board.spalten[1].karten.map((k: any) => k.titel)).toEqual(['Fliesen', 'Badsanierung']);
				expect(n.board.spalten[1].anzahl).toBe(2);
			} finally {
				await leereAngebote(root);
			}
		});

		it('Neu: mit ?kunde= vorbelegt (Objekte des Kunden), Anlegen leitet weiter, Fehler behalten Eingaben, Monteur 403', async () => {
			const l = (await neuLoad({ ...ort(chefA), url: new URL(`http://localhost/auftraege/neu?kunde=${kundeA}`) } as never)) as any;
			expect(l.kunde).toMatchObject({ id: kundeA, name: 'Müller' });
			expect(l.objekte.map((o: any) => o.bezeichnung)).toEqual(['Haus Müller']);
			const leer = (await neuLoad({ ...ort(chefA), url: new URL(`http://localhost/auftraege/neu?kunde=${kundeB}`) } as never)) as any;
			expect(leer.kunde).toBeNull();
			await expect(
				neuAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage({
						titel: 'Neu',
						kundeId: kundeA,
						objektId: objektA,
						beschreibung: '',
						geplantAb: '',
						quelleId: (await listeQuellen({ betriebId: betriebA, benutzerId: chefA.id }))[0].id
					})
				} as never)
			).rejects.toMatchObject({ status: 303 });
			const [z] = await root`select id, objekt_id, geplant_ab from app.auftraege where titel = 'Neu'`;
			expect(z).toMatchObject({ objekt_id: objektA, geplant_ab: null });
			const f = (await neuAktionen.anlegen({
				...ort(chefA),
				request: formAnfrage({ titel: '', kundeId: kundeA })
			} as never)) as any;
			expect(f.status).toBe(400);
			expect(f.data.werte).toMatchObject({ kundeId: kundeA });
			expect(((await neuAktionen.anlegen({ ...ort(monteurA), request: formAnfrage({ titel: 'x', kundeId: kundeA }) } as never)) as any).status).toBe(403);
			await expect(neuLoad({ ...ort(monteurA), url: new URL('http://localhost/auftraege/neu') } as never)).rejects.toMatchObject({ status: 403 });
		});

		it('Detail: Auftrag, Verlauf, Rechte; Statusaktion; fremder Auftrag 404; Monteur sieht eigenen ohne Knöpfe', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Detail', kundeId: kundeA, objektId: objektA });
			await setzeStatus(kA(), a.id, 'angebot');
			const d = (await detailLoad({ ...ort(chefA), params: { id: a.id } } as never)) as any;
			expect(d.auftrag).toMatchObject({ id: a.id, titel: 'Detail', status: 'angebot', objektBezeichnung: 'Haus Müller' });
			expect(d.verlauf.map((v: any) => v.titel)).toEqual(['Geändert', 'Angelegt']);
			expect(d.verlauf[0].aenderungen).toEqual([{ feld: 'Status', alt: 'Anfrage', neu: 'Angebot' }]);
			expect(d.darfBearbeiten).toBe(true);
			await expect(
				detailAktionen.status({ ...ort(chefA), params: { id: a.id }, request: formAnfrage({ status: 'beauftragt' }) } as never)
			).rejects.toMatchObject({ status: 303, location: `/auftraege/${a.id}` });
			expect((await root`select status from app.auftraege where id = ${a.id}`)[0].status).toBe('beauftragt');
			const sprung = (await detailAktionen.status({
				...ort(chefA),
				params: { id: a.id },
				request: formAnfrage({ status: 'abgerechnet' })
			} as never)) as any;
			expect(sprung.status).toBe(409);
			await expect(detailLoad({ ...ort(monteurA), params: { id: a.id } } as never)).rejects.toMatchObject({ status: 404 });
			await seedTodo(betriebA, a.id, monteurAId);
			const m = (await detailLoad({ ...ort(monteurA), params: { id: a.id } } as never)) as any;
			expect(m.darfBearbeiten).toBe(false);
			expect(
				((await detailAktionen.status({ ...ort(monteurA), params: { id: a.id }, request: formAnfrage({ status: 'angebot' }) } as never)) as any).status
			).toBe(403);
			await expect(detailLoad({ ...ort(chefB), params: { id: a.id } } as never)).rejects.toMatchObject({ status: 404 });
		});

		it('Detail: Löschen nur als Anfrage (sonst 409), leitet zur Liste', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Weg', kundeId: kundeA });
			await setzeStatus(kA(), a.id, 'angebot');
			expect(((await detailAktionen.loeschen({ ...ort(chefA), params: { id: a.id } } as never)) as any).status).toBe(409);
			await setzeStatus(kA(), a.id, 'anfrage');
			await expect(detailAktionen.loeschen({ ...ort(chefA), params: { id: a.id } } as never)).rejects.toMatchObject({
				status: 303,
				location: '/auftraege'
			});
		});

		it('Bearbeiten: Laden mit Objekten, Speichern, Fehler, Monteur 403, fremd 404', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Alt', kundeId: kundeA });
			const l = (await bearbeitenLoad({ ...ort(chefA), params: { id: a.id }, url: new URL('http://localhost/x') } as never)) as any;
			expect(l.auftrag.titel).toBe('Alt');
			expect(l.kunde.id).toBe(kundeA);
			expect(l.objekte.map((o: any) => o.bezeichnung)).toEqual(['Haus Müller']);
			await expect(
				bearbeitenAktionen.speichern({
					...ort(chefA),
					params: { id: a.id },
					request: formAnfrage({ titel: 'Neu', kundeId: kundeA, objektId: objektA, beschreibung: 'b', geplantAb: '2026-11-02' })
				} as never)
			).rejects.toMatchObject({ status: 303, location: `/auftraege/${a.id}` });
			expect((await root`select titel, geplant_ab from app.auftraege where id = ${a.id}`)[0].titel).toBe('Neu');
			const f = (await bearbeitenAktionen.speichern({
				...ort(chefA),
				params: { id: a.id },
				request: formAnfrage({ titel: '', kundeId: kundeA })
			} as never)) as any;
			expect(f.status).toBe(400);
			await expect(
				bearbeitenLoad({ ...ort(monteurA), params: { id: a.id }, url: new URL('http://localhost/x') } as never)
			).rejects.toMatchObject({ status: 403 });
			await expect(
				bearbeitenLoad({ ...ort(chefB), params: { id: a.id }, url: new URL('http://localhost/x') } as never)
			).rejects.toMatchObject({ status: 404 });
		});

		it('Kundendetail zeigt die Aufträge des Kunden (nur sichtbare); ohne Modul keine', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Beim Kunden', kundeId: kundeA });
			await legeAuftragAn(kA(), { titel: 'Anderer Kunde', kundeId: kunde2A });
			const d = (await kundeDetailLoad({ ...ort(chefA), params: { id: kundeA } } as never)) as any;
			expect(d.auftraege.map((x: any) => x.titel)).toEqual(['Beim Kunden']);
			expect(d.darfAuftragAnlegen).toBe(true);
			const m = (await kundeDetailLoad({ ...ort(monteurA), params: { id: kundeA } } as never)) as any;
			expect(m.auftraege).toEqual([]);
			await seedTodo(betriebA, a.id, monteurAId);
			const m2 = (await kundeDetailLoad({ ...ort(monteurA), params: { id: kundeA } } as never)) as any;
			expect(m2.auftraege.map((x: any) => x.titel)).toEqual(['Beim Kunden']);
			const nurKunden = nutzerVon(chefAId, betriebA, ['kunden.lesen']);
			expect(((await kundeDetailLoad({ ...ort(nurKunden), params: { id: kundeA } } as never)) as any).auftraege).toBeNull();
		});
	});

	describe('Gesamtprüfung', () => {
		it('20 gleichzeitige Aufträge im selben Betrieb → 20 verschiedene, lückenlose Nummern', async () => {
			const ergebnisse = await Promise.all(
				Array.from({ length: 20 }, (_, i) => legeAuftragAn(kA(), { titel: `Parallel ${i}`, kundeId: kundeA }))
			);
			const nummern = ergebnisse.map((a) => a.nummer).sort();
			expect(new Set(nummern).size).toBe(20);
			expect(nummern).toEqual(Array.from({ length: 20 }, (_, i) => `A-${JAHR}-${String(i + 1).padStart(4, '0')}`));
		});

		it('Schreiben ohne alle_lesen: fremde (unsichtbare) Aufträge → 404 bei PATCH, Status, DELETE; eigene gehen', async () => {
			// Bearbeiten, aber nur eigene Aufträge sehen
			const schreiber = nutzerVon(monteurAId, betriebA, ['auftraege.lesen', 'auftraege.bearbeiten']);
			const fremd = await legeAuftragAn(kA(), { titel: 'Fremd', kundeId: kundeA });
			const meins = await legeAuftragAn(kA(), { titel: 'Meins', kundeId: kundeA });
			await seedTodo(betriebA, meins.id, monteurAId);
			expect((await patch(schreiber, fremd.id, { titel: 'Gehackt' })).status).toBe(404);
			expect((await status(schreiber, fremd.id, 'angebot')).status).toBe(404);
			expect((await del(schreiber, fremd.id)).status).toBe(404);
			const [z] = await root`select titel, status from app.auftraege where id = ${fremd.id}`;
			expect(z).toEqual({ titel: 'Fremd', status: 'anfrage' });
			expect((await patch(schreiber, meins.id, { titel: 'Meins neu' })).status).toBe(200);
			expect((await status(schreiber, meins.id, 'angebot')).status).toBe(200);
			// Dienst direkt
			const k = { betriebId: betriebA, benutzerId: monteurAId };
			await expect(aendereAuftrag(k, fremd.id, { titel: 'x' }, eigene(monteurAId))).rejects.toMatchObject({ status: 404 });
			await expect(setzeStatus(k, fremd.id, 'angebot', eigene(monteurAId))).rejects.toMatchObject({ status: 404 });
			await expect(loescheAuftrag(k, fremd.id, eigene(monteurAId))).rejects.toMatchObject({ status: 404 });
			// Seiten: Bearbeiten und Statusaktion ebenso
			const ort = { locals: { nutzer: schreiber } };
			await expect(
				bearbeitenLoad({ ...ort, params: { id: fremd.id }, url: new URL('http://localhost/x') } as never)
			).rejects.toMatchObject({ status: 404 });
			expect(
				((await detailAktionen.status({ ...ort, params: { id: fremd.id }, request: formAnfrage({ status: 'angebot' }) } as never)) as any).status
			).toBe(404);
		});

		it('Verlauf: auftraege.alle_lesen genügt (ohne auftraege.lesen)', async () => {
			const a = await legeAuftragAn(kA(), { titel: 'Verlauf', kundeId: kundeA });
			const nurAlle = nutzerVon(bueroAId, betriebA, ['auftraege.alle_lesen']);
			expect((await protokoll(nurAlle, 'auftraege', a.id)).status).toBe(200);
		});

		it('Liste mit offen: ohne abgerechnete – auch ältere offene Aufträge hinter vielen abgerechneten', async () => {
			const alt = await legeAuftragAn(kA(), { titel: 'Alter offener Auftrag', kundeId: kundeA });
			await root`update app.auftraege set angelegt = now() - interval '1 year' where id = ${alt.id}`;
			for (let i = 0; i < 101; i++) {
				await root`
					insert into app.auftraege (betrieb_id, titel, kunde_id, status) values (${betriebA}, ${'Erledigt ' + i}, ${kundeA}, 'abgerechnet')`;
			}
			const offen = await listeAuftraege(kA(), alle(), { offen: true });
			expect(offen.map((a) => a.titel)).toEqual(['Alter offener Auftrag']);
			const r = await liste(chefA, { offen: '1', suche: 'alter' });
			expect(r.koerper.map((a: any) => a.titel)).toEqual(['Alter offener Auftrag']);
			expect((await liste(chefA, { offen: '1', suche: 'erledigt' })).koerper).toEqual([]);
			const p = (await plantafelLoad({ locals: { nutzer: chefA }, url: new URL('http://localhost/plantafel') } as never)) as any;
			expect(p.auftraege.map((a: any) => a.titel)).toContain('Alter offener Auftrag');
			expect(p.auftraege.some((a: any) => a.titel.startsWith('Erledigt'))).toBe(false);
		});
	});
});
