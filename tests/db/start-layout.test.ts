import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { erlaubteKacheln, ladeStartLayout, loescheStartLayout, speichereStartLayout, startRolle } from '../../src/lib/server/start-layout';
import { pruefeLayout } from '../../src/lib/start-kacheln';

/** Frei zusammenstellbarer Start (Jamil msg 2942): Layout je Benutzer, Rechte, RLS (nur die eigene Zeile). */
describe('Start-Layout', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const k = (benutzerId: string, betriebId = u.betriebA) => ({ betriebId, benutzerId });
	const MODULE = ['auftraege', 'plantafel', 'angebote', 'zeiterfassung'];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await root`delete from app.start_layouts`;
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: Monteur bekommt keine Kennzahlen/Beträge, Chef alles; Vorgabe je Rolle', async () => {
		const monteur = erlaubteKacheln(u.monteurA, MODULE);
		expect(monteur.has('heute')).toBe(true);
		expect([...monteur].some((id) => id.startsWith('kz-') || id === 'quellen' || id === 'monat' || id === 'handlung')).toBe(false);
		const ohnePreise = erlaubteKacheln(u.ohnePreiseA, MODULE);
		expect(ohnePreise.has('quellen')).toBe(false);
		expect(ohnePreise.has('monat')).toBe(false);
		const chef = erlaubteKacheln(u.chefA, MODULE);
		expect(chef.has('quellen') && chef.has('kz-umsatz_mitarbeiter') && chef.has('handlung')).toBe(true);
		expect(startRolle(u.chefA)).toBe('chef');
		expect(startRolle(u.monteurA)).toBe('monteur');
		// ohne eigenes Layout: Vorgabe der Rolle
		const v = await ladeStartLayout(k(u.ids.monteurA), monteur, 'monteur');
		expect(v.eigenes).toBe(false);
		expect(v.layout.every((e) => monteur.has(e.id))).toBe(true);
		// Speichern einer verbotenen Kachel scheitert schon an der Prüfung
		expect(() => pruefeLayout([{ id: 'quellen', groesse: 'l', hoehe: 1 }], monteur)).toThrow();
	});

	it('speichern, laden (bereinigt), Standard wiederherstellen', async () => {
		const chef = erlaubteKacheln(u.chefA, MODULE);
		const layout = pruefeLayout([{ id: 'quellen', groesse: 'breit', hoehe: 2 }, { id: 'heute', groesse: 's', hoehe: 1 }], chef);
		await speichereStartLayout(k(u.ids.chefA), layout);
		expect(await ladeStartLayout(k(u.ids.chefA), chef, 'chef')).toEqual({ layout, eigenes: true });
		// Recht weg (z. B. Rolle geändert): Kachel fällt beim Laden still weg
		expect((await ladeStartLayout(k(u.ids.chefA), new Set(['heute']), 'chef')).layout).toEqual([{ id: 'heute', groesse: 's', hoehe: 1 }]);
		await speichereStartLayout(k(u.ids.chefA), [{ id: 'heute', groesse: 'm', hoehe: 2 }]);
		expect((await ladeStartLayout(k(u.ids.chefA), chef, 'chef')).layout).toEqual([{ id: 'heute', groesse: 'm', hoehe: 2 }]);
		await loescheStartLayout(k(u.ids.chefA));
		expect((await ladeStartLayout(k(u.ids.chefA), chef, 'chef')).eigenes).toBe(false);
	});

	it('RLS: nur die eigene Zeile – andere Person im Betrieb und anderer Betrieb sehen/ändern nichts', async () => {
		await speichereStartLayout(k(u.ids.chefA), [{ id: 'heute', groesse: 'l', hoehe: 1 }]);
		await speichereStartLayout(k(u.ids.monteurA), [{ id: 'bereiche', groesse: 'breit', hoehe: 1 }]);
		const sichtbar = (b: string, betrieb = u.betriebA) => mitBetrieb(k(b, betrieb), (tx) => tx`select benutzer_id from app.start_layouts`);
		expect((await sichtbar(u.ids.monteurA)).map((r) => r.benutzer_id)).toEqual([u.ids.monteurA]);
		expect(await sichtbar(u.ids.chefB, u.betriebB)).toEqual([]);
		// fremde Zeile ändern/löschen wirkt nicht
		const geaendert = await mitBetrieb(k(u.ids.monteurA), (tx) => tx`update app.start_layouts set kacheln = '[]' where benutzer_id = ${u.ids.chefA} returning 1`);
		expect(geaendert).toHaveLength(0);
		await mitBetrieb(k(u.ids.monteurA), (tx) => tx`delete from app.start_layouts where benutzer_id = ${u.ids.chefA}`);
		// fremde Zeile anlegen scheitert an der RLS
		await expect(
			mitBetrieb(k(u.ids.chefB, u.betriebB), (tx) => tx`insert into app.start_layouts (benutzer_id, betrieb_id, kacheln) values (${u.ids.chefA}, ${u.betriebA}, '[]')`)
		).rejects.toThrow();
		const [z] = await root`select kacheln from app.start_layouts where benutzer_id = ${u.ids.chefA}`;
		expect(z.kacheln).toEqual([{ id: 'heute', groesse: 'l', hoehe: 1 }]);
		// Datenbank prüft Form und Größe
		await expect(root`insert into app.start_layouts (benutzer_id, betrieb_id, kacheln) values (${u.ids.bueroA}, ${u.betriebA}, '{"x":1}')`).rejects.toThrow();
	});
});
