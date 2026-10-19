import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { holeAuftrag, legeAuftragAn, listeAuftraege, sichtVon } from '../../src/lib/server/auftraege';
import { legeTodoAn, listeTodos, todoSichtVon } from '../../src/lib/server/todos';
import { holeVorlage } from '../../src/lib/server/auftrag-vorlagen';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { actions as auftragAktionen } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { actions as neuAktionen } from '../../src/routes/(app)/auftraege/neu/+page.server';
import { actions as vorlageNeuAktionen } from '../../src/routes/(app)/auftrag-vorlagen/neu/+page.server';
import { load as todosLoad } from '../../src/routes/(app)/todos/+page.server';
import { baueUmgebung, nutzerVon, type Umgebung } from './hilfe-1c';

/**
 * Wünsche Jamil (msgs 2483–2500): Mitarbeiter je Auftrag direkt im Auftrag zuweisen, Felder ohne „Bearbeiten“ ändern,
 * „Meine Aufträge“ / „Meine To-dos“ (auch über die Zuständigkeit am Auftrag), Recht „Alle To-dos ansehen“, Filter,
 * Stufen (gering/mittel/hoch) auch in Auftrags-Vorlagen.
 */
describe('Mitarbeiter am Auftrag, Meine Aufträge/To-dos, Sicht', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const form = (felder: [string, string][]) => {
		const b = new URLSearchParams();
		for (const [k, v] of felder) b.append(k, v);
		return new Request('http://localhost/x', { method: 'POST', body: b });
	};
	const umleitung = async (fn: () => unknown) => {
		try {
			return { ergebnis: (await fn()) as any };
		} catch (e: any) {
			if (e?.status === 303) return { ort: e.location as string };
			throw e;
		}
	};

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
	});

	it('Auftragsseite „aendern“: Mitarbeiter (mehrere), Objekt, Geplant ab, Beschreibung – nur gesendete Felder; Monteur 403', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Inline', kundeId: u.kundeA, beschreibung: 'bleibt' });
		const r = await auftragAktionen.aendern({
			locals: { nutzer: u.chefA },
			params: { id: a.id },
			request: form([
				['zustaendigeGesendet', '1'],
				['zustaendige', u.ids.monteurA],
				['zustaendige', u.ids.bueroA]
			])
		} as never);
		expect(r).toEqual({ gespeichert: true });
		let n = await holeAuftrag(kA(), sichtVon(u.chefA), a.id);
		expect(n.zustaendige.map((z) => z.id).sort()).toEqual([u.ids.monteurA, u.ids.bueroA].sort());
		expect(n.beschreibung).toBe('bleibt');
		await auftragAktionen.aendern({
			locals: { nutzer: u.chefA },
			params: { id: a.id },
			request: form([['objektId', u.objektA]])
		} as never);
		await auftragAktionen.aendern({
			locals: { nutzer: u.chefA },
			params: { id: a.id },
			request: form([['geplantAb', '2026-11-03']])
		} as never);
		n = await holeAuftrag(kA(), sichtVon(u.chefA), a.id);
		expect(n).toMatchObject({ objektId: u.objektA, geplantAb: '2026-11-03', beschreibung: 'bleibt', titel: 'Inline' });
		expect(n.zustaendige).toHaveLength(2);
		const falsch = (await auftragAktionen.aendern({
			locals: { nutzer: u.chefA },
			params: { id: a.id },
			request: form([['geplantAb', 'morgen']])
		} as never)) as any;
		expect(falsch.status).toBe(400);
		expect(falsch.data.aendernFehler).toMatch(/Datum/);
		const verboten = (await auftragAktionen.aendern({
			locals: { nutzer: u.monteurA },
			params: { id: a.id },
			request: form([['beschreibung', 'x']])
		} as never)) as any;
		expect(verboten.status).toBe(403);
	});

	it('„Meine Aufträge“: zuständig, eigenes To-do oder eigener Termin – mit Grund; Chef kann umschalten', async () => {
		const zustaendig = await legeAuftragAn(kA(), { titel: 'Zuständig', kundeId: u.kundeA, zustaendige: [u.ids.monteurA] });
		const mitTodo = await legeAuftragAn(kA(), { titel: 'Mit To-do', kundeId: u.kundeA });
		await legeTodoAn(kA(), { titel: 'Silikon', auftragId: mitTodo.id, zustaendigId: u.ids.monteurA });
		const fremd = await legeAuftragAn(kA(), { titel: 'Fremd', kundeId: u.kundeA });
		const monteur = await listeAuftraege(kA(), sichtVon(u.monteurA), {});
		const ids = monteur.map((a) => a.id);
		expect(ids).toContain(zustaendig.id);
		expect(ids).toContain(mitTodo.id);
		expect(ids).not.toContain(fremd.id);
		expect(monteur.find((a) => a.id === zustaendig.id)!.meinBezug).toEqual(['zustaendig']);
		expect(monteur.find((a) => a.id === mitTodo.id)!.meinBezug).toEqual(['todo']);
		// Chef: Alle vs. Meine
		await legeAuftragAn(kA(), { titel: 'Chef zuständig', kundeId: u.kundeA, zustaendige: [u.ids.chefA] });
		const alle = await listeAuftraege(kA(), sichtVon(u.chefA), {});
		const meine = await listeAuftraege(kA(), sichtVon(u.chefA), { meine: true });
		expect(alle.length).toBeGreaterThan(meine.length);
		expect(meine.map((a) => a.titel)).toEqual(['Chef zuständig']);
	});

	it('„Meine To-dos“: direkt zugewiesene + alle To-dos aus Aufträgen, für die man zuständig ist (Quelle markiert)', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Wartung', kundeId: u.kundeA, zustaendige: [u.ids.monteurA] });
		await legeTodoAn(kA(), { titel: 'Filter', auftragId: a.id });
		await legeTodoAn(kA(), { titel: 'Direkt', zustaendigId: u.ids.monteurA });
		await legeTodoAn(kA(), { titel: 'Fremd', zustaendigId: u.ids.bueroA });
		const meine = await listeTodos(kA(), todoSichtVon(u.monteurA), { nur: 'meine' });
		expect(meine.map((t) => [t.titel, t.mirDirekt]).sort()).toEqual([
			['Direkt', true],
			['Filter', false]
		]);
		const d = (await todosLoad({ locals: { nutzer: u.monteurA }, url: new URL('http://localhost/todos') } as never)) as any;
		expect(d.reiter).toEqual(['meine']);
		expect(d.todos.map((t: any) => t.titel).sort()).toEqual(['Direkt', 'Filter']);
	});

	it('Recht „Alle To-dos ansehen“: Chef/Büro alle (auch über Reiter), Monteur nur eigene – auch über die API-Sicht', async () => {
		await legeTodoAn(kA(), { titel: 'Büro-Aufgabe', zustaendigId: u.ids.bueroA });
		await legeTodoAn(kA(), { titel: 'Monteur-Aufgabe', zustaendigId: u.ids.monteurA });
		expect(VORLAGEN.chef).toContain('todos.alle_lesen');
		expect(VORLAGEN.buero).toContain('todos.alle_lesen');
		expect(VORLAGEN.monteur).not.toContain('todos.alle_lesen');
		expect((await listeTodos(kA(), todoSichtVon(u.chefA), { nur: 'alle' })).map((t) => t.titel).sort()).toEqual([
			'Büro-Aufgabe',
			'Monteur-Aufgabe'
		]);
		expect((await listeTodos(kA(), todoSichtVon(u.monteurA), { nur: 'alle' })).map((t) => t.titel)).toEqual(['Monteur-Aufgabe']);
		// Monteur mit dem zusätzlichen Recht sieht alle To-dos
		const monteurPlus = nutzerVon(u.ids.monteurA, u.betriebA, [...VORLAGEN.monteur, 'todos.alle_lesen']);
		expect((await listeTodos(kA(), todoSichtVon(monteurPlus), { nur: 'alle' })).length).toBe(2);
		// Auftrags-Recht allein reicht nicht mehr für alle To-dos
		const nurAuftraege = nutzerVon(u.ids.monteurA, u.betriebA, ['auftraege.alle_lesen']);
		expect((await listeTodos(kA(), todoSichtVon(nurAuftraege), { nur: 'alle' })).map((t) => t.titel)).toEqual(['Monteur-Aufgabe']);
		// Bestehende Rollen mit „Alle Aufträge“ bekamen das neue Recht per Migration 030
		const ohne = await root`select name from app.rollen where 'auftraege.alle_lesen' = any(rechte) and not ('todos.alle_lesen' = any(rechte))`;
		expect(ohne.filter((r) => r.name === 'Chef' || r.name === 'Büro')).toEqual([]);
	});

	it('Filter „zugewiesen an“ und „Status“ (kombinierbar mit den Reitern)', async () => {
		const t1 = await legeTodoAn(kA(), { titel: 'A offen', zustaendigId: u.ids.bueroA });
		await legeTodoAn(kA(), { titel: 'B offen', zustaendigId: u.ids.monteurA });
		const t3 = await legeTodoAn(kA(), { titel: 'A erledigt', zustaendigId: u.ids.bueroA });
		await root`update app.todos set erledigt_am = now() where id = ${t3.id}`;
		const lade = async (q: string) =>
			((await todosLoad({ locals: { nutzer: u.chefA }, url: new URL(`http://localhost/todos?${q}`) } as never)) as any).todos.map(
				(t: any) => t.titel
			);
		expect((await lade(`nur=alle&person=${u.ids.bueroA}`)).sort()).toEqual(['A erledigt', 'A offen']);
		expect(await lade(`nur=alle&person=${u.ids.bueroA}&status=offen`)).toEqual(['A offen']);
		expect(await lade(`nur=alle&status=erledigt`)).toEqual(['A erledigt']);
		expect(t1.titel).toBe('A offen');
	});

	it('Auftrags-Vorlage mit Stufen und Beschreibungen (Neu-Formular) → im Auftrag übernommen', async () => {
		const r = await umleitung(() =>
			vorlageNeuAktionen.default({
				locals: { nutzer: u.chefA },
				request: form([
					['name', 'Abbruch Bad'],
					['todo_0', 'Fliesen abschlagen'],
					['todo_beschreibung_0', 'Staubschutz aufbauen'],
					['todo_lautstaerke_0', '3'],
					['todo_schmutz_0', '3'],
					['todo_1', 'Bauschutt entsorgen'],
					['todo_lautstaerke_1', ''],
					['todo_schmutz_1', '2']
				])
			} as never)
		);
		const vid = r.ort!.split('/').pop()!;
		const v = await holeVorlage(kA(), vid);
		expect(v.todos.map((t) => [t.titel, t.beschreibung, t.lautstaerke, t.schmutz])).toEqual([
			['Fliesen abschlagen', 'Staubschutz aufbauen', 3, 3],
			['Bauschutt entsorgen', null, null, 2]
		]);
		// Neuer Auftrag mit den To-dos der Vorlage (das Formular schickt die Stufen mit)
		const n = await umleitung(() =>
			neuAktionen.anlegen({
				locals: { nutzer: u.chefA },
				request: form([
					['kundeId', u.kundeA],
					['titel', 'Bad mit Vorlage'],
					['todo_0', 'Fliesen abschlagen'],
					['todo_beschreibung_0', 'Staubschutz aufbauen'],
					['todo_lautstaerke_0', '3'],
					['todo_schmutz_0', '3']
				])
			} as never)
		);
		const aid = n.ort!.split('/').pop()!;
		const [t] = await root`select lautstaerke, schmutz, beschreibung from app.todos where auftrag_id = ${aid}`;
		expect(t).toEqual({ lautstaerke: 3, schmutz: 3, beschreibung: 'Staubschutz aufbauen' });
	});
});
