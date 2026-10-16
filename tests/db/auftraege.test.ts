import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { berlinTag } from '../../src/lib/zeit';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const UNBEKANNT = '11111111-1111-4111-8111-111111111111';
const JAHR = berlinTag(new Date()).slice(0, 4);

describe('Aufträge und To-dos', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string, betriebC: string;
	let chefAId: string, monteurAId: string, monteur2AId: string, bueroAId: string, chefBId: string, chefCId: string;
	let chefA: Nutzer, monteurA: Nutzer, monteur2A: Nutzer, bueroA: Nutzer, chefB: Nutzer, chefC: Nutzer, admin: Nutzer;
	let kundeA: string, kunde2A: string, kundeB: string;
	let objektA: string, objekt2A: string, objektB: string;

	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

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

		it('Betrieb B sieht und ändert keine Aufträge/To-dos von A (RLS)', async () => {
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
			// To-do an einem fremden Auftrag ebenso
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

		it('Auftrag löschen löscht seine To-dos (Kaskade)', async () => {
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
});
