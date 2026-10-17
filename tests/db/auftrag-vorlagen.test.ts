import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import {
	listeVorlagen,
	holeVorlage,
	legeVorlageAn,
	aendereVorlage,
	loescheVorlage
} from '../../src/lib/server/auftrag-vorlagen';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

describe('Auftrags-To-do-Vorlagen', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefAId: string, chefBId: string;
	let chefA: Nutzer, chefB: Nutzer;

	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]}) returning id`)[0]
				.id as string;
		const rolleA = await rolle(betriebA, 'Chef', VORLAGEN.chef);
		const rolleB = await rolle(betriebB, 'Chef', VORLAGEN.chef);
		[{ id: chefAId }] = await root`
			insert into app.benutzer (betrieb_id, rolle_id, name, email, passwort_hash)
			values (${betriebA}, ${rolleA}, 'Chef A', 'chef-a@test.de', 'x') returning id`;
		[{ id: chefBId }] = await root`
			insert into app.benutzer (betrieb_id, rolle_id, name, email, passwort_hash)
			values (${betriebB}, ${rolleB}, 'Chef B', 'chef-b@test.de', 'x') returning id`;
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
	});

	afterAll(async () => {
		await root.end();
		await schliesseDb();
	});

	beforeEach(async () => {
		await root`delete from app.auftrag_vorlagen`;
	});

	it('Vorlage mit To-dos anlegen und lesen', async () => {
		const erg = await alsApp(betriebA, chefAId, async (tx) => {
			const [vorlage] = await tx`
				insert into app.auftrag_vorlagen (betrieb_id, name, beschreibung)
				values (${betriebA}, 'Wartung Heizung', 'Jährliche Wartung') returning *`;
			await tx`
				insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel, sortierung)
				values (${betriebA}, ${vorlage.id}, 'Filter wechseln', 1),
				       (${betriebA}, ${vorlage.id}, 'Brenner reinigen', 2),
				       (${betriebA}, ${vorlage.id}, 'Abgas messen', 3)`;
			return vorlage;
		});
		expect(erg.name).toBe('Wartung Heizung');
		expect(erg.beschreibung).toBe('Jährliche Wartung');

		const todos = await alsApp(betriebA, chefAId, (tx) =>
			tx`select * from app.auftrag_vorlagen_todos where vorlage_id = ${erg.id} order by sortierung`
		);
		expect(todos).toHaveLength(3);
		expect(todos.map((t: any) => t.titel)).toEqual(['Filter wechseln', 'Brenner reinigen', 'Abgas messen']);
	});

	it('To-dos sind nach sortierung sortiert', async () => {
		const erg = await alsApp(betriebA, chefAId, async (tx) => {
			const [vorlage] = await tx`
				insert into app.auftrag_vorlagen (betrieb_id, name) values (${betriebA}, 'Test') returning *`;
			await tx`
				insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel, sortierung)
				values (${betriebA}, ${vorlage.id}, 'Zweite', 2),
				       (${betriebA}, ${vorlage.id}, 'Erste', 1),
				       (${betriebA}, ${vorlage.id}, 'Dritte', 3)`;
			return vorlage;
		});
		const todos = await alsApp(betriebA, chefAId, (tx) =>
			tx`select titel from app.auftrag_vorlagen_todos where vorlage_id = ${erg.id} order by sortierung`
		);
		expect(todos.map((t: any) => t.titel)).toEqual(['Erste', 'Zweite', 'Dritte']);
	});

	it('Betrieb B sieht keine Vorlagen von A (RLS)', async () => {
		await alsApp(betriebA, chefAId, (tx) =>
			tx`insert into app.auftrag_vorlagen (betrieb_id, name) values (${betriebA}, 'Nur A')`
		);
		const sichtA = await alsApp(betriebA, chefAId, (tx) => tx`select * from app.auftrag_vorlagen`);
		const sichtB = await alsApp(betriebB, chefBId, (tx) => tx`select * from app.auftrag_vorlagen`);
		expect(sichtA).toHaveLength(1);
		expect(sichtB).toHaveLength(0);
	});

	it('Vorlage löschen löscht auch To-dos (CASCADE)', async () => {
		const erg = await alsApp(betriebA, chefAId, async (tx) => {
			const [vorlage] = await tx`
				insert into app.auftrag_vorlagen (betrieb_id, name) values (${betriebA}, 'Zu löschen') returning *`;
			await tx`
				insert into app.auftrag_vorlagen_todos (betrieb_id, vorlage_id, titel)
				values (${betriebA}, ${vorlage.id}, 'Todo 1')`;
			return vorlage;
		});
		await alsApp(betriebA, chefAId, (tx) => tx`delete from app.auftrag_vorlagen where id = ${erg.id}`);
		const todos = await root`select * from app.auftrag_vorlagen_todos where vorlage_id = ${erg.id}`;
		expect(todos).toHaveLength(0);
	});

	it('Änderung an Vorlage landet im Änderungsprotokoll', async () => {
		const erg = await alsApp(betriebA, chefAId, async (tx) => {
			const [vorlage] = await tx`
				insert into app.auftrag_vorlagen (betrieb_id, name) values (${betriebA}, 'Protokoll Test') returning *`;
			return vorlage;
		});
		await alsApp(betriebA, chefAId, (tx) =>
			tx`update app.auftrag_vorlagen set name = 'Geändert' where id = ${erg.id}`
		);
		const protokoll = await root`
			select * from app.aenderungen where tabelle = 'auftrag_vorlagen' and datensatz_id = ${erg.id}`;
		expect(protokoll.length).toBeGreaterThan(0);
	});

	describe('Dienst', () => {
		it('listeVorlagen liefert alle Vorlagen des Betriebs', async () => {
			await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, { name: 'Vorlage 1' });
			await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, { name: 'Vorlage 2' });
			await legeVorlageAn({ betriebId: betriebB, benutzerId: chefBId }, { name: 'B Vorlage' });

			const ergA = await listeVorlagen({ betriebId: betriebA, benutzerId: chefAId });
			expect(ergA).toHaveLength(2);
			expect(ergA.map((v) => v.name).sort()).toEqual(['Vorlage 1', 'Vorlage 2']);
		});

		it('holeVorlage mit fremder ID → 404', async () => {
			const fremd = await legeVorlageAn({ betriebId: betriebB, benutzerId: chefBId }, { name: 'Fremd' });
			await expect(
				holeVorlage({ betriebId: betriebA, benutzerId: chefAId }, fremd.id)
			).rejects.toThrow('nicht gefunden');
		});

		it('legeVorlageAn mit Todos → Todos sind gespeichert und sortiert', async () => {
			const erg = await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, {
				name: 'Mit Todos',
				todos: [
					{ titel: 'Zweite', sortierung: 2 },
					{ titel: 'Erste', sortierung: 1 },
					{ titel: 'Dritte', sortierung: 3 }
				]
			});
			expect(erg.todos).toHaveLength(3);
			expect(erg.todos.map((t) => t.titel)).toEqual(['Erste', 'Zweite', 'Dritte']);
		});

		it('aendereVorlage mit neuen Todos → alte Todos sind weg, neue da', async () => {
			const erg = await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, {
				name: 'Zu ändern',
				todos: [{ titel: 'Alt 1' }, { titel: 'Alt 2' }]
			});
			expect(erg.todos).toHaveLength(2);

			const geaendert = await aendereVorlage({ betriebId: betriebA, benutzerId: chefAId }, erg.id, {
				name: 'Geändert',
				todos: [{ titel: 'Neu 1' }]
			});
			expect(geaendert.name).toBe('Geändert');
			expect(geaendert.todos).toHaveLength(1);
			expect(geaendert.todos[0].titel).toBe('Neu 1');
		});

		it('loescheVorlage → Vorlage und Todos weg', async () => {
			const erg = await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, {
				name: 'Zum Löschen',
				todos: [{ titel: 'Todo' }]
			});
			await loescheVorlage({ betriebId: betriebA, benutzerId: chefAId }, erg.id);
			await expect(
				holeVorlage({ betriebId: betriebA, benutzerId: chefAId }, erg.id)
			).rejects.toThrow('nicht gefunden');
		});
	});
});
