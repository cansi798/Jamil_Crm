import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { erzeugeLink, kundenPortal, neuerZugangscode, tokenHash } from '../../src/lib/server/kundenportal';
import { entscheide, ladePortal, portalAbruf, portalAktion, portalFehlversuch } from '../../src/lib/server/kundenportal-oeffentlich';
import { erzeugeZugangscode, normalCode, CODE_MAX_FEHLER } from '../../src/lib/server/portal-zugang';
import { actions as kundenAktionen } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { STANDARD_MAIL_VORLAGEN } from '../../src/lib/mail-vorlagen';
import { randomBytes } from 'node:crypto';

/**
 * Zugangscode für „Angebot annehmen“ im Kundenportal (Prüfbericht 21.11.2026, Migration 128): zufällig je Link, nur
 * als Hash gespeichert, Versuchsbegrenzung in der Datenbank, Übergang für alte Links ohne Code.
 */
describe('Kundenportal: Zugangscode zum Annehmen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const IP = '203.0.113.77';
	const zA = () => ({ k: { betriebId: u.betriebA, benutzerId: u.ids.chefA }, sicht: { alle: true, benutzerId: u.ids.chefA }, preise: true });

	async function versendetesAngebot() {
		const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${u.auftragA}, 'entwurf', '2099-12-31') returning id, nummer`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
			values (${u.betriebA}, ${a.id}, 1, 'Fliesen verlegen', 10, 'm²', 5000)`;
		await root`update app.angebote set status = 'versendet' where id = ${a.id}`;
		await root`update app.auftraege set status = 'angebot' where id = ${u.auftragA}`;
		return a as { id: string; nummer: string };
	}

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_PORTAL_GEHEIMNIS = 'portal-test-geheimnis-0123456789abcdefghij';
	});
	beforeEach(async () => {
		portalAbruf.leeren();
		portalAktion.leeren();
		portalFehlversuch.leeren();
		await root`delete from app.angebot_entscheidungen`;
		await root`delete from app.auftragsbestaetigungen`;
		await leereAngebote(root);
		await root`delete from app.portal_links`;
		await root`delete from app.portal_dokumente`;
		await root`delete from app.kunden_portal`;
		await root`insert into app.kunden_portal (kunde_id, betrieb_id, sichtbar) values (${u.kundeA}, ${u.betriebA}, true) on conflict (kunde_id) do update set sichtbar = true`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Code: 8 Zeichen ohne verwechselbare Zeichen, zufällig; Eingabe ohne Bindestrich/klein geht', () => {
		const c = erzeugeZugangscode();
		expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
		expect(new Set(Array.from({ length: 50 }, erzeugeZugangscode)).size).toBe(50);
		expect(normalCode(' abcd-efgh ')).toBe('ABCDEFGH');
	});

	it('neuer Link hat einen Code – gespeichert nur als Hash; Annehmen ohne/mit falschem Code nein, mit Code ja', async () => {
		const an = await versendetesAngebot();
		const { token, id, code } = await erzeugeLink(zA(), u.kundeA);
		const [l] = await root`select zugangscode_hash, zugangscode_erzeugt from app.portal_links where id = ${id}`;
		expect(l.zugangscode_hash).toMatch(/^\$argon2id\$/);
		expect(l.zugangscode_hash).not.toContain(code.replace('-', ''));
		expect(l.zugangscode_erzeugt).not.toBeNull();
		// Code steht nicht im Änderungsprotokoll
		expect(JSON.stringify(await root`select vorher, nachher from app.aenderungen where tabelle = 'portal_links' and datensatz_id = ${id}`)).not.toContain('zugangscode_hash');
		expect((await kundenPortal(zA(), u.kundeA)).links[0].hatCode).toBe(true);
		expect((await ladePortal(token, IP))!.zugangscode).toBe(true);
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true }, IP)).rejects.toMatchObject({ status: 400 });
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: 'AAAA-AAAA' }, IP)).rejects.toMatchObject({ status: 400 });
		expect((await root`select status from app.angebote where id = ${an.id}`)[0].status).toBe('versendet');
		const r = await entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: code.toLowerCase().replace('-', ' ') }, IP);
		expect(r.status).toBe('angenommen');
		// Fehlversuche stehen im Zugriffsprotokoll, der Erfolg setzt den Zähler zurück
		expect((await root`select count(*)::int as n from app.portal_ereignisse where link_id = ${id} and art = 'code_fehler'`)[0].n).toBe(2);
		expect((await root`select code_fehlversuche from app.portal_links where id = ${id}`)[0].code_fehlversuche).toBe(0);
		expect((await kundenPortal(zA(), u.kundeA)).passwort.fehlversuche).toBeGreaterThanOrEqual(2);
	});

	it(`Versuchsbegrenzung in der Datenbank: ${CODE_MAX_FEHLER} Fehler → 15 Minuten gesperrt, auch der richtige Code`, async () => {
		const an = await versendetesAngebot();
		const { token, id, code } = await erzeugeLink(zA(), u.kundeA);
		for (let i = 0; i < CODE_MAX_FEHLER - 1; i++) {
			portalAktion.leeren();
			await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: 'BBBB-BBBB' }, IP)).rejects.toMatchObject({ status: 400 });
		}
		portalAktion.leeren();
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: 'BBBB-BBBB' }, IP)).rejects.toMatchObject({ status: 429 });
		portalAktion.leeren();
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: code }, IP)).rejects.toMatchObject({ status: 429 });
		const [l] = await root`select code_gesperrt_bis > now() + interval '14 minutes' as lange from app.portal_links where id = ${id}`;
		expect(l.lange).toBe(true);
		// Sperre abgelaufen → richtiger Code geht
		await root`update app.portal_links set code_gesperrt_bis = now() - interval '1 second' where id = ${id}`;
		portalAktion.leeren();
		expect((await entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: code }, IP)).status).toBe('angenommen');
	});

	it('Übergang: alter Link ohne Code → Ansehen und Ablehnen gehen, Annehmen nicht; „Zugangscode erzeugen“ hilft, Link bleibt', async () => {
		const an = await versendetesAngebot();
		const token = randomBytes(32).toString('base64url');
		const [l] = await root`insert into app.portal_links (betrieb_id, kunde_id, token_hash) values (${u.betriebA}, ${u.kundeA}, ${tokenHash(token)}) returning id`;
		await root`insert into app.portal_dokumente (betrieb_id, auftrag_id, art, ref_id) values (${u.betriebA}, ${u.auftragA}, 'angebot', ${an.id})`;
		const seite = (await ladePortal(token, IP))!;
		expect(seite.zugangscode).toBe(false);
		expect(seite.auftraege.flatMap((a) => a.angebote)[0]).toMatchObject({ id: an.id, annehmbar: true });
		expect((await kundenPortal(zA(), u.kundeA)).links[0].hatCode).toBe(false);
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: 'CCCC-CCCC' }, IP)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('Zugangscode') });
		// Büro erzeugt den Code (Aktion der Kundenseite); alter Link ohne Kopie → keine Portal-Adresse, aber der Code
		const f = await kundenAktionen.portalCode({ locals: { nutzer: u.chefA }, params: { id: u.kundeA }, request: new Request('http://t/', { method: 'POST', body: new FormData() }), url: new URL('http://t/') } as never);
		expect(f).toMatchObject({ portalCode: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/), portalUrl: null, portalCodeNeu: true });
		const code = (f as { portalCode: string }).portalCode;
		expect((await root`select id from app.portal_links where widerrufen_am is null`).map((x) => x.id)).toEqual([l.id]);
		portalAktion.leeren();
		expect((await entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: code }, IP)).status).toBe('angenommen');
	});

	it('Ablehnen braucht keinen Code; neuer Code macht den alten ungültig; ohne gültigen Link → 404', async () => {
		const an = await versendetesAngebot();
		const { token, code } = await erzeugeLink(zA(), u.kundeA);
		const neu = await neuerZugangscode(zA(), u.kundeA);
		expect(neu.code).not.toBe(code);
		expect(neu.token).toBe(token);
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, zugangscode: code }, IP)).rejects.toMatchObject({ status: 400 });
		portalAktion.leeren();
		expect((await entscheide(token, an.id, { entscheidung: 'abgelehnt', agb: false }, IP)).status).toBe('abgelehnt');
		await root`update app.portal_links set widerrufen_am = now()`;
		await expect(neuerZugangscode(zA(), u.kundeA)).rejects.toMatchObject({ status: 404 });
	});

	it('Portal-Mail: Standardvorlage und gespeicherte Vorlagen enthalten den Zugangscode', async () => {
		expect(STANDARD_MAIL_VORLAGEN.portal_link.html).toContain('{{portal.zugangscode}}');
		// Neuer Link über die Kundenseite liefert Link + Code für die Mail
		const f = await kundenAktionen.portalLink({ locals: { nutzer: u.chefA }, params: { id: u.kundeA }, request: new Request('http://t/', { method: 'POST', body: new FormData() }), url: new URL('http://t/') } as never);
		expect(f).toMatchObject({ portalUrl: expect.stringContaining('/portal/'), portalCode: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) });
	});
});
