import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, testPng, type Umgebung } from './hilfe-1c';
import { erzeugeLink } from '../../src/lib/server/kundenportal';
import { ladePortal, portalAbruf, portalFehlversuch } from '../../src/lib/server/kundenportal-oeffentlich';
import { actions, load } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { load as portalSeite } from '../../src/routes/portal/[token]/+page.server';
import { GET as dokumentGet } from '../../src/routes/portal/[token]/dokument/[art]/[id]/+server';

/**
 * Dokumente und Notizen direkt im Auftrag mit „Im Kundenportal“ (Jamil msg 3070): Anlegen wie die Links, Standard aus,
 * umschalten, löschen (eigene; Chef alle) – und vor allem: Nicht freigegebene Notizen/Dokumente erreichen das Portal NIE.
 */
describe('Auftrag: Dokumente & Notizen, Freigabe fürs Kundenportal', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let token: string;
	const IP = '203.0.113.90';
	const zA = () => ({ k: { betriebId: u.betriebA, benutzerId: u.ids.chefA }, sicht: { alle: true, benutzerId: u.ids.chefA }, preise: true });
	const aktion = async (name: keyof typeof actions, nutzer: Nutzer, felder: Record<string, string | File>) => {
		const body = new FormData();
		for (const [k, v] of Object.entries(felder)) body.append(k, v);
		return (await (actions[name] as any)({ locals: { nutzer }, params: { id: u.auftragA }, request: new Request('http://localhost/x', { method: 'POST', body }) })) as any;
	};
	const portal = async () => (await ladePortal(token, IP))!;
	const png = (name = 'foto.png') => new File([Buffer.from(testPng())], name, { type: 'image/png' });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_PORTAL_GEHEIMNIS = 'portal-test-geheimnis-0123456789abcdefghij';
		token = (await erzeugeLink(zA(), u.kundeA)).token;
	});
	beforeEach(async () => {
		portalAbruf.leeren();
		portalFehlversuch.leeren();
		await root`delete from app.notizen`;
		await root`delete from app.dateien`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Notiz und Dokument ohne Häkchen: in der Karte, NIE im Portal', async () => {
		expect(await aktion('notizNeu', u.chefA, { text: 'Intern: Kunde zahlt spät' })).toEqual({ unterlageMeldung: 'Notiz gespeichert.' });
		expect(await aktion('dokumentNeu', u.chefA, { datei: png('intern-plan.png') })).toEqual({ unterlageMeldung: 'Dokument gespeichert.' });
		const seite = (await load({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, url: new URL('https://crm.test/x') } as never)) as any;
		expect(seite.unterlagen.notizen).toMatchObject([{ text: 'Intern: Kunde zahlt spät', vonName: 'Chef A', imPortal: false }]);
		expect(seite.unterlagen.dokumente).toMatchObject([{ name: 'intern-plan.png', vonName: 'Chef A', imPortal: false }]);
		const p = JSON.stringify(await portal());
		expect(p).not.toContain('zahlt spät');
		expect(p).not.toContain('intern-plan');
		expect((await portal()).auftraege[0]).toMatchObject({ notizen: [], dateien: [] });
	});

	it('Mit Häkchen: im Portal unter „Ihre Unterlagen“; Umschalten nimmt es wieder heraus; Löschen entfernt die Freigabe', async () => {
		await aktion('notizNeu', u.chefA, { text: 'Bitte Zufahrt freihalten', imPortal: 'on' });
		await aktion('dokumentNeu', u.chefA, { datei: png('baustelle.png'), imPortal: 'on' });
		await aktion('notizNeu', u.chefA, { text: 'geheime Notiz' });
		let a = (await portal()).auftraege[0];
		expect(a.notizen.map((n) => n.text)).toEqual(['Bitte Zufahrt freihalten']);
		expect(a.dateien.map((d) => d.name)).toEqual(['baustelle.png']);
		expect(JSON.stringify(a)).not.toContain('geheime Notiz');
		const [n] = await root`select id from app.notizen where text = 'Bitte Zufahrt freihalten'`;
		await aktion('unterlagePortal', u.chefA, { art: 'notiz', id: n.id, imPortal: 'nein' });
		a = (await portal()).auftraege[0];
		expect(a.notizen).toEqual([]);
		await aktion('unterlagePortal', u.chefA, { art: 'notiz', id: n.id, imPortal: 'ja' });
		expect((await portal()).auftraege[0].notizen).toHaveLength(1);
		await aktion('unterlageLoeschen', u.chefA, { art: 'notiz', id: n.id });
		expect(await root`select 1 from app.portal_dokumente where ref_id = ${n.id}`).toHaveLength(0);
		expect((await portal()).auftraege[0].notizen).toEqual([]);
	});

	it('Rechte: Monteur ohne „Aufträge bearbeiten“ darf nicht (wie bisher); ohne Portal-Recht kein Häkchen; Löschen nur eigene (Chef alle)', async () => {
		expect((await aktion('notizNeu', u.monteurA, { text: 'x' })).status).toBe(403);
		const ohnePortal = { ...u.bueroA, rechte: u.bueroA.rechte.filter((r) => r !== 'kundenportal.verwalten') };
		expect((await aktion('notizNeu', ohnePortal, { text: 'soll nicht entstehen', imPortal: 'on' })).status).toBe(403);
		expect(await root`select 1 from app.notizen where text = 'soll nicht entstehen'`).toHaveLength(0);
		expect((await aktion('unterlagePortal', ohnePortal, { art: 'notiz', id: '00000000-0000-4000-8000-000000000000', imPortal: 'ja' })).status).toBe(403);
		await aktion('notizNeu', u.chefA, { text: 'vom Chef' });
		const [n] = await root`select id from app.notizen where text = 'vom Chef'`;
		expect((await aktion('unterlageLoeschen', u.bueroA, { art: 'notiz', id: n.id })).status).toBe(403);
		await aktion('notizNeu', u.bueroA, { text: 'vom Büro' });
		const [b] = await root`select id from app.notizen where text = 'vom Büro'`;
		expect(await aktion('unterlageLoeschen', u.bueroA, { art: 'notiz', id: b.id })).toBeUndefined();
		expect(await aktion('unterlageLoeschen', u.chefA, { art: 'notiz', id: n.id })).toBeUndefined();
		expect(await root`select 1 from app.notizen`).toHaveLength(0);
	});

	it('Dokument: Inhalt muss zum Typ passen (HTML als „PDF“ abgelehnt), leere Datei abgelehnt', async () => {
		const falsch = await aktion('dokumentNeu', u.chefA, { datei: new File(['<html>'], 'x.pdf', { type: 'application/pdf' }) });
		expect(falsch).toMatchObject({ status: 400, data: { unterlageArt: 'datei' } });
		expect((await aktion('dokumentNeu', u.chefA, { datei: new File([], 'leer.pdf', { type: 'application/pdf' }) })).status).toBe(400);
		expect(await root`select 1 from app.dateien`).toHaveLength(0);
	});

	it('Portal-Sperre gilt auch für die neuen Inhalte: ohne Passwort-Cookie keine Seite (Notizen) und kein Dokument', async () => {
		await aktion('notizNeu', u.chefA, { text: 'freigegeben', imPortal: 'on' });
		await aktion('dokumentNeu', u.chefA, { datei: png('frei.png'), imPortal: 'on' });
		const [d] = await root`select id from app.dateien where name = 'frei.png'`;
		const ev = { params: { token, art: 'datei', id: d.id }, locals: {}, getClientAddress: () => IP, setHeaders: () => {} } as never;
		await expect(portalSeite(ev)).rejects.toMatchObject({ status: 401 });
		await expect(Promise.resolve(dokumentGet(ev))).rejects.toMatchObject({ status: 401 });
		// mit Cookie-Flag (Hook) kommt das Dokument
		const r = await dokumentGet({ params: { token, art: 'datei', id: d.id }, locals: { portalAngemeldet: true }, getClientAddress: () => IP } as never);
		expect(r.headers.get('content-type')).toBe('image/png');
	});
});
