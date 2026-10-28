import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { kundenZeilenInfo } from '../../src/lib/server/kunden-zeilen';
import { listeKunden } from '../../src/lib/server/kunden';
import { load as listenLoad } from '../../src/routes/(app)/kunden/+page.server';

/** Infos in der Kundenzeile (Jamil msg 3522): eine Abfrage, Rechte, Mandanten, Sortierung, Kachel-Filter vor der Begrenzung. */
describe('Kundenliste: Infos in der Zeile', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const alle = { auftraege: true, angebote: true, portal: true };

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Angebot, Portal, offene Aufträge, Termin, Bestandskunde – aus vorhandenen Daten, ohne IPs', async () => {
		const leer = (await kundenZeilenInfo(kA(), [u.kundeA], alle)).get(u.kundeA)!;
		expect(leer.angebot).toBeNull();
		expect(leer.portal).toMatchObject({ gueltig: false, jeEinLink: false, zugriffe: 0 });
		// Angebot verschickt, dann angenommen
		const [an] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${u.auftragA}, 'entwurf', '2099-12-31') returning id`;
		await root`update app.angebote set status = 'versendet' where id = ${an.id}`;
		expect((await kundenZeilenInfo(kA(), [u.kundeA], alle)).get(u.kundeA)!.angebot).toMatchObject({ status: 'versendet', abgelaufen: false });
		await root`update app.angebote set status = 'angenommen' where id = ${an.id}`;
		expect((await kundenZeilenInfo(kA(), [u.kundeA], alle)).get(u.kundeA)!.angebot).toMatchObject({ status: 'angenommen' });
		// Portal: Link mit 3 Aufrufen, PLZ als Passwort
		await root`update app.kunden set plz = '20095' where id = ${u.kundeA}`;
		await root`insert into app.portal_links (betrieb_id, kunde_id, token_hash, zugriffe, letzter_zugriff) values (${u.betriebA}, ${u.kundeA}, ${Buffer.alloc(32, 7)}, 3, now())`;
		// Termin und abgerechneter Auftrag
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, now() + interval '3 days', now() + interval '3 days 2 hours')`;
		await u.neuerAuftrag('abgerechnet', 'Fertig');
		const i = (await kundenZeilenInfo(kA(), [u.kundeA], alle)).get(u.kundeA)!;
		expect(i.portal).toMatchObject({ gueltig: true, passwort: true, zugriffe: 3 });
		expect(i.portal!.zuletzt).toMatch(/^\d{4}-/);
		expect(i.auftraege!.offen).toBeGreaterThanOrEqual(1);
		expect(i.auftraege!.bestandskunde).toBe(true);
		expect(i.auftraege!.naechsterTermin).toMatch(/^\d{4}-/);
		// Passwort fehlt: weder PLZ noch eigenes
		await root`update app.kunden set plz = null where id = ${u.kundeA}`;
		expect((await kundenZeilenInfo(kA(), [u.kundeA], alle)).get(u.kundeA)!.portal!.passwort).toBe(false);
	});

	it('Rechte: ohne Recht keine Daten; Mandanten: fremde Kunden gibt es nicht', async () => {
		const ohne = (await kundenZeilenInfo(kA(), [u.kundeA], { auftraege: false, angebote: false, portal: false }));
		expect(ohne.size).toBe(0);
		const nurPortal = (await kundenZeilenInfo(kA(), [u.kundeA], { auftraege: false, angebote: false, portal: true })).get(u.kundeA)!;
		expect(nurPortal.angebot).toBeNull();
		expect(nurPortal.auftraege).toBeNull();
		expect(nurPortal.portal).not.toBeNull();
		expect((await kundenZeilenInfo(kA(), [u.kundeB], alle)).size).toBe(0);
		expect((await kundenZeilenInfo({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, [u.kundeA], alle)).size).toBe(0);
	});

	it('Seite: Monteur bekommt keine Auftrags-/Portal-Infos und keine Sortierung; Chef sortiert nach Portal; Unsinn → Name', async () => {
		const laden = async (nutzer: unknown, q = '') => (await listenLoad({ locals: { nutzer }, url: new URL(`http://x/kunden${q}`) } as never)) as any;
		const chef = await laden(u.chefA, '?sortierung=portal');
		expect(chef.sortierung).toBe('portal');
		expect(chef.rechte).toEqual({ auftraege: true, angebote: true, portal: true });
		expect(chef.kunden[0].id).toBe(u.kundeA); // einziger Kunde mit Portal-Aufruf steht oben
		expect(chef.kunden.find((k: { id: string }) => k.id === u.kundeA).info.portal.zugriffe).toBe(3);
		expect((await laden(u.chefA, '?sortierung=xyz')).sortierung).toBe('name');
		const monteur = await laden(u.monteurA, '?sortierung=portal');
		expect(monteur.sortierung).toBe('name');
		expect(monteur.sortierungen).toEqual([{ wert: 'name', text: 'Name' }]);
		expect(monteur.kunden.every((k: { info: unknown }) => k.info === null)).toBe(true);
	});

	it('Kachel-Filter wirkt vor der Begrenzung auf 50 Treffer (vorher fielen spätere Namen heraus)', async () => {
		const viele = Array.from({ length: 55 }, (_, i) => `Aaa Kunde ${String(i).padStart(2, '0')}`);
		const ids: string[] = [];
		for (const n of viele) ids.push((await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', ${n}) returning id`)[0].id);
		const gesucht = (await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Zzz Spät') returning id`)[0].id;
		expect((await listeKunden(kA(), '')).map((k) => k.id)).not.toContain(gesucht);
		expect((await listeKunden(kA(), '', { nurIds: [gesucht] })).map((k) => k.id)).toEqual([gesucht]);
		await root`delete from app.kunden where id = any(${[...ids, gesucht]})`;
	});
});
