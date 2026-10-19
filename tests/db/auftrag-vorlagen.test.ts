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
import { GET as listeGet, POST as vorlagePost } from '../../src/routes/api/auftrag-vorlagen/+server';
import {
	GET as vorlageGet,
	PUT as vorlagePut,
	DELETE as vorlageDelete
} from '../../src/routes/api/auftrag-vorlagen/[id]/+server';
import { actions as neuAktionen, load as neuLoad } from '../../src/routes/(app)/auftraege/neu/+page.server';
import {
	actions as bearbeitenAktionen,
	load as bearbeitenLoad
} from '../../src/routes/(app)/auftraege/[id]/bearbeiten/+page.server';

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

	describe('API', () => {
		const jsonAnfrage = (methode: string, koerper?: unknown) =>
			new Request('http://localhost/api/auftrag-vorlagen', {
				method: methode,
				headers: { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});

		const antwort = async (r: Response) => {
			const text = await r.text();
			return { status: r.status, koerper: text ? JSON.parse(text) : null };
		};

		it('GET ohne Recht → 403', async () => {
			const monteur = nutzerVon(chefAId, betriebA, ['auftraege.lesen']);
			const r = await antwort(await listeGet({ locals: { nutzer: monteur }, url: new URL('http://localhost/api/auftrag-vorlagen') } as never));
			expect(r.status).toBe(200); // auftraege.lesen reicht für GET
		});

		it('POST mit Todos → 201 mit Todos', async () => {
			const r = await antwort(await vorlagePost({
				locals: { nutzer: chefA },
				request: jsonAnfrage('POST', {
					name: 'API Test',
					todos: [{ titel: 'Todo 1' }, { titel: 'Todo 2', sortierung: 1 }]
				})
			} as never));
			expect(r.status).toBe(201);
			expect(r.koerper.name).toBe('API Test');
			expect(r.koerper.todos).toHaveLength(2);
		});

		it('GET [id] mit fremder ID → 404', async () => {
			const fremd = await legeVorlageAn({ betriebId: betriebB, benutzerId: chefBId }, { name: 'Fremd' });
			const r = await antwort(await vorlageGet({
				locals: { nutzer: chefA },
				params: { id: fremd.id }
			} as never));
			expect(r.status).toBe(404);
		});

		it('PUT → Todos werden ersetzt', async () => {
			const vorlage = await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, {
				name: 'Zu ändern',
				todos: [{ titel: 'Alt' }]
			});
			const r = await antwort(await vorlagePut({
				locals: { nutzer: chefA },
				params: { id: vorlage.id },
				request: jsonAnfrage('PUT', {
					name: 'Geändert',
					todos: [{ titel: 'Neu 1' }, { titel: 'Neu 2' }]
				})
			} as never));
			expect(r.status).toBe(200);
			expect(r.koerper.name).toBe('Geändert');
			expect(r.koerper.todos).toHaveLength(2);
		});

		it('DELETE → 204', async () => {
			const vorlage = await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, { name: 'Löschen' });
			const r = await antwort(await vorlageDelete({
				locals: { nutzer: chefA },
				params: { id: vorlage.id }
			} as never));
			expect(r.status).toBe(204);
		});
	});

	describe('Auftrag-Formular (Neu und Bearbeiten)', () => {
		let kundeA: string;
		const ort = (nutzer: Nutzer) => ({ locals: { nutzer } });
		const formAnfrage = (felder: [string, string][]) => {
			const body = new URLSearchParams();
			for (const [k, v] of felder) body.append(k, v);
			return new Request('http://localhost/auftraege/neu', { method: 'POST', body });
		};
		/** Führt eine Formular-Aktion aus; eine Umleitung (redirect) kommt als { umleitung } zurück. */
		const aktion = async (fn: () => unknown) => {
			try {
				return { ergebnis: (await fn()) as any };
			} catch (e: any) {
				if (e?.status === 303) return { umleitung: e.location as string };
				throw e;
			}
		};
		const todosVon = async (auftrag: string) =>
			(await root`select titel, beschreibung from app.todos where auftrag_id = ${auftrag} order by angelegt, id`).map(
				(z) => [z.titel, z.beschreibung]
			);

		beforeAll(async () => {
			[{ id: kundeA }] = await root`
				insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Vorlagenkunde') returning id`;
		});

		it('Neu: To-dos aus dem Formular mit Beschreibung und in Reihenfolge; leere Zeilen fallen weg', async () => {
			const d = (await neuLoad({ ...ort(chefA), url: new URL('http://localhost/auftraege/neu') } as never)) as any;
			expect(Array.isArray(d.vorlagen)).toBe(true);
			const r = await aktion(() =>
				neuAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage([
						['kundeId', kundeA],
						['titel', 'Wartung mit Vorlage'],
						['todo_0', 'Filter wechseln'],
						['todo_beschreibung_0', 'Typ F7'],
						['todo_1', ''],
						['todo_beschreibung_1', ''],
						['todo_2', 'Abgas messen'],
						['todo_beschreibung_2', '']
					])
				} as never)
			);
			expect(r.umleitung).toMatch(/^\/auftraege\/[0-9a-f-]{36}$/);
			const id = r.umleitung!.split('/').pop()!;
			expect(await todosVon(id)).toEqual([
				['Filter wechseln', 'Typ F7'],
				['Abgas messen', null]
			]);
		});

		it('Neu: ungültiges To-do → 400 und KEIN Auftrag angelegt', async () => {
			const r = await aktion(() =>
				neuAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage([
						['kundeId', kundeA],
						['titel', 'Darf nicht entstehen'],
						['todo_0', 'Ok'],
						['todo_beschreibung_0', 'x'.repeat(501)]
					])
				} as never)
			);
			expect(r.ergebnis?.status).toBe(400);
			expect(await root`select 1 from app.auftraege where titel = 'Darf nicht entstehen'`).toHaveLength(0);
		});

		it('Bearbeiten: Vorlagen zur Auswahl; To-dos aus dem Formular kommen zu den vorhandenen dazu', async () => {
			await legeVorlageAn({ betriebId: betriebA, benutzerId: chefAId }, { name: 'Heizung' });
			const [{ id: auftrag }] = await root`
				insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Bestand', ${kundeA}) returning id`;
			await root`insert into app.todos (betrieb_id, auftrag_id, titel) values (${betriebA}, ${auftrag}, 'Schon da')`;
			const d = (await bearbeitenLoad({ ...ort(chefA), params: { id: auftrag } } as never)) as any;
			expect(d.vorlagen.map((v: any) => v.name)).toEqual(['Heizung']);
			const r = await aktion(() =>
				bearbeitenAktionen.speichern({
					...ort(chefA),
					params: { id: auftrag },
					request: formAnfrage([
						['kundeId', kundeA],
						['titel', 'Bestand geändert'],
						['todo_0', 'Brenner reinigen'],
						['todo_beschreibung_0', 'mit Bürste'],
						['todo_1', 'Abgas messen']
					])
				} as never)
			);
			expect(r.umleitung).toBe(`/auftraege/${auftrag}`);
			expect(await todosVon(auftrag)).toEqual([
				['Schon da', null],
				['Brenner reinigen', 'mit Bürste'],
				['Abgas messen', null]
			]);
			const [a] = await root`select titel from app.auftraege where id = ${auftrag}`;
			expect(a.titel).toBe('Bestand geändert');
		});

		it('Bearbeiten: ungültiges To-do → 400, Auftrag unverändert, keine To-dos', async () => {
			const [{ id: auftrag }] = await root`
				insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Unverändert', ${kundeA}) returning id`;
			const r = await aktion(() =>
				bearbeitenAktionen.speichern({
					...ort(chefA),
					params: { id: auftrag },
					request: formAnfrage([
						['kundeId', kundeA],
						['titel', 'Soll nicht gespeichert werden'],
						['todo_0', ''],
						['todo_beschreibung_0', 'Beschreibung ohne Titel']
					])
				} as never)
			);
			expect(r.ergebnis?.status).toBe(400);
			expect((await root`select titel from app.auftraege where id = ${auftrag}`)[0].titel).toBe('Unverändert');
			expect(await todosVon(auftrag)).toEqual([]);
		});
	});
});
