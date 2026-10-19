import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { aendereTodo, beendeSerie, legeTodoAn, listeTodos, setzeErledigt, todoSichtVon } from '../../src/lib/server/todos';
import { actions as auftragAktionen } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Wiederkehrende To-dos (Wunsch Jamil, msg 2501): Serie + Instanzen, nächste beim Abhaken. */
describe('Wiederkehrende To-dos', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kMonteur = () => ({ betriebId: u.betriebA, benutzerId: u.ids.monteurA });
	const heute = () => berlinTag(new Date());
	const instanzen = async (serieId: string) =>
		(await root`
			select titel, beschreibung, auftrag_id, zustaendig_id, lautstaerke, schmutz, to_char(faellig, 'YYYY-MM-DD') as faellig,
				erledigt_am is not null as erledigt
			from app.todos where serie_id = ${serieId} order by faellig`) as any[];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.todos`;
		await root`delete from app.todo_serien`;
	});

	it('anlegen mit Regel; Abhaken legt die nächste Instanz an (gleicher Auftrag, Zuständiger, Texte, Stufen)', async () => {
		const start = tagPlus(heute(), 14);
		const t = await legeTodoAn(kA(), {
			titel: 'Filter prüfen',
			beschreibung: 'Wartung',
			auftragId: u.auftragA,
			zustaendigId: u.ids.monteurA,
			faellig: start,
			lautstaerke: '1',
			schmutz: '2',
			wiederholung: 'woechentlich',
			intervall: '2'
		});
		expect(t.serie).toMatchObject({ text: 'alle 2 Wochen', aktiv: true });
		await aendereTodo(kA(), t.id, { erledigt: true });
		const liste = await instanzen(t.serie!.id);
		expect(liste).toEqual([
			{ titel: 'Filter prüfen', beschreibung: 'Wartung', auftrag_id: u.auftragA, zustaendig_id: u.ids.monteurA, lautstaerke: 1, schmutz: 2, faellig: start, erledigt: true },
			{ titel: 'Filter prüfen', beschreibung: 'Wartung', auftrag_id: u.auftragA, zustaendig_id: u.ids.monteurA, lautstaerke: 1, schmutz: 2, faellig: tagPlus(start, 14), erledigt: false }
		]);
		// erneut öffnen und abhaken: keine doppelte Instanz
		await aendereTodo(kA(), t.id, { erledigt: false });
		await aendereTodo(kA(), t.id, { erledigt: true });
		expect(await instanzen(t.serie!.id)).toHaveLength(2);
	});

	it('Zuständiger hakt selbst ab (setzeErledigt) → nächste Instanz; überfällig abgehakt → nächster Termin nach heute', async () => {
		const vorbei = tagPlus(heute(), -10);
		const t = await legeTodoAn(kA(), { titel: 'Täglich lüften', zustaendigId: u.ids.monteurA, faellig: vorbei, wiederholung: 'taeglich' });
		await setzeErledigt(kMonteur(), todoSichtVon(u.monteurA), t.id, true);
		const liste = await instanzen(t.serie!.id);
		expect(liste.map((i) => [i.faellig, i.erledigt])).toEqual([
			[vorbei, true],
			[tagPlus(heute(), 1), false]
		]);
	});

	it('monatlich mit Ende: nach dem letzten Termin keine neue Instanz', async () => {
		const start = tagPlus(heute(), 5);
		const t = await legeTodoAn(kA(), { titel: 'Monatlich', faellig: start, wiederholung: 'monatlich', wiederholungEnde: tagPlus(start, 20) });
		await aendereTodo(kA(), t.id, { erledigt: true });
		expect(await instanzen(t.serie!.id)).toHaveLength(1);
	});

	it('Serie beenden: bestehende To-dos bleiben, beim Abhaken entsteht keine neue', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Jährlich', faellig: tagPlus(heute(), 3), wiederholung: 'jaehrlich' });
		await beendeSerie(kA(), t.id);
		const neu = (await listeTodos(kA(), todoSichtVon(u.chefA), { nur: 'alle' })).find((x) => x.id === t.id)!;
		expect(neu.serie).toMatchObject({ aktiv: false });
		await aendereTodo(kA(), t.id, { erledigt: true });
		expect(await instanzen(t.serie!.id)).toHaveLength(1);
	});

	it('ohne Fälligkeit startet die Serie heute; ungültige Regel/Intervall/Ende → 400', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Ohne Datum', wiederholung: 'woechentlich' });
		expect(t.faellig).toBe(heute());
		await expect(legeTodoAn(kA(), { titel: 'x', wiederholung: 'stuendlich' })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'x', wiederholung: 'taeglich', intervall: '0' })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'x', wiederholung: 'taeglich', faellig: heute(), wiederholungEnde: tagPlus(heute(), -1) })).rejects.toMatchObject({
			status: 400
		});
		// ohne Wiederholung wie bisher
		expect((await legeTodoAn(kA(), { titel: 'Einmalig', wiederholung: '' })).serie).toBeNull();
	});

	it('Auftragsseite: „+ To-do“ mit Wiederholung (z. B. Wartung) und Aktion „todoSerieBeenden“', async () => {
		const body = new URLSearchParams({ titel: 'Wartung Heizung', wiederholung: 'jaehrlich', intervall: '1', faellig: tagPlus(heute(), 30) });
		expect(
			await auftragAktionen.todoAnlegen({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, request: new Request('http://localhost/x', { method: 'POST', body }) } as never)
		).toBeUndefined();
		const [t] = await root`select id, serie_id from app.todos where titel = 'Wartung Heizung'`;
		expect(t.serie_id).not.toBeNull();
		expect(
			await auftragAktionen.todoSerieBeenden({
				locals: { nutzer: u.chefA },
				params: { id: u.auftragA },
				request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams({ id: t.id }) })
			} as never)
		).toBeUndefined();
		expect((await root`select aktiv from app.todo_serien where id = ${t.serie_id}`)[0].aktiv).toBe(false);
		const verboten = (await auftragAktionen.todoSerieBeenden({
			locals: { nutzer: u.monteurA },
			params: { id: u.auftragA },
			request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams({ id: t.id }) })
		} as never)) as any;
		expect(verboten.status).toBe(403);
	});
});
