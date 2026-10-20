import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { aendereLink, legeLinkAn, linksZuAuftraegen, linkVerlauf, listeLinks, loescheLink, setzeLinkImPortal } from '../../src/lib/server/auftrag-links';
import { erzeugeLink } from '../../src/lib/server/kundenportal';
import { ladePortal, portalAbruf } from '../../src/lib/server/kundenportal-oeffentlich';
import { actions, load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';

/** Links am Auftrag (Jamil msg 2850): Sicht, Rechte, Prüfung auch in der Datenbank, Verlauf, Kundenportal. */
describe('Links am Auftrag', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const ALLE = () => ({ alle: true, benutzerId: u.ids.chefA });
	const MONTEUR = () => ({ alle: false, benutzerId: u.ids.monteurA });
	let fremd: string;

	const formular = (felder: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(felder)) f.set(k, v);
		return new Request('http://test/', { method: 'POST', body: f });
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		// Monteur arbeitet nur an Auftrag A (Einsatz); der andere Auftrag ist für ihn unsichtbar
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, now(), now() + interval '2 hours')`;
		fremd = await u.neuerAuftrag('beauftragt', 'Geheim');
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('anlegen, auflisten (mit Domain), ändern, löschen – Verlauf zeigt alles', async () => {
		const l = await legeLinkAn(kA(), ALLE(), u.auftragA, { url: 'https://www.partner-portal.de/abnahme/77', titel: 'Abnahme beim Partner', notiz: 'Zugang beim Bauleiter' });
		expect(l).toMatchObject({ titel: 'Abnahme beim Partner', domain: 'partner-portal.de', imPortal: false });
		expect(await listeLinks(kA(), MONTEUR(), u.auftragA)).toEqual([l]);
		const neu = await aendereLink(kA(), ALLE(), u.auftragA, l.id, { url: 'partner-portal.de/abnahme/78', titel: 'Abnahme' });
		expect(neu).toMatchObject({ url: 'https://partner-portal.de/abnahme/78', notiz: null });
		await setzeLinkImPortal(kA(), ALLE(), u.auftragA, l.id, true);
		await loescheLink(kA(), ALLE(), u.auftragA, l.id);
		expect(await listeLinks(kA(), ALLE(), u.auftragA)).toEqual([]);
		const v = (await linkVerlauf(kA(), u.auftragA)).map((x) => x.zeile.titel);
		expect(v).toEqual([
			'Link „Abnahme“ (partner-portal.de) entfernt',
			'Link „Abnahme“ (partner-portal.de) im Kundenportal sichtbar',
			'Link „Abnahme“ (partner-portal.de) geändert',
			'Link „Abnahme beim Partner“ (partner-portal.de) hinzugefügt'
		]);
	});

	it('Sicht: unsichtbarer Auftrag → 404, auch über einen anderen Auftrag oder fremden Betrieb', async () => {
		const l = await legeLinkAn(kA(), ALLE(), fremd, { url: 'https://geheim.de' });
		await expect(listeLinks(kA(), MONTEUR(), fremd)).rejects.toMatchObject({ status: 404 });
		await expect(legeLinkAn(kA(), MONTEUR(), fremd, { url: 'https://x.de' })).rejects.toMatchObject({ status: 404 });
		// Link-ID eines anderen Auftrags über Auftrag A ändern/löschen: nicht gefunden
		await expect(aendereLink(kA(), ALLE(), u.auftragA, l.id, { url: 'https://boese.de' })).rejects.toMatchObject({ status: 404 });
		await expect(loescheLink(kA(), ALLE(), u.auftragA, l.id)).rejects.toMatchObject({ status: 404 });
		await expect(listeLinks({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, { alle: true, benutzerId: u.ids.chefB }, fremd)).rejects.toMatchObject({ status: 404 });
		const m = await linksZuAuftraegen(kA(), MONTEUR(), [u.auftragA, fremd]);
		expect(m.has(fremd)).toBe(false);
	});

	it('Datenbank lehnt javascript:/data: und Leerzeichen ab – auch an der App vorbei', async () => {
		for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://a.de/ b', 'https://a.de/"x']) {
			await expect(root`insert into app.auftrag_links (betrieb_id, auftrag_id, titel, url) values (${u.betriebA}, ${u.auftragA}, 'x', ${url})`, url).rejects.toMatchObject({ code: '23514' });
		}
	});

	it('Formular-Aktionen: Monteur darf nicht anlegen (403), Portal-Schalter nur mit Portal-Recht', async () => {
		const ev = (nutzer: Nutzer, felder: Record<string, string>) => ({ locals: { nutzer }, params: { id: u.auftragA }, request: formular(felder) }) as never;
		const r = (await actions.linkNeu(ev(u.monteurA, { url: 'https://a.de' }))) as { status: number };
		expect(r.status).toBe(403);
		// Büro ohne kundenportal.verwalten: „im Portal“ wird ignoriert
		const ohnePortal = { ...u.bueroA, rechte: u.bueroA.rechte.filter((x: string) => x !== 'kundenportal.verwalten') };
		await actions.linkNeu(ev(ohnePortal, { url: 'https://b.de', imPortal: 'on' }));
		const [b] = await listeLinks(kA(), ALLE(), u.auftragA);
		expect(b.imPortal).toBe(false);
		expect(((await actions.linkPortal(ev(ohnePortal, { linkId: b.id, imPortal: 'ja' }))) as { status: number }).status).toBe(403);
		const bad = (await actions.linkNeu(ev(u.chefA, { url: 'javascript:alert(1)' }))) as { status: number; data: { linkFehler: string } };
		expect(bad.status).toBe(400);
		expect(bad.data.linkFehler).toMatch(/http/);
		// Auftragsseite: Monteur sieht den Link, darf aber nichts ändern
		const seite = (await auftragLoad({ locals: { nutzer: u.monteurA }, params: { id: u.auftragA } } as never)) as Record<string, any>;
		expect(seite.links.map((x: { url: string }) => x.url)).toEqual(['https://b.de/']);
		expect(seite.darfLinkPortal).toBe(false);
		await loescheLink(kA(), ALLE(), u.auftragA, b.id);
	});

	it('Kundenportal zeigt nur freigegebene Links, ohne Notiz', async () => {
		portalAbruf.leeren();
		await root`insert into app.portal_einstellungen (betrieb_id, standard) values (${u.betriebA}, 'alle_aktiven') on conflict (betrieb_id) do update set standard = 'alle_aktiven'`;
		await legeLinkAn(kA(), ALLE(), u.auftragA, { url: 'https://intern.de', titel: 'Intern', notiz: 'nur intern' });
		const sichtbar = await legeLinkAn(kA(), ALLE(), u.auftragA, { url: 'https://kunde.de/plan', titel: 'Ihr Plan', notiz: 'geheime Notiz', imPortal: true });
		expect(sichtbar.imPortal).toBe(true);
		const { token } = await erzeugeLink({ k: kA(), sicht: ALLE(), preise: true }, u.kundeA);
		const s = (await ladePortal(token, '203.0.113.9'))!;
		const a = s.auftraege.find((x) => x.id === u.auftragA)!;
		expect(a.links).toEqual([{ titel: 'Ihr Plan', url: 'https://kunde.de/plan' }]);
		expect(JSON.stringify(s)).not.toContain('geheime Notiz');
		expect(JSON.stringify(s)).not.toContain('intern.de');
	});
});
