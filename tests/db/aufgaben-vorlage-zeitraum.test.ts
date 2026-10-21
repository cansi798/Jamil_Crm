import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { legeVorlageAn, wendeVorlageAn } from '../../src/lib/server/auftrag-vorlagen';
import { aendereTodo, legeTodoAn, listeTodos, setzeErledigt, todoSichtVon } from '../../src/lib/server/todos';
import { listeAuftraege, sichtVon } from '../../src/lib/server/auftraege';
import { actions as auftragAktionen, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

/**
 * Aufgaben-Vorlage auf einen bestehenden Auftrag anwenden (Jamil msg 2975) und Mitarbeiter/Zeitraum je Aufgabe
 * (msgs 2977/2978): Doppelte, Verlauf, Rechte, Sichtbarkeit über die Aufgabe, Sprache.
 */
describe('Aufgaben: Vorlage übernehmen, Mitarbeiter und Zeitraum', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let vorlageId: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const form = (felder: [string, string][]) => {
		const body = new URLSearchParams();
		for (const [k, v] of felder) body.append(k, v);
		return new Request('http://localhost/x', { method: 'POST', body });
	};
	const anwenden = (nutzer: Nutzer, auftrag: string, felder: [string, string][]) =>
		auftragAktionen.vorlageAnwenden({ locals: { nutzer }, params: { id: auftrag }, request: form(felder) } as never) as Promise<any>;
	const titelAm = async (auftrag: string) =>
		(await root`select titel from app.todos where auftrag_id = ${auftrag} order by angelegt, titel`).map((r) => r.titel as string);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		setzeKiAnbieter(new FakeKi());
		vorlageId = (
			await legeVorlageAn(kA(), {
				name: 'Badsanierung',
				todos: [
					{ titel: 'Fliesen abschlagen', lautstaerke: 3, schmutz: 3 },
					{ titel: 'Silikon fugen', lautstaerke: 1 },
					{ titel: 'Abnahme mit Kunde' }
				]
			})
		).id;
	});
	beforeEach(async () => {
		await root`delete from app.todos`;
		await root`delete from app.auftrag_zustaendige`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('übernimmt alle Aufgaben mit Stufen und Herkunft; Verlauf zeigt die Übernahme', async () => {
		const r = await anwenden(u.chefA, u.auftragA, [['vorlageId', vorlageId]]);
		expect(r).toEqual({ vorlageErgebnis: { name: 'Badsanierung', angelegt: 3, uebersprungen: [] } });
		const t = await root`
			select titel, lautstaerke, schmutz, vorlage_id, vorlage_aufgabe, zustaendig_id, faellig from app.todos where auftrag_id = ${u.auftragA} order by angelegt`;
		expect(t.map((x) => x.titel)).toEqual(['Fliesen abschlagen', 'Silikon fugen', 'Abnahme mit Kunde']);
		expect(t[0]).toMatchObject({ lautstaerke: 3, schmutz: 3, vorlage_id: vorlageId, vorlage_aufgabe: 'Fliesen abschlagen', zustaendig_id: null, faellig: null });
		const d = (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id: u.auftragA } } as never)) as any;
		expect(d.verlauf.map((v: any) => v.titel)).toContain('Aufgaben-Vorlage „Badsanierung“ übernommen (3 Aufgaben)');
		expect(d.aufgabenVorlagen.map((v: any) => v.name)).toEqual(['Badsanierung']);
	});

	it('Doppelte: „nur fehlende“ (Standard) überspringt gleichnamige, „alle“ legt sie trotzdem an', async () => {
		await legeTodoAn(kA(), { titel: '  silikon  FUGEN ', auftragId: u.auftragA });
		const f = await anwenden(u.chefA, u.auftragA, [['vorlageId', vorlageId], ['modus', 'fehlende']]);
		expect(f.vorlageErgebnis).toEqual({ name: 'Badsanierung', angelegt: 2, uebersprungen: ['Silikon fugen'] });
		expect((await titelAm(u.auftragA)).length).toBe(3);
		// Zweites Mal „nur fehlende“: nichts mehr dazu
		const nochmal = await anwenden(u.chefA, u.auftragA, [['vorlageId', vorlageId]]);
		expect(nochmal.vorlageErgebnis.angelegt).toBe(0);
		expect(nochmal.vorlageErgebnis.uebersprungen).toHaveLength(3);
		// „alle“: alle drei noch einmal
		const alle = await anwenden(u.chefA, u.auftragA, [['vorlageId', vorlageId], ['modus', 'alle']]);
		expect(alle.vorlageErgebnis).toEqual({ name: 'Badsanierung', angelegt: 3, uebersprungen: [] });
		expect((await titelAm(u.auftragA)).length).toBe(6);
		const unsinn = await anwenden(u.chefA, u.auftragA, [['vorlageId', vorlageId], ['modus', 'xyz']]);
		expect(unsinn.status).toBe(400);
	});

	it('gemeinsame Mitarbeiter und Zeitraum für alle neuen Aufgaben', async () => {
		const r = await anwenden(u.chefA, u.auftragA, [
			['vorlageId', vorlageId],
			['mitarbeiterFeld', '1'],
			['mitarbeiterIds', u.ids.monteurA],
			['mitarbeiterIds', u.ids.bueroA],
			['vonTag', '2026-11-02'],
			['faellig', '2026-11-04']
		]);
		expect(r.vorlageErgebnis.angelegt).toBe(3);
		const t = await listeTodos(kA(), todoSichtVon(u.chefA), { auftragId: u.auftragA });
		for (const x of t) {
			expect(x).toMatchObject({ vonTag: '2026-11-02', faellig: '2026-11-04', zustaendigId: u.ids.monteurA });
			expect(x.mitarbeiter.map((m) => m.id)).toEqual([u.ids.monteurA, u.ids.bueroA]);
		}
	});

	it('Rechte wie „Aufgabe anlegen“: Monteur nicht, fremder Betrieb nicht, fremde Vorlage nicht', async () => {
		const m = await anwenden(u.monteurA, u.auftragA, [['vorlageId', vorlageId]]);
		expect(m.status).toBe(403);
		const b = await anwenden(u.chefB, u.auftragB, [['vorlageId', vorlageId]]);
		expect(b.status).toBe(404);
		const fremd = await anwenden(u.chefA, u.auftragB, [['vorlageId', vorlageId]]);
		expect(fremd.status).toBe(400);
		expect(await titelAm(u.auftragA)).toEqual([]);
		// Sicht ohne „Alle Aufträge ansehen“: nur sichtbare Aufträge
		await expect(
			wendeVorlageAn({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA, auftraegeAlle: false }, u.auftragA, vorlageId)
		).rejects.toMatchObject({ status: 400 });
	});

	it('mehrere Mitarbeiter je Aufgabe (jeder des Betriebs); Zugewiesene sehen den Auftrag in „Meine Aufträge“ und dürfen abhaken', async () => {
		const meine = async (n: Nutzer) => (await listeAuftraege({ betriebId: u.betriebA, benutzerId: n.id }, sichtVon(n), { meine: true })).map((a) => a.id);
		expect(await meine(u.monteurA)).not.toContain(u.auftragA);
		const t = await legeTodoAn(kA(), { titel: 'Fliesen legen', auftragId: u.auftragA, mitarbeiterIds: [u.ids.bueroA, u.ids.monteurA] });
		expect(t.zustaendigId).toBe(u.ids.bueroA);
		expect(t.mitarbeiter.map((m) => m.name)).toEqual(['Büro A', 'Ali Monteur']);
		// Zweiter Mitarbeiter (nicht dem Auftrag zugewiesen): sieht Auftrag und Aufgabe, darf abhaken
		expect(await meine(u.monteurA)).toContain(u.auftragA);
		const mk = { betriebId: u.betriebA, benutzerId: u.ids.monteurA };
		const mine = await listeTodos(mk, todoSichtVon(u.monteurA), { nur: 'meine' });
		expect(mine.map((x) => x.id)).toContain(t.id);
		expect((await setzeErledigt(mk, todoSichtVon(u.monteurA), t.id, true)).erledigt).toBe(true);
		// Liste leeren: niemand zugewiesen, Monteur sieht den Auftrag nicht mehr
		const leer = await aendereTodo(kA(), t.id, { mitarbeiterIds: [], erledigt: false });
		expect(leer).toMatchObject({ zustaendigId: null, mitarbeiter: [] });
		expect(await meine(u.monteurA)).not.toContain(u.auftragA);
		// Alter Weg (nur Zuständiger): landet auch in der Liste (Trigger), ersetzt beim Ändern den bisherigen Zuständigen
		const alt = await legeTodoAn(kA(), { titel: 'Material holen', auftragId: u.auftragA, zustaendigId: u.ids.monteurA });
		expect(alt.mitarbeiter.map((m) => m.id)).toEqual([u.ids.monteurA]);
		await aendereTodo(kA(), alt.id, { mitarbeiterIds: [u.ids.monteurA, u.ids.chefA] });
		const neu = await aendereTodo(kA(), alt.id, { zustaendigId: u.ids.bueroA });
		expect(neu.mitarbeiter.map((m) => m.id)).toEqual([u.ids.bueroA, u.ids.chefA]);
		// Fremde/unbekannte Person: 400
		await expect(aendereTodo(kA(), alt.id, { mitarbeiterIds: [u.ids.chefB] })).rejects.toMatchObject({ status: 400 });
	});

	it('Zeitraum: von–bis mit Uhrzeiten, Prüfungen, Ändern über die Formular-Aktion', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Estrich', auftragId: u.auftragA, vonTag: '2026-11-02', vonZeit: '07:00', faellig: '2026-11-04', faelligZeit: '16:00' });
		expect(t).toMatchObject({ vonTag: '2026-11-02', vonZeit: '07:00', faellig: '2026-11-04', faelligZeit: '16:00' });
		await expect(legeTodoAn(kA(), { titel: 'X', vonTag: '2026-11-05', faellig: '2026-11-04' })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'X', vonTag: '2026-11-05' })).rejects.toMatchObject({ status: 400 });
		await expect(legeTodoAn(kA(), { titel: 'X', vonTag: '2026-11-01', faellig: '2026-11-04', wiederholung: 'woechentlich' })).rejects.toMatchObject({ status: 400 });
		// Altes Formular schickt nur „faellig“: Zeitraum bleibt, solange er passt
		expect(await aendereTodo(kA(), t.id, { faellig: '2026-11-06' })).toMatchObject({ vonTag: '2026-11-02', faellig: '2026-11-06' });
		// Formular-Aktion am Auftrag: „Ein Tag“ schickt vonTag leer → Zeitraum weg; Mitarbeiter mit
		const r = await auftragAktionen.todoAendern({
			locals: { nutzer: u.chefA },
			params: { id: u.auftragA },
			request: form([
				['id', t.id],
				['faellig', '2026-11-03'],
				['faelligZeit', ''],
				['vonTag', ''],
				['vonZeit', ''],
				['mitarbeiterFeld', '1'],
				['mitarbeiterIds', u.ids.monteurA]
			])
		} as never);
		expect(r).toBeUndefined();
		const [z] = await root`select to_char(von_tag, 'YYYY-MM-DD') as von, to_char(faellig, 'YYYY-MM-DD') as bis, zustaendig_id from app.todos where id = ${t.id}`;
		expect(z).toEqual({ von: null, bis: '2026-11-03', zustaendig_id: u.ids.monteurA });
		// DB-Regel: Beginn nie nach dem Ende
		await expect(root`update app.todos set von_tag = '2026-12-01' where id = ${t.id}`).rejects.toThrow(/todos_zeitraum/);
	});

	describe('Sprache', () => {
		const text = async (nutzer: Nutzer, befehl: string) =>
			antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text: befehl }) } as never));
		const ausfuehren = async (nutzer: Nutzer, vorschlag: string) =>
			antwort(await ausfuehrenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { vorschlag }) } as never));

		it('„Vorlage Badsanierung auf Auftrag Müller anwenden“: Vorschau, Bestätigen, nur fehlende; Monteur darf nicht', async () => {
			await legeTodoAn(kA(), { titel: 'Abnahme mit Kunde', auftragId: u.auftragA });
			const r = await text(u.chefA, 'Vorlage Badsanierung auf Auftrag Müller anwenden');
			expect(r.status).toBe(200);
			expect(r.koerper.karte.fehler, JSON.stringify(r.koerper.karte)).toBeNull();
			expect(r.koerper.karte.zeilen).toContainEqual({ label: 'Neue Aufgaben', wert: 'Fliesen abschlagen, Silikon fugen' });
			const a = await ausfuehren(u.chefA, r.koerper.vorschlag);
			expect(a.koerper.meldung).toBe('Vorlage „Badsanierung“ übernommen: 2 Aufgaben hinzugefügt');
			expect((await titelAm(u.auftragA)).sort()).toEqual(['Abnahme mit Kunde', 'Fliesen abschlagen', 'Silikon fugen']);
			const [q] = await root`select quelle from app.aenderungen where tabelle = 'todos' and nachher ->> 'titel' = 'Fliesen abschlagen' order by id desc limit 1`;
			expect(q.quelle).toBe('sprache');
			const m = await text(u.monteurA, 'Vorlage Badsanierung auf Auftrag Müller anwenden');
			expect(m.koerper.vorschlag).toBeNull();
			expect(m.koerper.karte.fehler).toMatch(/Berechtigung/);
		});

		it('„Aufgabe Fliesen legen bei Müller an Ali, Montag bis Mittwoch“', async () => {
			const r = await text(u.chefA, 'Aufgabe Fliesen legen bei Müller an Ali, Montag bis Mittwoch');
			expect(r.koerper.karte.fehler, JSON.stringify(r.koerper.karte)).toBeNull();
			expect(r.koerper.karte.zeilen.map((z: any) => z.label)).toEqual(expect.arrayContaining(['Aufgabe', 'Zuständig', 'Zeitraum', 'Auftrag']));
			const a = await ausfuehren(u.chefA, r.koerper.vorschlag);
			expect(a.status).toBe(201);
			const [t] = await root`
				select zustaendig_id, auftrag_id, extract(isodow from von_tag)::int as von_wt, extract(isodow from faellig)::int as bis_wt, faellig - von_tag as tage
				from app.todos where titel = 'Fliesen legen'`;
			expect(t).toMatchObject({ zustaendig_id: u.ids.monteurA, auftrag_id: u.auftragA, von_wt: 1, bis_wt: 3, tage: 2 });
		});
	});
});
