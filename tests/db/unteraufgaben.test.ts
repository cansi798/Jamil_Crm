import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { legeTodoAn, legeUnteraufgabeAn, loescheUnteraufgabe, setzeUnteraufgabeErledigt } from '../../src/lib/server/todos';
import { actions as todoAktionen } from '../../src/routes/(app)/todos/+page.server';

/** Unteraufgaben (Jamil msg 3530): anlegen, abhaken, entfernen, Rechte, Mandanten, mit der Aufgabe gelöscht. */
describe('Unteraufgaben', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const alle = () => ({ alle: true, benutzerId: u.ids.chefA });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('direkte Aufgabe: Unteraufgaben in Reihenfolge, mit Person, abhaken, entfernen; Prüfung der Eingaben', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Werkstatt aufräumen', mitarbeiterIds: [u.ids.monteurA] }, alle());
		expect(t.auftragId).toBeNull();
		expect(t.unteraufgaben).toEqual([]);
		await legeUnteraufgabeAn(kA(), alle(), t.id, '  Regal   leeren ');
		const mit = await legeUnteraufgabeAn(kA(), alle(), t.id, 'Boden fegen', u.ids.monteurA);
		expect(mit.unteraufgaben.map((x) => x.titel)).toEqual(['Regal leeren', 'Boden fegen']);
		expect(mit.unteraufgaben[1]).toMatchObject({ benutzerId: u.ids.monteurA, erledigt: false });
		await expect(legeUnteraufgabeAn(kA(), alle(), t.id, '   ')).rejects.toMatchObject({ status: 400 });
		await expect(legeUnteraufgabeAn(kA(), alle(), t.id, 'x'.repeat(201))).rejects.toMatchObject({ status: 400 });
		await expect(legeUnteraufgabeAn(kA(), alle(), t.id, 'ok', 'kein-id')).rejects.toMatchObject({ status: 400 });
		// abhaken: Mitarbeiter der Aufgabe darf (ohne Bearbeiten-Recht), Fremder nicht
		const id = mit.unteraufgaben[0].id;
		await setzeUnteraufgabeErledigt({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, id, true, false);
		expect((await root`select erledigt_am from app.todo_unteraufgaben where id = ${id}`)[0].erledigt_am).not.toBeNull();
		await expect(setzeUnteraufgabeErledigt({ betriebId: u.betriebA, benutzerId: u.ids.bueroA }, { alle: true, benutzerId: u.ids.bueroA }, id, false, false)).rejects.toMatchObject({ status: 403 });
		await setzeUnteraufgabeErledigt(kA(), alle(), id, false, true);
		expect((await root`select erledigt_am from app.todo_unteraufgaben where id = ${id}`)[0].erledigt_am).toBeNull();
		// Mandanten: Betrieb B sieht/ändert nichts
		await expect(loescheUnteraufgabe({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, { alle: true, benutzerId: u.ids.chefB }, id)).rejects.toMatchObject({ status: 404 });
		expect((await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select count(*)::int as n from app.todo_unteraufgaben`))[0].n).toBe(0);
		await loescheUnteraufgabe(kA(), alle(), id);
		expect(await root`select 1 from app.todo_unteraufgaben where id = ${id}`).toHaveLength(0);
		// Aufgabe weg → Unteraufgaben weg
		await root`delete from app.todos where id = ${t.id}`;
		expect(await root`select 1 from app.todo_unteraufgaben where todo_id = ${t.id}`).toHaveLength(0);
	});

	it('Seitenaktionen: Monteur darf nicht anlegen/löschen (403), Büro schon; Lautstärke bleibt bei direkten Aufgaben unberührt', async () => {
		const t = await legeTodoAn(kA(), { titel: 'Mit Altwert', lautstaerke: '2' }, alle());
		const sende = (aktion: 'unterNeu' | 'unterLoeschen', nutzer: unknown, felder: Record<string, string>) =>
			(todoAktionen[aktion] as (e: unknown) => Promise<unknown>)({ locals: { nutzer }, params: {}, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams(felder) }) }) as Promise<{ status?: number } | undefined>;
		expect((await sende('unterNeu', u.monteurA, { todoId: t.id, titel: 'Nein' }))?.status).toBe(403);
		expect(await sende('unterNeu', u.bueroA, { todoId: t.id, titel: 'Ja' })).toBeUndefined();
		const [ua] = await root`select id from app.todo_unteraufgaben where todo_id = ${t.id}`;
		expect((await sende('unterLoeschen', u.monteurA, { id: ua.id }))?.status).toBe(403);
		// Bearbeiten ohne Lautstärke-Feld (direkte Aufgabe) lässt den alten Wert stehen
		await (todoAktionen.aendern as (e: unknown) => Promise<unknown>)({ locals: { nutzer: u.chefA }, params: {}, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams({ id: t.id, titel: 'Neu' }) }) });
		expect((await root`select titel, lautstaerke from app.todos where id = ${t.id}`)[0]).toEqual({ titel: 'Neu', lautstaerke: 2 });
	});
});
