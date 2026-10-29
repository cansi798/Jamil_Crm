import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { aenderePartner, legePartnerAn, loeschePartner, setzeQuellenPartner } from '../../src/lib/server/partner';
import { listeQuellen, loescheQuelle, speichereQuelle } from '../../src/lib/server/quellen';

/** Partner als Auftragsquelle (Jamil msg 3707, Migration 113). */
describe('Partner als Auftragsquelle', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const quellenVon = async (partnerId: string) => root`select id, name, aktiv from app.auftrag_quellen where partner_id = ${partnerId}`;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await root`update app.rollen set rechte = array_append(rechte, 'partner.verwalten') where betrieb_id = ${u.betriebA} and not ('partner.verwalten' = any(rechte)) and ('einstellungen' = any(rechte))`;
		await listeQuellen(kA()); // Startliste
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('neuer Auftraggeber → eigene Quelle, ausgeschaltet; Subunternehmer/Lieferant nicht', async () => {
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'PQ Baumarkt' });
		const q = await quellenVon(p.id);
		expect(q).toHaveLength(1);
		expect(q[0]).toMatchObject({ name: 'PQ Baumarkt', aktiv: false });
		const s = await legePartnerAn(kA(), { art: 'subunternehmer', name: 'PQ Elektro' });
		expect(await quellenVon(s.id)).toHaveLength(0);
		// Speichern des Partners legt keine zweite an
		await aenderePartner(kA(), p.id, { art: 'auftraggeber', name: 'PQ Baumarkt', aktiv: true });
		expect(await quellenVon(p.id)).toHaveLength(1);
		const liste = await listeQuellen(kA());
		expect(liste.find((x) => x.id === q[0].id)).toMatchObject({ partnerName: 'PQ Baumarkt', aktiv: false });
	});

	it('gleichnamige Quelle ohne Partner wird verknüpft (aktiv bleibt); vergebener Name → „(Partner)“', async () => {
		await speichereQuelle(kA(), null, { name: 'PQ Gleich' });
		const [vorher] = await root`select id, aktiv from app.auftrag_quellen where betrieb_id = ${u.betriebA} and name = 'PQ Gleich'`;
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'pq gleich' });
		const q = await quellenVon(p.id);
		expect(q).toEqual([{ id: vorher.id, name: 'PQ Gleich', aktiv: true }]);
		// zweiter Partner gleichen Namens: Name ist vergeben (gehört schon zu einem Partner)
		const p2 = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'PQ Gleich' });
		expect((await quellenVon(p2.id))[0]).toMatchObject({ name: 'PQ Gleich (Partner)', aktiv: false });
	});

	it('Umbenennen zieht den Quellnamen mit – außer die Quelle wurde von Hand umbenannt', async () => {
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'PQ Alt' });
		await aenderePartner(kA(), p.id, { art: 'auftraggeber', name: 'PQ Neu', aktiv: true });
		const [q] = await quellenVon(p.id);
		expect(q.name).toBe('PQ Neu');
		await speichereQuelle(kA(), q.id, { name: 'PQ Eigener Name', aktiv: 'false' });
		await aenderePartner(kA(), p.id, { art: 'auftraggeber', name: 'PQ Noch neuer', aktiv: true });
		expect((await quellenVon(p.id))[0].name).toBe('PQ Eigener Name');
	});

	it('Partner-Quelle: nicht löschbar (Anwendung und Datenbank), Verknüpfung nicht lösbar; aus/an geht', async () => {
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'PQ Fest' });
		const [q] = await quellenVon(p.id);
		await expect(loescheQuelle(kA(), q.id)).rejects.toMatchObject({ status: 409, message: 'Gehört zu Partner „PQ Fest“ – nur aus- oder einschalten.' });
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`delete from app.auftrag_quellen where id = ${q.id}`)).rejects.toThrow(/gehört zu einem Partner/);
		await expect(root`delete from app.auftrag_quellen where id = ${q.id}`).rejects.toThrow(/gehört zu einem Partner/);
		await expect(setzeQuellenPartner(kA(), q.id, '')).rejects.toMatchObject({ status: 409 });
		await speichereQuelle(kA(), q.id, { name: 'PQ Fest', aktiv: 'true' });
		expect((await quellenVon(p.id))[0].aktiv).toBe(true);
	});

	it('Partner ausschalten/löschen schaltet die Quelle aus; gelöscht → normale, löschbare Quelle', async () => {
		const p = await legePartnerAn(kA(), { art: 'auftraggeber', name: 'PQ Weg' });
		const [q] = await quellenVon(p.id);
		await speichereQuelle(kA(), q.id, { name: 'PQ Weg', aktiv: 'true' });
		await aenderePartner(kA(), p.id, { art: 'auftraggeber', name: 'PQ Weg', aktiv: false });
		expect((await root`select aktiv from app.auftrag_quellen where id = ${q.id}`)[0].aktiv).toBe(false);
		// wieder einschalten: Quelle bleibt aus
		await aenderePartner(kA(), p.id, { art: 'auftraggeber', name: 'PQ Weg', aktiv: true });
		expect((await root`select aktiv from app.auftrag_quellen where id = ${q.id}`)[0].aktiv).toBe(false);
		await speichereQuelle(kA(), q.id, { name: 'PQ Weg', aktiv: 'true' });
		expect(await loeschePartner(kA(), p.id)).toBe('geloescht');
		const [danach] = await root`select aktiv, partner_id from app.auftrag_quellen where id = ${q.id}`;
		expect(danach).toEqual({ aktiv: false, partner_id: null });
		expect(await loescheQuelle(kA(), q.id)).toBe('geloescht');
	});

	it('Betrieb löschen (Kaskade) bleibt möglich; neuer Betrieb mit Partner zuerst bekommt trotzdem die Startliste', async () => {
		const [tmp] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) select 'PQ Tmp', tarif_id, 'aktiv' from app.betriebe where id = ${u.betriebA} returning id`;
		await root`insert into app.partner (betrieb_id, art, name) values (${tmp.id}, 'auftraggeber', 'Hornbach')`;
		expect((await root`select name, aktiv from app.auftrag_quellen where betrieb_id = ${tmp.id}`).map((r) => r.name)).toEqual(['Hornbach']);
		const kTmp = { betriebId: tmp.id, benutzerId: u.ids.chefA };
		const namen = (await listeQuellen(kTmp)).map((q) => q.name);
		expect(namen).toContain('Website');
		// Startliste: „Hornbach“ ist schon vergeben (Partner-Quelle) – keine zweite
		expect(namen.filter((n) => n === 'Hornbach')).toHaveLength(1);
		await root`delete from app.betriebe where id = ${tmp.id}`;
		expect(await root`select 1 from app.auftrag_quellen where betrieb_id = ${tmp.id}`).toHaveLength(0);
	});
});
