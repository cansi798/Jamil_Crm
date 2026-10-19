import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { listeAuftraege } from '../../src/lib/server/auftraege';
import { legeTodoAn, legeTodosAn, listeTodos } from '../../src/lib/server/todos';
import { GET as listeGet, POST as todoPost } from '../../src/routes/api/todos/+server';
import { DELETE as todoDelete, GET as todoGet, PATCH as todoPatch } from '../../src/routes/api/todos/[id]/+server';
import { GET as protokollGet } from '../../src/routes/api/protokoll/+server';
import { actions as seitenAktionen, load as seitenLoad } from '../../src/routes/(app)/todos/+page.server';
import {
	actions as auftragAktionen,
	load as auftragLoad
} from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { berlinTag, tagPlus } from '../../src/lib/zeit';

type Ant = { status: number; koerper: any };

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const jsonAnfrage = (methode: string, koerper?: unknown) =>
	new Request('http://localhost/api/todos', {
		method: methode,
		headers: { 'content-type': 'application/json' },
		body: koerper === undefined ? undefined : JSON.stringify(koerper)
	});

const formAnfrage = (felder: Record<string, string>) => {
	const body = new URLSearchParams();
	for (const [k, v] of Object.entries(felder)) body.append(k, v);
	return new Request('http://localhost/todos', { method: 'POST', body });
};

const UNBEKANNT = '11111111-1111-4111-8111-111111111111';

describe('To-dos', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string, betriebC: string;
	let chefAId: string, monteurAId: string, monteur2AId: string, inaktivAId: string, chefBId: string, chefCId: string;
	let chefA: Nutzer, monteurA: Nutzer, monteur2A: Nutzer, chefB: Nutzer, chefC: Nutzer;
	let kundeA: string, kundeB: string;
	let auftragA: string, auftrag2A: string, auftragB: string;

	const kA = () => ({ betriebId: betriebA, benutzerId: chefAId });

	const liste = async (nutzer: Nutzer | null, params: Record<string, string> = {}) => {
		const url = new URL('http://localhost/api/todos');
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		return antwort(await listeGet({ locals: { nutzer }, url } as never));
	};
	const post = async (nutzer: Nutzer | null, koerper: unknown) =>
		antwort(await todoPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper) } as never));
	const get = async (nutzer: Nutzer | null, id: string) =>
		antwort(await todoGet({ locals: { nutzer }, params: { id } } as never));
	const patch = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await todoPatch({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PATCH', koerper) } as never));
	const del = async (nutzer: Nutzer | null, id: string) =>
		antwort(await todoDelete({ locals: { nutzer }, params: { id } } as never));

	const seedAuftrag = async (betrieb: string, kunde: string, titel: string) =>
		(await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betrieb}, ${titel}, ${kunde}) returning id`)[0]
			.id as string;

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
		const benutzer = async (betrieb: string, rolleId: string, email: string, name: string, aktiv = true) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id, aktiv)
				values (${betrieb}, ${email}, ${name}, 'x', ${rolleId}, ${aktiv}) returning id`)[0].id as string;
		const monteurRolle = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		chefAId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test', 'Chef A');
		monteurAId = await benutzer(betriebA, monteurRolle, 'monteur-a@beispiel.test', 'Ali Monteur');
		monteur2AId = await benutzer(betriebA, monteurRolle, 'monteur2-a@beispiel.test', 'Mehmet Monteur');
		inaktivAId = await benutzer(betriebA, monteurRolle, 'weg-a@beispiel.test', 'Ehemalig', false);
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test', 'Chef B');
		chefCId = await benutzer(betriebC, await rolle(betriebC, 'Chef', VORLAGEN.chef), 'chef-c@beispiel.test', 'Chef C');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		monteurA = nutzerVon(monteurAId, betriebA, VORLAGEN.monteur);
		monteur2A = nutzerVon(monteur2AId, betriebA, VORLAGEN.monteur);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
		chefC = nutzerVon(chefCId, betriebC, VORLAGEN.chef);
		[{ id: kundeA }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Müller') returning id`;
		[{ id: kundeB }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebB}, 'privat', 'Fremd') returning id`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.todos`;
		await root`delete from app.auftraege`;
		await root`delete from app.aenderungen where tabelle in ('auftraege', 'todos')`;
		auftragA = await seedAuftrag(betriebA, kundeA, 'Badsanierung');
		auftrag2A = await seedAuftrag(betriebA, kundeA, 'Fliesen');
		auftragB = await seedAuftrag(betriebB, kundeB, 'Fremd');
	});

	it('Zuständiger Monteur setzt eigenes To-do erledigt → ok (und wieder offen); ändert Titel → 403', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Silikon kaufen', auftragId: auftragA, zustaendigId: monteurAId });
		const r = await patch(monteurA, t.id, { erledigt: true });
		expect(r.status).toBe(200);
		expect(r.koerper).toMatchObject({ erledigt: true, titel: 'Silikon kaufen' });
		expect(r.koerper.erledigtAm).toEqual(expect.any(String));
		expect((await patch(monteurA, t.id, { erledigt: false })).koerper).toMatchObject({ erledigt: false, erledigtAm: null });
		expect((await patch(monteurA, t.id, { titel: 'Anders' })).status).toBe(403);
		expect((await patch(monteurA, t.id, { erledigt: true, titel: 'Anders' })).status).toBe(403);
		expect((await patch(monteurA, t.id, { erledigt: 'ja' })).status).toBe(400);
		expect((await del(monteurA, t.id)).status).toBe(403);
		expect((await post(monteurA, { titel: 'x' })).status).toBe(403);
		const [z] = await root`select titel, erledigt_am from app.todos where id = ${t.id}`;
		expect(z).toEqual({ titel: 'Silikon kaufen', erledigt_am: null });
	});

	it('Fremdes To-do → 404 (Kollege, anderer Betrieb, unbekannt, kaputt); sichtbares fremdes To-do abhaken → 403', async () => {
		const kollege = await legeTodoAn(kA(), { titel: 'Kollege', auftragId: auftrag2A, zustaendigId: monteur2AId });
		const [fremd] = await root`insert into app.todos (betrieb_id, titel) values (${betriebB}, 'B') returning id`;
		for (const id of [kollege.id, fremd.id, UNBEKANNT, 'kaputt']) {
			expect((await patch(monteurA, id, { erledigt: true })).status, id).toBe(404);
			expect((await get(monteurA, id)).status, id).toBe(404);
		}
		expect((await patch(chefB, kollege.id, { titel: 'Gehackt' })).status).toBe(404);
		expect((await del(chefB, kollege.id)).status).toBe(404);
		// Monteur sieht den Auftrag (eigenes To-do darin) – das To-do des Kollegen dort ist sichtbar, aber nicht seins
		await legeTodoAn(kA(), { titel: 'Meins', auftragId: auftrag2A, zustaendigId: monteurAId });
		expect((await get(monteurA, kollege.id)).status).toBe(200);
		expect((await patch(monteurA, kollege.id, { erledigt: true })).status).toBe(403);
		const [z] = await root`select erledigt_am from app.todos where id = ${kollege.id}`;
		expect(z.erledigt_am).toBeNull();
	});

	it('zuständig = deaktivierter Benutzer → 400; Benutzer aus Betrieb B → 400; fremder Auftrag → 400', async () => {
		for (const [e, muster] of [
			[{ titel: 'x', zustaendigId: inaktivAId }, /aktiv/],
			[{ titel: 'x', zustaendigId: chefBId }, /aktiv/],
			[{ titel: 'x', zustaendigId: 'kaputt' }, /Zuständig/],
			[{ titel: 'x', auftragId: auftragB }, /Auftrag/],
			[{ titel: 'x', faellig: '2026-13-01' }, /Datum/],
			[{ titel: '' }, /Titel/],
			[{ titel: 'x'.repeat(201) }, /höchstens 200/]
		] as const) {
			const r = await post(chefA, e);
			expect(r.status, JSON.stringify(e)).toBe(400);
			expect(r.koerper.fehler).toMatch(muster);
		}
		const t = await legeTodoAn(kA(), { titel: 'x', zustaendigId: monteurAId });
		expect((await patch(chefA, t.id, { zustaendigId: inaktivAId })).status).toBe(400);
		// Zuständigen wird später deaktiviert: To-do bleibt änderbar, solange der Zuständige nicht neu gesetzt wird
		await root`update app.benutzer set aktiv = false where id = ${monteur2AId}`;
		try {
			const t2 = await root`insert into app.todos (betrieb_id, titel, zustaendig_id) values (${betriebA}, 'alt', ${monteur2AId}) returning id`;
			expect((await patch(chefA, t2[0].id, { titel: 'neu' })).status).toBe(200);
		} finally {
			await root`update app.benutzer set aktiv = true where id = ${monteur2AId}`;
		}
		expect(await root`select 1 from app.todos where titel = 'x' and zustaendig_id = ${inaktivAId}`).toHaveLength(0);
	});

	it('Sortierung: offen vor erledigt, dann Fälligkeit aufsteigend, ohne Datum zuletzt', async () => {
		const ohne = await legeTodoAn(kA(), { titel: 'Ohne Datum' });
		const spaet = await legeTodoAn(kA(), { titel: 'Später', faellig: '2026-11-10' });
		const frueh = await legeTodoAn(kA(), { titel: 'Früh', faellig: '2026-10-20' });
		const erledigt = await legeTodoAn(kA(), { titel: 'Erledigt', faellig: '2026-10-01' });
		await patch(chefA, erledigt.id, { erledigt: true });
		const titel = (await listeTodos(kA(), { alle: true, benutzerId: chefAId }, { nur: 'alle' })).map((t) => t.titel);
		expect(titel).toEqual(['Früh', 'Später', 'Ohne Datum', 'Erledigt']);
		expect([ohne.id, spaet.id, frueh.id]).toHaveLength(3);
		// „offen“ blendet Erledigtes aus
		expect((await liste(chefA, { nur: 'offen' })).koerper.map((t: any) => t.titel)).toEqual(['Früh', 'Später', 'Ohne Datum']);
	});

	it('Listen: meine / offen / alle; Monteur sieht nur eigene und solche in sichtbaren Aufträgen', async () => {
		await legeTodoAn(kA(), { titel: 'Ali', auftragId: auftragA, zustaendigId: monteurAId });
		await legeTodoAn(kA(), { titel: 'Mehmet', auftragId: auftrag2A, zustaendigId: monteur2AId });
		await legeTodoAn(kA(), { titel: 'Chef', zustaendigId: chefAId });
		await legeTodoAn(kA(), { titel: 'Niemand' });
		const namen = (r: Ant) => r.koerper.map((t: any) => t.titel).sort();
		expect(namen(await liste(chefA, { nur: 'meine' }))).toEqual(['Chef']);
		expect(namen(await liste(chefA, { nur: 'alle' }))).toEqual(['Ali', 'Chef', 'Mehmet', 'Niemand']);
		expect(namen(await liste(chefA, { auftrag: auftragA }))).toEqual(['Ali']);
		expect(namen(await liste(monteurA))).toEqual(['Ali']);
		expect(namen(await liste(monteurA, { nur: 'alle' }))).toEqual(['Ali']);
		expect(namen(await liste(monteur2A, { nur: 'meine' }))).toEqual(['Mehmet']);
		expect((await liste(chefA, { nur: 'quatsch' })).status).toBe(400);
		expect((await liste(chefA, { auftrag: 'x' })).status).toBe(400);
		expect((await liste(chefC)).status).toBe(402);
		expect((await liste(null)).status).toBe(401);
		const r = await liste(chefA);
		expect(r.koerper.find((t: any) => t.titel === 'Ali')).toMatchObject({
			auftragId: auftragA,
			auftragNummer: expect.stringMatching(/^A-\d{4}-\d{4}$/),
			zustaendigId: monteurAId,
			zustaendigName: 'Ali Monteur',
			faellig: null,
			erledigt: false,
			erledigtAm: null
		});
	});

	it('Monteur sieht durch eigenes To-do den Auftrag in listeAuftraege (Ergänzung zu Task 3)', async () => {
		const k = { betriebId: betriebA, benutzerId: monteurAId };
		expect(await listeAuftraege(k, { alle: false, benutzerId: monteurAId }, {})).toEqual([]);
		await legeTodoAn(kA(), { titel: 'Ali', auftragId: auftrag2A, zustaendigId: monteurAId });
		expect((await listeAuftraege(k, { alle: false, benutzerId: monteurAId }, {})).map((a) => a.titel)).toEqual(['Fliesen']);
	});

	it('Chef: anlegen (201), ändern, löschen (204); Verlauf eines fremden To-dos für den Monteur 404', async () => {
		const r = await post(chefA, { titel: 'Neu', auftragId: auftragA, zustaendigId: monteurAId, faellig: '2026-10-30' });
		expect(r.status).toBe(201);
		expect(r.koerper).toMatchObject({ titel: 'Neu', faellig: '2026-10-30', zustaendigName: 'Ali Monteur' });
		const id = r.koerper.id as string;
		const p = await patch(chefA, id, { titel: 'Geändert', zustaendigId: null, faellig: null });
		expect(p.koerper).toMatchObject({ titel: 'Geändert', zustaendigId: null, faellig: null, auftragId: auftragA });
		expect((await patch(chefA, id, {})).status).toBe(400);
		const kollege = await legeTodoAn(kA(), { titel: 'K', zustaendigId: monteur2AId });
		const url = (t: string) => {
			const u = new URL('http://localhost/api/protokoll');
			u.searchParams.set('tabelle', 'todos');
			u.searchParams.set('datensatz', t);
			return u;
		};
		expect((await antwort(await protokollGet({ locals: { nutzer: monteurA }, url: url(kollege.id) } as never))).status).toBe(404);
		expect((await antwort(await protokollGet({ locals: { nutzer: monteur2A }, url: url(kollege.id) } as never))).status).toBe(200);
		expect((await del(chefA, id)).status).toBe(204);
		expect((await del(chefA, id)).status).toBe(404);
	});

	describe('Seiten', () => {
		const ort = (nutzer: Nutzer | null) => ({ locals: { nutzer } });

		it('To-do-Seite: Reiter meine/offen/alle (Offen/Alle nur mit alle_lesen), heute (Berlin) für Überfälliges', async () => {
			await legeTodoAn(kA(), { titel: 'Ali', zustaendigId: monteurAId, faellig: '2020-01-01' });
			await legeTodoAn(kA(), { titel: 'Chef', zustaendigId: chefAId });
			const d = (await seitenLoad({ ...ort(chefA), url: new URL('http://localhost/todos?nur=alle') } as never)) as any;
			expect(d.nur).toBe('alle');
			expect(d.reiter).toEqual(['meine', 'offen', 'alle']);
			expect(d.todos.map((t: any) => t.titel).sort()).toEqual(['Ali', 'Chef']);
			expect(d.heute).toBe(berlinTag(new Date()));
			expect(d.mitarbeiter.map((m: any) => m.name)).toEqual(['Ali Monteur', 'Chef A', 'Mehmet Monteur']);
			const m = (await seitenLoad({ ...ort(monteurA), url: new URL('http://localhost/todos?nur=alle') } as never)) as any;
			expect(m.nur).toBe('meine');
			expect(m.reiter).toEqual(['meine']);
			expect(m.todos.map((t: any) => t.titel)).toEqual(['Ali']);
			expect(m.darfBearbeiten).toBe(false);
			await expect(seitenLoad({ ...ort(chefC), url: new URL('http://localhost/todos') } as never)).rejects.toMatchObject({ status: 402 });
		});

		it('To-do-Seite: abhaken (Monteur, eigenes), anlegen/löschen nur Chef', async () => {
			const t = await legeTodoAn(kA(), { titel: 'Ali', zustaendigId: monteurAId });
			const ok = await seitenAktionen.umschalten({
				...ort(monteurA),
				request: formAnfrage({ id: t.id, erledigt: 'true' })
			} as never);
			expect(ok).toBeUndefined();
			expect((await root`select erledigt_am from app.todos where id = ${t.id}`)[0].erledigt_am).not.toBeNull();
			const verboten = (await seitenAktionen.anlegen({
				...ort(monteurA),
				request: formAnfrage({ titel: 'x' })
			} as never)) as any;
			expect(verboten.status).toBe(403);
			const morgen = tagPlus(berlinTag(new Date()), 1);
			expect(
				await seitenAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage({ titel: 'Neu', zustaendigId: monteurAId, faellig: morgen, auftragId: '' })
				} as never)
			).toBeUndefined();
			const [neu] = await root`select id, faellig::text from app.todos where titel = 'Neu'`;
			expect(neu.faellig).toBe(morgen);
			const fehler = (await seitenAktionen.anlegen({ ...ort(chefA), request: formAnfrage({ titel: '' }) } as never)) as any;
			expect(fehler.status).toBe(400);
			expect(((await seitenAktionen.loeschen({ ...ort(monteurA), request: formAnfrage({ id: neu.id }) } as never)) as any).status).toBe(403);
			expect(await seitenAktionen.loeschen({ ...ort(chefA), request: formAnfrage({ id: neu.id }) } as never)).toBeUndefined();
			expect(await root`select 1 from app.todos where id = ${neu.id}`).toHaveLength(0);
		});

		it('„+ To-do“ mit Beschreibung (To-do-Seite und Auftragsseite); zu lang → 400 mit Eingaben zurück', async () => {
			expect(
				await seitenAktionen.anlegen({
					...ort(chefA),
					request: formAnfrage({ titel: 'Mit Text', beschreibung: ' Schlüssel beim Nachbarn ', zustaendigId: '', faellig: '' })
				} as never)
			).toBeUndefined();
			expect((await root`select beschreibung from app.todos where titel = 'Mit Text'`)[0].beschreibung).toBe(
				'Schlüssel beim Nachbarn'
			);
			expect(
				await auftragAktionen.todoAnlegen({
					...ort(chefA),
					params: { id: auftragA },
					request: formAnfrage({ titel: 'Am Auftrag mit Text', beschreibung: 'Zugang über Hof' })
				} as never)
			).toBeUndefined();
			const [z] = await root`select auftrag_id, beschreibung from app.todos where titel = 'Am Auftrag mit Text'`;
			expect(z).toEqual({ auftrag_id: auftragA, beschreibung: 'Zugang über Hof' });
			expect(
				await seitenAktionen.anlegen({ ...ort(chefA), request: formAnfrage({ titel: 'Ohne Text', beschreibung: '' }) } as never)
			).toBeUndefined();
			expect((await root`select beschreibung from app.todos where titel = 'Ohne Text'`)[0].beschreibung).toBeNull();
			const fehler = (await seitenAktionen.anlegen({
				...ort(chefA),
				request: formAnfrage({ titel: 'Zu lang', beschreibung: 'x'.repeat(501) })
			} as never)) as any;
			expect(fehler.status).toBe(400);
			expect(fehler.data.todoWerte).toMatchObject({ titel: 'Zu lang' });
			expect(await root`select 1 from app.todos where titel = 'Zu lang'`).toHaveLength(0);
		});

		it('„aendern“ ändert nur gesendete Felder (Kanban-Ziehen sendet nur Fälligkeit); Beschreibung änderbar', async () => {
			const t = await legeTodoAn(kA(), { titel: 'Ziehen', beschreibung: 'bleibt', zustaendigId: monteurAId });
			const heute = berlinTag(new Date());
			expect(
				await seitenAktionen.aendern({ ...ort(chefA), request: formAnfrage({ id: t.id, faellig: heute }) } as never)
			).toBeUndefined();
			let [z] = await root`select titel, beschreibung, zustaendig_id, faellig::text from app.todos where id = ${t.id}`;
			expect(z).toEqual({ titel: 'Ziehen', beschreibung: 'bleibt', zustaendig_id: monteurAId, faellig: heute });
			expect(
				await seitenAktionen.aendern({ ...ort(chefA), request: formAnfrage({ id: t.id, beschreibung: 'neu' }) } as never)
			).toBeUndefined();
			[z] = await root`select titel, beschreibung, faellig::text from app.todos where id = ${t.id}`;
			expect(z).toEqual({ titel: 'Ziehen', beschreibung: 'neu', faellig: heute });
			await root`update app.todos set erledigt_am = now() where id = ${t.id}`;
			expect(
				await seitenAktionen.aendern({
					...ort(chefA),
					request: formAnfrage({ id: t.id, erledigt: 'false', faellig: '' })
				} as never)
			).toBeUndefined();
			[z] = await root`select erledigt_am, faellig from app.todos where id = ${t.id}`;
			expect(z).toEqual({ erledigt_am: null, faellig: null });
			const zuLang = (await seitenAktionen.aendern({
				...ort(chefA),
				request: formAnfrage({ id: t.id, beschreibung: 'x'.repeat(501) })
			} as never)) as any;
			expect(zuLang.status).toBe(400);
		});

		it('Auftragsseite: To-do-Bereich mit „+ To-do“ (Chef), Abhaken dort', async () => {
			await legeTodoAn(kA(), { titel: 'Am Auftrag', auftragId: auftragA, zustaendigId: monteurAId });
			await legeTodoAn(kA(), { titel: 'Anderswo', auftragId: auftrag2A });
			const d = (await auftragLoad({ ...ort(chefA), params: { id: auftragA } } as never)) as any;
			expect(d.todos.map((t: any) => t.titel)).toEqual(['Am Auftrag']);
			expect(d.mitarbeiter.length).toBeGreaterThan(0);
			expect(
				await auftragAktionen.todoAnlegen({
					...ort(chefA),
					params: { id: auftragA },
					request: formAnfrage({ titel: 'Neu am Auftrag', zustaendigId: '', faellig: '' })
				} as never)
			).toBeUndefined();
			const [z] = await root`select auftrag_id from app.todos where titel = 'Neu am Auftrag'`;
			expect(z.auftrag_id).toBe(auftragA);
			const [t] = await root`select id from app.todos where titel = 'Am Auftrag'`;
			const m = (await auftragLoad({ ...ort(monteurA), params: { id: auftragA } } as never)) as any;
			expect(m.todos.map((x: any) => x.titel).sort()).toEqual(['Am Auftrag', 'Neu am Auftrag']);
			expect(
				await auftragAktionen.todoUmschalten({
					...ort(monteurA),
					params: { id: auftragA },
					request: formAnfrage({ id: t.id, erledigt: 'true' })
				} as never)
			).toBeUndefined();
			expect(
				((await auftragAktionen.todoAnlegen({
					...ort(monteurA),
					params: { id: auftragA },
					request: formAnfrage({ titel: 'x' })
				} as never)) as any).status
			).toBe(403);
		});
	});

	it('Beschreibung: anlegen, lesen, ändern (bleibt bei anderen Änderungen), leeren; zu lang → 400', async () => {
		const r = await post(chefA, { titel: 'Filter', auftragId: auftragA, beschreibung: '  Typ F7 nehmen ' });
		expect(r.status).toBe(201);
		expect(r.koerper).toMatchObject({ titel: 'Filter', beschreibung: 'Typ F7 nehmen' });
		const id = r.koerper.id as string;
		expect((await get(chefA, id)).koerper.beschreibung).toBe('Typ F7 nehmen');
		expect((await patch(chefA, id, { beschreibung: 'Typ F9' })).koerper).toMatchObject({ titel: 'Filter', beschreibung: 'Typ F9' });
		expect((await patch(chefA, id, { titel: 'Filter neu' })).koerper).toMatchObject({ beschreibung: 'Typ F9' });
		expect((await patch(chefA, id, { beschreibung: '' })).koerper).toMatchObject({ beschreibung: null });
		expect((await post(chefA, { titel: 'x', beschreibung: 'a'.repeat(501) })).status).toBe(400);
		expect((await post(chefA, { titel: 'ohne' })).koerper.beschreibung).toBeNull();
	});

	it('Lautstärke und Schmutz (3 Stufen: 1 gering, 2 mittel, 3 hoch; optional): anlegen, ändern, leeren; außerhalb → 400', async () => {
		const r = await post(chefA, { titel: 'Stemmen', auftragId: auftragA, lautstaerke: 3, schmutz: '2' });
		expect(r.status).toBe(201);
		expect(r.koerper).toMatchObject({ lautstaerke: 3, schmutz: 2 });
		const id = r.koerper.id as string;
		expect((await patch(chefA, id, { schmutz: 1 })).koerper).toMatchObject({ lautstaerke: 3, schmutz: 1 });
		expect((await patch(chefA, id, { lautstaerke: '' })).koerper).toMatchObject({ lautstaerke: null, schmutz: 1 });
		expect((await post(chefA, { titel: 'ohne' })).koerper).toMatchObject({ lautstaerke: null, schmutz: null });
		for (const falsch of [0, 4, 5, 2.5, 'laut', '-1']) {
			expect((await post(chefA, { titel: 'x', lautstaerke: falsch })).status, String(falsch)).toBe(400);
			expect((await post(chefA, { titel: 'x', schmutz: falsch })).status, String(falsch)).toBe(400);
		}
		// Seite: „+ To-do“ im Auftrag mit beiden Stufen
		expect(
			await auftragAktionen.todoAnlegen({
				locals: { nutzer: chefA },
				params: { id: auftragA },
				request: formAnfrage({ titel: 'Fliesen abschlagen', lautstaerke: '3', schmutz: '2' })
			} as never)
		).toBeUndefined();
		const [z] = await root`select lautstaerke, schmutz from app.todos where titel = 'Fliesen abschlagen'`;
		expect(z).toEqual({ lautstaerke: 3, schmutz: 2 });
		// Karte „Bearbeiten“: Stufen ändern/leeren über die Aktion „aendern“
		const [{ id: tid }] = await root`select id from app.todos where titel = 'Fliesen abschlagen'`;
		expect(
			await auftragAktionen.todoAendern({
				locals: { nutzer: chefA },
				params: { id: auftragA },
				request: formAnfrage({ id: tid, titel: 'Fliesen abschlagen', beschreibung: 'mit Staubschutz', lautstaerke: '2', schmutz: '' })
			} as never)
		).toBeUndefined();
		const [z2] = await root`select lautstaerke, schmutz, beschreibung from app.todos where id = ${tid}`;
		expect(z2).toEqual({ lautstaerke: 2, schmutz: null, beschreibung: 'mit Staubschutz' });
	});

	it('legeTodosAn: mehrere To-dos in Reihenfolge mit Beschreibung; ungültiges → keins angelegt; unsichtbarer Auftrag → 400', async () => {
		const liste = [
			{ titel: 'Filter wechseln', beschreibung: 'F7' },
			{ titel: 'Brenner reinigen', beschreibung: null },
			{ titel: 'Abgas messen', beschreibung: 'Protokoll ausfüllen' }
		];
		const neu = await legeTodosAn(kA(), auftragA, liste);
		expect(neu.map((t) => [t.titel, t.beschreibung, t.auftragId])).toEqual([
			['Filter wechseln', 'F7', auftragA],
			['Brenner reinigen', null, auftragA],
			['Abgas messen', 'Protokoll ausfüllen', auftragA]
		]);
		const gelesen = await listeTodos(kA(), { alle: true, benutzerId: chefAId }, { auftragId: auftragA });
		expect(gelesen.map((t) => t.titel)).toEqual(['Filter wechseln', 'Brenner reinigen', 'Abgas messen']);

		await expect(legeTodosAn(kA(), auftrag2A, [{ titel: 'ok' }, { titel: '' }])).rejects.toMatchObject({ status: 400 });
		await expect(legeTodosAn(kA(), auftrag2A, [{ titel: 'ok', beschreibung: 'a'.repeat(501) }])).rejects.toMatchObject({
			status: 400
		});
		expect(await root`select 1 from app.todos where auftrag_id = ${auftrag2A}`).toHaveLength(0);
		await expect(legeTodosAn(kA(), auftragB, [{ titel: 'fremd' }])).rejects.toMatchObject({ status: 400 });
		const nurEigene = { alle: false, benutzerId: monteurAId };
		await expect(legeTodosAn(kA(), auftrag2A, [{ titel: 'x' }], nurEigene)).rejects.toMatchObject({ status: 400 });
		expect(await legeTodosAn(kA(), auftragA, [])).toEqual([]);
	});

	it('Schreiben ohne alle_lesen: To-dos unsichtbarer Aufträge → 404 (ändern, löschen), Anlegen daran → 400', async () => {
		const schreiber = nutzerVon(monteurAId, betriebA, ['auftraege.lesen', 'auftraege.bearbeiten']);
		const fremd = await legeTodoAn(kA(), { titel: 'Fremd', auftragId: auftrag2A, zustaendigId: monteur2AId });
		const meins = await legeTodoAn(kA(), { titel: 'Meins', auftragId: auftragA, zustaendigId: monteurAId });
		expect((await patch(schreiber, fremd.id, { titel: 'Gehackt' })).status).toBe(404);
		expect((await patch(schreiber, fremd.id, { erledigt: true })).status).toBe(404);
		expect((await del(schreiber, fremd.id)).status).toBe(404);
		expect((await post(schreiber, { titel: 'x', auftragId: auftrag2A })).status).toBe(400);
		expect((await patch(schreiber, meins.id, { titel: 'Meins neu' })).status).toBe(200);
		// To-do im sichtbaren Auftrag anlegen geht
		expect((await post(schreiber, { titel: 'Neu', auftragId: auftragA })).status).toBe(201);
		const [z] = await root`select titel, erledigt_am from app.todos where id = ${fremd.id}`;
		expect(z).toEqual({ titel: 'Fremd', erledigt_am: null });
	});
});
