import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { erzeugeLink, kundenPortal, portalPasswort, widerrufeLink } from '../../src/lib/server/kundenportal';
import { portalFehlversuch } from '../../src/lib/server/kundenportal-oeffentlich';
import {
	anmelden,
	anmeldungJeIp,
	anmeldungJeLink,
	cookieOptionen,
	entschluesseleToken,
	PORTAL_COOKIE,
	pruefeSitzungsWert,
	sitzungGueltig,
	sitzungsWert,
	verschluesseleToken,
	zugangsStand
} from '../../src/lib/server/portal-zugang';
import { handle } from '../../src/hooks.server';
import { load as portalSeite } from '../../src/routes/portal/[token]/+page.server';
import { POST as anmeldenPost } from '../../src/routes/portal/[token]/anmelden/+server';
import { actions as kundenAktionen } from '../../src/routes/(app)/kunden/[id]/+page.server';

/**
 * Kundenportal mit Passwort und wieder öffnebarem Link (Jamil msgs 3035–3037): Verschlüsselung, PLZ als Standard,
 * eigenes Passwort, Sperre bei Durchprobieren, Cookie nur für den Link, Widerruf, Schutz aller Portal-Pfade.
 */
describe('Kundenportal: Passwort und Link', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const GEHEIMNIS = 'portal-test-geheimnis-0123456789abcdefghij';
	const IP = '203.0.113.50';
	const zA = () => ({ k: { betriebId: u.betriebA, benutzerId: u.ids.chefA }, sicht: { alle: true, benutzerId: u.ids.chefA }, preise: true });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_PORTAL_GEHEIMNIS = GEHEIMNIS;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
	});
	beforeEach(async () => {
		anmeldungJeIp.leeren();
		anmeldungJeLink.leeren();
		portalFehlversuch.leeren();
		await root`delete from app.portal_passwoerter`;
		await root`update app.kunden set plz = '22846' where id = ${u.kundeA}`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Verschlüsselung: hin und zurück; falsches Geheimnis oder verändert → null', () => {
		const token = 'a'.repeat(43);
		const v = verschluesseleToken(token, GEHEIMNIS)!;
		expect(v.length).toBe(12 + 16 + 43);
		expect(entschluesseleToken(v, GEHEIMNIS)).toBe(token);
		expect(entschluesseleToken(v, `${GEHEIMNIS}x`)).toBeNull();
		const kaputt = Buffer.from(v);
		kaputt[30] ^= 1;
		expect(entschluesseleToken(kaputt, GEHEIMNIS)).toBeNull();
		expect(verschluesseleToken(token, null)).toBeNull();
		// zufälliger IV: zweimal verschlüsselt sieht anders aus
		expect(verschluesseleToken(token, GEHEIMNIS)!.equals(v)).toBe(false);
	});

	it('Neuer Link: verschlüsselt gespeichert, auf der Kundenseite wieder öffnebar; alter Link nur mit Hinweis; widerrufen → weg', async () => {
		const { token, id } = await erzeugeLink(zA(), u.kundeA);
		const [row] = await root`select token_geheim from app.portal_links where id = ${id}`;
		expect(row.token_geheim).toBeTruthy();
		expect(Buffer.from(row.token_geheim).includes(Buffer.from(token))).toBe(false);
		let p = await kundenPortal(zA(), u.kundeA);
		expect(p.links.find((l) => l.id === id)).toMatchObject({ gueltig: true, token, ohneKopie: false });
		// Änderungsprotokoll ohne Token
		const prot = await root`select nachher from app.aenderungen where tabelle = 'portal_links' and datensatz_id = ${id}`;
		expect(JSON.stringify(prot)).not.toContain('token_geheim');
		// Alter Link (vor dem Update): nur Hash
		await root`update app.portal_links set token_geheim = null where id = ${id}`;
		p = await kundenPortal(zA(), u.kundeA);
		expect(p.links.find((l) => l.id === id)).toMatchObject({ token: null, ohneKopie: true });
		await widerrufeLink(zA(), u.kundeA, id);
		p = await kundenPortal(zA(), u.kundeA);
		expect(p.links.find((l) => l.id === id)).toMatchObject({ gueltig: false, token: null, ohneKopie: false });
	});

	it('Standard-Passwort ist die PLZ (Leerzeichen egal); falsch → allgemeine Meldung, Protokoll ohne Passwort', async () => {
		const { token, id } = await erzeugeLink(zA(), u.kundeA);
		expect(await anmelden(token, 'geheim123', IP)).toEqual({ ok: false, grund: 'falsch' });
		const r = await anmelden(token, ' 22 846 ', IP);
		expect(r.ok).toBe(true);
		const log = await root`select art, text, ip_hash from app.portal_ereignisse where link_id = ${id} order by zeit, art`;
		expect(log.map((x) => x.art).sort()).toEqual(['anmeldung', 'anmeldung_fehler']);
		expect(JSON.stringify(log)).not.toContain('geheim123');
		expect(log.every((x) => x.ip_hash && Buffer.from(x.ip_hash).length === 32)).toBe(true);
		expect((await kundenPortal(zA(), u.kundeA)).passwort).toMatchObject({ eigenes: false, plz: '22846', fehlversuche: 1 });
		// ungültiger Link
		expect(await anmelden('b'.repeat(43), '22846', IP)).toEqual({ ok: false, grund: 'ungueltig' });
	});

	it('Eigenes Passwort ersetzt die PLZ; Zurücksetzen gilt wieder die PLZ; ohne PLZ und ohne Passwort → „fehlt“', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		await expect(portalPasswort(zA(), u.kundeA, 'kurz')).rejects.toMatchObject({ status: 400 });
		await portalPasswort(zA(), u.kundeA, 'Sonnenblume-7');
		const [h] = await root`select passwort_hash from app.portal_passwoerter where kunde_id = ${u.kundeA}`;
		expect(h.passwort_hash).toMatch(/^\$argon2id\$/);
		expect((await anmelden(token, '22846', IP)).ok).toBe(false);
		expect((await anmelden(token, 'Sonnenblume-7', IP)).ok).toBe(true);
		expect((await kundenPortal(zA(), u.kundeA)).passwort.eigenes).toBe(true);
		// Protokoll ohne Hash
		const prot = await root`select vorher, nachher from app.aenderungen where tabelle = 'portal_passwoerter'`;
		expect(JSON.stringify(prot)).not.toContain('argon2');
		await portalPasswort(zA(), u.kundeA, null);
		expect((await anmelden(token, '22846', IP)).ok).toBe(true);
		await root`update app.kunden set plz = null where id = ${u.kundeA}`;
		expect(await anmelden(token, '', IP)).toEqual({ ok: false, grund: 'fehlt' });
		expect((await kundenPortal(zA(), u.kundeA)).passwort).toMatchObject({ eigenes: false, plz: null });
	});

	it('Durchprobieren: 5 Fehlversuche je Link in 15 Minuten, dann gesperrt (auch mit richtigem Passwort, auch von anderer IP); Grenze je IP', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		for (let i = 0; i < 5; i++) expect((await anmelden(token, `falsch${i}`, `198.51.100.${i}`)).ok).toBe(false);
		expect(await anmelden(token, '22846', '198.51.100.99')).toEqual({ ok: false, grund: 'gesperrt' });
		anmeldungJeLink.leeren();
		// je IP: 30 Versuche in 15 Minuten über verschiedene Links
		for (let i = 0; i < 30; i++) anmeldungJeIp.pruefeVersuch(`ip:${IP}`);
		expect(await anmelden(token, '22846', IP)).toEqual({ ok: false, grund: 'gesperrt' });
		expect((await anmelden(token, '22846', '198.51.100.200')).ok).toBe(true);
	});

	it('Sitzung: an Link, Ablauf und Passwort-Stand gebunden; Widerruf und neues Passwort beenden sie', async () => {
		const stand = zugangsStand(null, '22846');
		const s = sitzungsWert('link-1', stand, 1_000);
		expect(pruefeSitzungsWert(s.wert, 'link-1', stand, 2_000)).toBe(true);
		expect(pruefeSitzungsWert(s.wert, 'link-2', stand, 2_000)).toBe(false);
		expect(pruefeSitzungsWert(s.wert, 'link-1', zugangsStand(null, '22847'), 2_000)).toBe(false);
		expect(pruefeSitzungsWert(s.wert, 'link-1', stand, s.ablauf.getTime() + 1)).toBe(false);
		expect(pruefeSitzungsWert(s.wert.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'link-1', stand, 2_000)).toBe(false);
		expect(cookieOptionen('T'.repeat(43), s.ablauf)).toMatchObject({ path: `/portal/${'T'.repeat(43)}`, httpOnly: true, secure: true, sameSite: 'strict' });

		const { token, id } = await erzeugeLink(zA(), u.kundeA);
		const r = await anmelden(token, '22846', IP);
		if (!r.ok) throw new Error('Anmeldung fehlgeschlagen');
		expect(await sitzungGueltig(token, r.wert, IP)).toBe(true);
		expect(await sitzungGueltig(token, undefined, IP)).toBe(false);
		await portalPasswort(zA(), u.kundeA, 'NeuesPasswort1');
		expect(await sitzungGueltig(token, r.wert, IP)).toBe(false);
		const r2 = await anmelden(token, 'NeuesPasswort1', IP);
		if (!r2.ok) throw new Error('Anmeldung fehlgeschlagen');
		expect(await sitzungGueltig(token, r2.wert, IP)).toBe(true);
		await widerrufeLink(zA(), u.kundeA, id);
		expect(await sitzungGueltig(token, r2.wert, IP)).toBe(false);
	});

	it('Alle Portal-Pfade brauchen das Cookie: ohne → Umleitung zur Passwort-Seite; Seite lädt nichts (401); Anmelden setzt das Cookie nur für den Link', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		const gesetzt: Record<string, { wert: string; opt: any }> = {};
		const ereignis = (pfad: string, methode = 'GET', cookie?: string, body?: BodyInit) => ({
			url: new URL(`https://crm.test${pfad}`),
			request: new Request(`https://crm.test${pfad}`, { method: methode, body, headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined }),
			cookies: { get: (n: string) => (n === PORTAL_COOKIE ? cookie : undefined), set: (n: string, w: string, o: unknown) => (gesetzt[n] = { wert: w, opt: o }), delete: () => {} },
			locals: {} as App.Locals,
			params: { token },
			getClientAddress: () => IP,
			setHeaders: () => {}
		});
		const durch = async (e: ReturnType<typeof ereignis>) => {
			let weiter = false;
			const a = await handle({ event: e as never, resolve: async () => ((weiter = true), new Response('ok')) });
			return { weiter, status: a.status, ort: a.headers.get('location'), angemeldet: e.locals.portalAngemeldet };
		};
		for (const pfad of [`/portal/${token}/dokument/angebot/x`, `/portal/${token}/logo`, `/portal/${token}/agb`]) {
			expect(await durch(ereignis(pfad))).toMatchObject({ weiter: false, status: 303, ort: `/portal/${token}` });
		}
		expect(await durch(ereignis(`/portal/${token}?/entscheiden`, 'POST'))).toMatchObject({ weiter: false, status: 303 });
		expect(await durch(ereignis(`/portal/${token}`))).toMatchObject({ weiter: true, angemeldet: false });
		expect(await durch(ereignis(`/portal/${token}/anmelden`, 'POST'))).toMatchObject({ weiter: true });
		await expect(portalSeite(ereignis(`/portal/${token}`) as never)).rejects.toMatchObject({ status: 401 });

		// Anmelden über den Endpunkt: falsch → zurück mit Hinweis; richtig → Cookie (Pfad = Link) und zurück zum Portal
		const falsch = await Promise.resolve(anmeldenPost(ereignis(`/portal/${token}/anmelden`, 'POST', undefined, 'passwort=00000') as never)).catch((e: unknown) => e);
		expect(falsch).toMatchObject({ status: 303, location: `/portal/${token}?anmeldung=falsch` });
		const ok = await Promise.resolve(anmeldenPost(ereignis(`/portal/${token}/anmelden`, 'POST', undefined, 'passwort=22846') as never)).catch((e: unknown) => e);
		expect(ok).toMatchObject({ status: 303, location: `/portal/${token}` });
		const c = gesetzt[PORTAL_COOKIE];
		expect(c.opt).toMatchObject({ path: `/portal/${token}`, httpOnly: true, secure: true, sameSite: 'strict' });
		// mit Cookie: alles erlaubt
		expect(await durch(ereignis(`/portal/${token}/logo`, 'GET', c.wert))).toMatchObject({ weiter: true, angemeldet: true });
		// Cookie eines anderen Links gilt nicht
		const [k2] = await root`insert into app.kunden (betrieb_id, art, vorname, nachname, plz) values (${u.betriebA}, 'privat', 'Zweit', 'Kunde', '22846') returning id`;
		const zweiter = await erzeugeLink(zA(), k2.id);
		expect(await durch(ereignis(`/portal/${zweiter.token}/logo`, 'GET', c.wert))).toMatchObject({ weiter: false, status: 303 });
	});

	it('Kundenseite: Passwort setzen nur mit Portal-Recht (Monteur 403); Passwort steht nirgends im Klartext', async () => {
		const form = (felder: Record<string, string>) => new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams(felder) });
		const chef = (await kundenAktionen.portalPasswort({ locals: { nutzer: u.chefA }, params: { id: u.kundeA }, request: form({ passwort: 'Gartenzaun-42' }) } as never)) as any;
		expect(chef.portalMeldung).toMatch(/Eigenes Passwort gespeichert/);
		const monteur = (await kundenAktionen.portalPasswort({ locals: { nutzer: u.monteurA }, params: { id: u.kundeA }, request: form({ passwort: 'xyzxyz1' }) } as never)) as any;
		expect(monteur.status).toBe(403);
		const [h] = await root`select passwort_hash from app.portal_passwoerter where kunde_id = ${u.kundeA}`;
		expect(h.passwort_hash).not.toContain('Gartenzaun');
		const zurueck = (await kundenAktionen.portalPasswort({ locals: { nutzer: u.chefA }, params: { id: u.kundeA }, request: form({ aktion: 'plz' }) } as never)) as any;
		expect(zurueck.portalMeldung).toMatch(/Postleitzahl/);
		expect(await root`select 1 from app.portal_passwoerter where kunde_id = ${u.kundeA}`).toHaveLength(0);
	});
});
