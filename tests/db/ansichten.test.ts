import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { aendereAnsicht, listeAnsichten, loescheAnsicht, speichereAnsicht } from '../../src/lib/server/ansichten';

/** Gespeicherte Ansichten (Jamil msgs 2830, 2921): eigene/geteilte, Standard, Rechte, RLS. */
describe('Gespeicherte Ansichten', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const k = (benutzerId: string, betriebId = u.betriebA) => ({ betriebId, benutzerId });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('speichern, auflisten, Standard (höchstens einer), umbenennen, löschen; Plantafel ohne Tag', async () => {
		const a = await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'plantafel', name: 'Nur Kolonne 1', query: '?tag=2026-10-21&ansicht=woche&ko=k1', istStandard: true });
		expect(a).toMatchObject({ query: 'ansicht=woche&ko=k1', istStandard: true, eigene: true, geteilt: false });
		const b = await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'plantafel', name: 'Tag', query: 'ansicht=tag', istStandard: true });
		const l = await listeAnsichten(k(u.ids.chefA), 'plantafel');
		expect(l.filter((x) => x.istStandard).map((x) => x.id)).toEqual([b.id]);
		await expect(speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'plantafel', name: 'tag', query: '' })).rejects.toMatchObject({ status: 409 });
		await expect(speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'irgendwas', name: 'x', query: '' })).rejects.toMatchObject({ status: 400 });
		expect(await aendereAnsicht(k(u.ids.chefA), u.chefA, a.id, { name: 'Kolonne 1' })).toMatchObject({ name: 'Kolonne 1' });
		await loescheAnsicht(k(u.ids.chefA), u.chefA, b.id);
		expect((await listeAnsichten(k(u.ids.chefA), 'plantafel')).map((x) => x.name)).toEqual(['Kolonne 1']);
	});

	it('Teilen nur Chef/Büro; geteilte sehen alle im Betrieb, ändern/löschen nur der Ersteller; anderer Betrieb nichts', async () => {
		await expect(speichereAnsicht(k(u.ids.monteurA), u.monteurA, { seite: 'karte', name: 'Meine Woche', query: 'von=2026-10-20', geteilt: true })).rejects.toMatchObject({ status: 403 });
		const eigen = await speichereAnsicht(k(u.ids.monteurA), u.monteurA, { seite: 'karte', name: 'Meine Woche', query: 'von=2026-10-20' });
		const team = await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'karte', name: 'Hornbach offen', query: 'quelle=q1&status=beauftragt', geteilt: true });
		// Monteur sieht eigene + geteilte (mit Namen des Erstellers), nicht die privaten des Chefs
		await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'karte', name: 'Privat Chef', query: '' });
		const m = await listeAnsichten(k(u.ids.monteurA), 'karte');
		expect(m.map((x) => x.name)).toEqual(['Meine Woche', 'Hornbach offen']);
		expect(m[1]).toMatchObject({ eigene: false, von: expect.any(String) });
		await expect(aendereAnsicht(k(u.ids.monteurA), u.monteurA, team.id, { name: 'Gekapert' })).rejects.toMatchObject({ status: 404 });
		await expect(loescheAnsicht(k(u.ids.monteurA), u.monteurA, team.id)).rejects.toMatchObject({ status: 404 });
		await expect(aendereAnsicht(k(u.ids.monteurA), u.monteurA, eigen.id, { geteilt: true })).rejects.toMatchObject({ status: 403 });
		expect(await listeAnsichten(k(u.ids.chefB, u.betriebB), 'karte')).toEqual([]);
		// auch direkt in der Datenbank (RLS): fremde Ansicht ändern trifft nichts
		const z = await u.alsApp(u.betriebA, u.ids.monteurA, (tx) => tx`update app.gespeicherte_ansichten set name = 'x' where id = ${team.id} returning id`);
		expect(z).toHaveLength(0);
		await expect(u.alsApp(u.betriebA, u.ids.monteurA, (tx) => tx`insert into app.gespeicherte_ansichten (betrieb_id, benutzer_id, seite, name, query) values (${u.betriebA}, ${u.ids.chefA}, 'karte', 'fremd', '')`)).rejects.toThrow(/row-level security/);
		await expect(root`insert into app.gespeicherte_ansichten (betrieb_id, benutzer_id, seite, name, query) values (${u.betriebA}, ${u.ids.chefA}, 'karte', 'böse', 'a="b"')`).rejects.toMatchObject({ code: '23514' });
	});

	it('Fremde Ansichten: Benutzer B kann A\'s private Ansicht weder ändern noch löschen; geteilte darf nur Chef/Büro aufräumen', async () => {
		const privat = await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'kunden', name: 'Privat', query: 'suche=a' });
		const team = await speichereAnsicht(k(u.ids.chefA), u.chefA, { seite: 'kunden', name: 'Team', query: 'suche=b', geteilt: true });
		// Büro (darf teilen) – private Ansicht des Chefs: unsichtbar, nicht änderbar, nicht löschbar
		expect((await listeAnsichten(k(u.ids.bueroA), 'kunden')).map((x) => x.id)).not.toContain(privat.id);
		await expect(aendereAnsicht(k(u.ids.bueroA), u.bueroA, privat.id, { name: 'x' })).rejects.toMatchObject({ status: 404 });
		await expect(aendereAnsicht(k(u.ids.bueroA), u.bueroA, privat.id, { istStandard: true })).rejects.toMatchObject({ status: 404 });
		await expect(loescheAnsicht(k(u.ids.bueroA), u.bueroA, privat.id)).rejects.toMatchObject({ status: 404 });
		// auch direkt in der Datenbank nicht (RLS)
		expect(await u.alsApp(u.betriebA, u.ids.bueroA, (tx) => tx`delete from app.gespeicherte_ansichten where id = ${privat.id} returning id`)).toHaveLength(0);
		// geteilte: ändern nur der Ersteller; Monteur darf nicht löschen, Büro darf aufräumen
		await expect(aendereAnsicht(k(u.ids.bueroA), u.bueroA, team.id, { geteilt: false })).rejects.toMatchObject({ status: 404 });
		await expect(loescheAnsicht(k(u.ids.monteurA), u.monteurA, team.id)).rejects.toMatchObject({ status: 404 });
		await loescheAnsicht(k(u.ids.bueroA), u.bueroA, team.id);
		expect((await listeAnsichten(k(u.ids.chefA), 'kunden')).map((x) => x.id)).toEqual([privat.id]);
		// anderer Betrieb: nichts
		await expect(loescheAnsicht(k(u.ids.chefB, u.betriebB), u.chefB, privat.id)).rejects.toMatchObject({ status: 404 });
	});
});
