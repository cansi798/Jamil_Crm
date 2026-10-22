import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { listeBenutzer, setzeAnrede } from '../../src/lib/server/benutzer';

/** Anrede der Mitarbeiter (Jamil msg 3113, Migration 105) – wählt die Comic-Figur im Kundenportal. */
describe('Benutzer-Anrede', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	it('setzen, leeren, ungültig ablehnen; nur im eigenen Betrieb', async () => {
		const monteur = () => listeBenutzer(kA()).then((l) => l.find((b) => b.id === u.ids.monteurA)!);
		expect((await monteur()).anrede).toBeNull();
		expect(await setzeAnrede(kA(), u.ids.monteurA, 'frau')).toBe('frau');
		expect((await monteur()).anrede).toBe('frau');
		expect(await setzeAnrede(kA(), u.ids.monteurA, '')).toBeNull();
		expect((await monteur()).anrede).toBeNull();
		await expect(setzeAnrede(kA(), u.ids.monteurA, 'divers')).rejects.toMatchObject({ status: 400 });
		// Benutzer eines anderen Betriebs: RLS → nicht gefunden, bleibt unverändert
		const [fremd] = await root`select id from app.benutzer where betrieb_id <> ${u.betriebA} and betrieb_id is not null limit 1`;
		await expect(setzeAnrede(kA(), fremd.id, 'herr')).rejects.toMatchObject({ status: 404 });
		const [f] = await root`select anrede from app.benutzer where id = ${fremd.id}`;
		expect(f.anrede).toBeNull();
		// Datenbank nimmt nur herr/frau
		await expect(root`update app.benutzer set anrede = 'x' where id = ${u.ids.monteurA}`).rejects.toThrow();
	});
});
