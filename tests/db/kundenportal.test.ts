import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, testPng, type Umgebung } from './hilfe-1c';
import { kundenPortal, holeAgbPdfInfo, ladeKundeAb, ladePortalEinstellungen, nachweiseZumAngebot, speichereAgbPdf, erzeugeLink, portalStand, portalVerlauf, portalZugriff, setzeDokument, speichereKundeAb, speichereKundenPortal, speicherePortalEinstellungen, widerrufeLink, tokenHash } from '../../src/lib/server/kundenportal';
import { portalAgb, entscheide, ladePortal, portalAbruf, portalAktion, portalDokument, portalFehlversuch } from '../../src/lib/server/kundenportal-oeffentlich';
import { setzeAngebotStatus } from '../../src/lib/server/angebote';
import { listeAuftragsbestaetigungen, markiereAbGesendet } from '../../src/lib/server/auftragsbestaetigung';
import { abonniere, type AngebotAngenommen } from '../../src/lib/server/ereignisse';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { GET as agbGet } from '../../src/routes/portal/[token]/agb/+server';
import { actions as einstellungenAktionen, load as einstellungenLoad } from '../../src/routes/(app)/einstellungen/kundenportal/+page.server';
import { actions as kundenAktionen } from '../../src/routes/(app)/kunden/[id]/+page.server';
import { actions as bestandAktionen, load as bestandLoad } from '../../src/routes/(app)/einstellungen/kundenportal/+page.server';
import { load as bestandAlt } from '../../src/routes/(app)/einstellungen/bestandskunden/+page.server';
import { ladeBestandskunden } from '../../src/lib/server/kundenportal';

/** Kundenportal und Auftragsbestätigung (Jamil msgs 2770–2774 Punkt 4, 2778). */
describe('Kundenportal', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const zA = () => ({ k: kA(), sicht: { alle: true, benutzerId: u.ids.chefA }, preise: true });
	const IP = '203.0.113.7';

	async function versendetesAngebot(auftrag: string) {
		const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${auftrag}, 'entwurf', '2099-12-31') returning id, nummer`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
			values (${u.betriebA}, ${a.id}, 1, 'Fliesen verlegen', 10, 'm²', 5000)`;
		await root`update app.angebote set status = 'versendet' where id = ${a.id}`;
		await root`update app.auftraege set status = 'angebot' where id = ${auftrag}`;
		return a as { id: string; nummer: string };
	}

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await root`insert into app.betrieb_profil (betrieb_id, firmenname, telefon, email) values (${u.betriebA}, 'Bauwelt A', '040 123', 'info@a.test') on conflict (betrieb_id) do update set firmenname = excluded.firmenname`;
		await root`update app.kunden set email = 'mueller@kunde.test' where id = ${u.kundeA}`;
		await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${u.betriebA}, ${u.auftragA}, ${u.ids.bueroA}) on conflict do nothing`;
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, now() + interval '2 days', now() + interval '2 days 4 hours')`;
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		portalAbruf.leeren();
		portalAktion.leeren();
		portalFehlversuch.leeren();
		await root`delete from app.auftragsbestaetigungen`;
		await root`delete from app.angebot_entscheidungen`;
		await leereAngebote(root);
		await root`delete from app.portal_links`;
		await root`delete from app.portal_dokumente`;
		await root`delete from app.portal_auftrag`;
		await root`delete from app.kunden_portal`;
		await root`delete from app.portal_einstellungen`;
		await root`update app.auftraege set ab_automatisch = null`;
		// Regel „nur ausdrücklich eingeschaltete Kunden“ + Kunde A eingeschaltet: so steht in den meisten Tests genau Kunde A im Portal
		await root`insert into app.portal_einstellungen (betrieb_id, standard) values (${u.betriebA}, 'nur_markierte')`;
		await root`insert into app.kunden_portal (kunde_id, betrieb_id, sichtbar) values (${u.kundeA}, ${u.betriebA}, true)`;
		// Das Portal zeigt jetzt alle aktiven Aufträge des Kunden (nicht mehr je Auftrag): Aufträge anderer Tests entfernen
		await root`delete from app.auftraege where kunde_id = ${u.kundeA} and id <> ${u.auftragA}`;
	});

	it('Rechte: Link erzeugen nur mit Modul kundenportal + Aufträge bearbeiten', async () => {
		await expect(portalZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		await expect(portalZugriff({ nutzer: u.chefC })).rejects.toMatchObject({ status: 402 });
		await expect(portalZugriff({ nutzer: u.bueroA })).resolves.toBeTruthy();
	});

	it('Token: nur der SHA-256 liegt in der Datenbank, nie im Protokoll; Portal zeigt Status, Termine mit Vornamen, kein anderer Kunde', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const [l] = await root`select token_hash from app.portal_links`;
		expect(Buffer.from(l.token_hash).equals(tokenHash(token))).toBe(true);
		const prot = await root`select nachher::text as t from app.aenderungen where tabelle = 'portal_links'`;
		expect(prot.every((p) => !p.t.includes('token_hash') && !p.t.includes(token))).toBe(true);
		const s = (await ladePortal(token, IP))!;
		expect(s.betrieb.name).toBe('Bauwelt A');
		expect(s.auftraege).toHaveLength(1);
		expect(s.auftraege[0]).toMatchObject({ id: u.auftragA, status: { schluessel: 'anfrage', name: 'Anfrage eingegangen' } });
		// Karte „Auch nach Projektabschluss für Sie da“ (msg 3142) erst mit einem abgeschlossenen Auftrag
		expect(s.bestandskunde).toBe(false);
		const [fertig] = await root`insert into app.auftraege (betrieb_id, kunde_id, titel, status, nummer)
			select betrieb_id, kunde_id, 'Alt fertig', 'abgerechnet', 'A-TEST-9999' from app.auftraege where id = ${u.auftragA} returning id`;
		expect((await ladePortal(token, IP))!.bestandskunde).toBe(true);
		await root`delete from app.auftraege where id = ${fertig.id}`;
		expect(s.auftraege[0].termine![0].mitarbeiter).toEqual(['Ali']);
		expect(JSON.stringify(s)).not.toMatch(/Fremd|Monteur|Lindenweg|monteur-a@/);
		// Freigabe beim Kunden: ohne Termine/Vornamen/Status
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', status: 'aus', termine: 'aus', mitarbeiter: 'aus', annahme: 'aus' });
		const s2 = (await ladePortal(token, IP))!;
		expect(s2.auftraege[0]).toMatchObject({ status: null, termine: null });
	});

	it('Handwerks-Portal (msgs 2848, 2851): Arbeitsschritte nur mit Lautstärke/Schmutz, Ansprechpartner und Team nach Einstellung', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		// vor „beauftragt“: keine Arbeitsschritte
		expect((await ladePortal(token, IP))!.auftraege[0].schritte).toBeNull();
		await root`update app.auftraege set status = 'in_arbeit' where id = ${u.auftragA}`;
		const [t1] = await root`insert into app.todos (betrieb_id, auftrag_id, titel, lautstaerke, schmutz, faellig) values (${u.betriebA}, ${u.auftragA}, 'Fliesen abschlagen', 3, 3, '2026-10-20') returning id`;
		await root`update app.todos set erledigt_am = now() where id = ${t1.id}`;
		await root`insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, schmutz) values (${u.betriebA}, ${u.auftragA}, 'Fugen', 'intern: Kunde ist schwierig', 1)`;
		await root`insert into app.todos (betrieb_id, auftrag_id, titel) values (${u.betriebA}, ${u.auftragA}, 'Silikon nachbestellen')`;
		try {
			const s = (await ladePortal(token, IP))!;
			const a = s.auftraege[0];
			expect(a.schritte).toEqual([
				{ titel: 'Fliesen abschlagen', erledigt: true, tag: '2026-10-20', vonTag: null, laerm: 3, schmutz: 3 },
				{ titel: 'Fugen', erledigt: false, tag: null, vonTag: null, laerm: null, schmutz: 1 }
			]);
			expect(JSON.stringify(s)).not.toMatch(/Silikon|schwierig/);
			// Erscheinungsbild je Betrieb (msg 2953): Standard, dann wie die Website
			expect(s.betrieb.marke).toEqual({ dunkel: null, hintergrund: null, titelSchrift: 'montserrat', textSchrift: 'inter', titelGross: false });
			await root`insert into app.betrieb_profil (betrieb_id, dunkel_farbe, hintergrund_farbe, text_schrift, titel_gross) values (${u.betriebA}, '#2d2c2e', '#f4f1eb', 'opensans', true)
				on conflict (betrieb_id) do update set dunkel_farbe = excluded.dunkel_farbe, hintergrund_farbe = excluded.hintergrund_farbe, text_schrift = excluded.text_schrift, titel_gross = true`;
			expect((await ladePortal(token, IP))!.betrieb.marke).toEqual({ dunkel: '#2d2c2e', hintergrund: '#f4f1eb', titelSchrift: 'montserrat', textSchrift: 'opensans', titelGross: true });
			await root`update app.betrieb_profil set dunkel_farbe = null, hintergrund_farbe = null, text_schrift = null, titel_gross = false where betrieb_id = ${u.betriebA}`;
			// Standard „nur Vorname“: Zuständige (Büro) als Ansprechpartner, Team = Zuständige + kommende Termine
			// Figuren (msg 3113): ohne Anrede männliche Standardfigur; Monteur-Rolle → Monteur, Büro → Projektbegleiter
			expect(a.ansprechpartner).toEqual({ name: 'Büro', figur: 'projektbegleiter' });
			expect(a.team).toEqual([
				{ name: 'Ali', figur: 'monteur' },
				{ name: 'Büro', figur: 'projektbegleiter' }
			]);
			await root`update app.benutzer set anrede = 'frau' where id in (${u.ids.bueroA}, ${u.ids.monteurA})`;
			const frau = (await ladePortal(token, IP))!.auftraege[0];
			expect(frau.ansprechpartner).toEqual({ name: 'Büro', figur: 'projektbegleiterin' });
			expect(frau.team.map((t) => t.figur)).toEqual(['monteurin', 'projektbegleiterin']);
			await root`update app.benutzer set anrede = null where id in (${u.ids.bueroA}, ${u.ids.monteurA})`;
			await root`update app.portal_einstellungen set team_namen = 'voll' where betrieb_id = ${u.betriebA}`;
			const voll = (await ladePortal(token, IP))!.auftraege[0];
			expect(voll.ansprechpartner?.name).toBe('Büro A');
			expect(voll.team.map((t) => t.name)).toEqual(['Ali Monteur', 'Büro A']);
			expect(voll.termine![0].mitarbeiter).toEqual(['Ali Monteur']);
			await root`update app.portal_einstellungen set team_namen = 'aus' where betrieb_id = ${u.betriebA}`;
			const aus = (await ladePortal(token, IP))!.auftraege[0];
			expect(aus).toMatchObject({ ansprechpartner: null, team: [] });
			expect(aus.termine![0].mitarbeiter).toEqual([]);
			// Schalter „Namen der Mitarbeiter“ beim Kunden aus → kein Team, Status aus → keine Schritte
			await root`update app.portal_einstellungen set team_namen = 'vorname' where betrieb_id = ${u.betriebA}`;
			await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', status: 'aus', termine: 'an', mitarbeiter: 'aus', annahme: 'an' });
			const ohne = (await ladePortal(token, IP))!.auftraege[0];
			expect(ohne).toMatchObject({ schritte: null, team: [], ansprechpartner: { name: 'Büro', figur: 'projektbegleiter' } });
		} finally {
			await root`delete from app.todos where auftrag_id = ${u.auftragA}`;
			await root`update app.auftraege set status = 'anfrage' where id = ${u.auftragA}`;
		}
	});

	it('Ungültig: falsches Token, widerrufen, abgelaufen, Modul fehlt → kein Zugriff; Durchprobieren → 429', async () => {
		const { token, id } = await erzeugeLink(zA(), u.kundeA);
		expect(await ladePortal('x'.repeat(43), IP)).toBeNull();
		expect(await ladePortal('kurz', IP)).toBeNull();
		await widerrufeLink(zA(), u.kundeA, id);
		expect(await ladePortal(token, IP)).toBeNull();
		const zwei = await erzeugeLink(zA(), u.kundeA);
		await root`update app.portal_links set laeuft_ab = now() - interval '1 minute' where id = ${zwei.id}`;
		expect(await ladePortal(zwei.token, IP)).toBeNull();
		await expect(erzeugeLink(zA(), u.kundeA, '2000-01-01')).rejects.toMatchObject({ status: 400 });
		portalFehlversuch.leeren();
		for (let i = 0; i < 20; i++) await ladePortal('y'.repeat(43), '198.51.100.1').catch(() => null);
		await expect(ladePortal('y'.repeat(43), '198.51.100.1')).rejects.toMatchObject({ status: 429 });
		// Betrieb ohne Modul: Link löst sich nicht auf
		const drei = await erzeugeLink(zA(), u.kundeA);
		const [premium] = await root`select tarif_id from app.betriebe where id = ${u.betriebA}`;
		const [ohne] = await root`select id from app.tarife where schluessel = 'ohne-angebote'`;
		await root`update app.betriebe set tarif_id = ${ohne.id} where id = ${u.betriebA}`;
		expect(await ladePortal(drei.token, IP)).toBeNull();
		await root`update app.betriebe set tarif_id = ${premium.tarif_id} where id = ${u.betriebA}`;
	});

	it('Dokumente nur freigegeben und nur im eigenen Auftrag; anderer Betrieb sieht keine Links (RLS)', async () => {
		const an = await versendetesAngebot(u.auftragA);
		const [d] = await root`insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt) values (${u.betriebA}, ${u.auftragA}, 'foto.png', 'image/png', 100, ${Buffer.from(testPng())}) returning id`;
		const { token } = await erzeugeLink(zA(), u.kundeA);
		// versendetes Angebot wird beim ersten Link automatisch freigegeben, die Datei nicht
		const pdf = await portalDokument(token, 'angebot', an.id, IP);
		expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
		await expect(portalDokument(token, 'datei', d.id, IP)).rejects.toMatchObject({ status: 404 });
		await setzeDokument(zA(), u.auftragA, 'datei', d.id, true);
		expect((await portalDokument(token, 'datei', d.id, IP)).typ).toBe('image/png');
		// im Portal als „Foto“ in „Ihre Unterlagen“ (msg 2958), mit Datum
		expect((await ladePortal(token, IP))!.auftraege[0].dateien[0]).toMatchObject({ id: d.id, art: 'foto', datum: expect.any(String) });
		// Dokument eines anderen Auftrags über diesen Link: nie
		const anderer = await u.neuerAuftrag('angebot', 'Anderer');
		const an2 = await versendetesAngebot(anderer);
		await expect(portalDokument(token, 'angebot', an2.id, IP)).rejects.toMatchObject({ status: 404 });
		const sichtbar = await mitBetrieb({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, (tx) => tx`select count(*)::int as n from app.portal_links`);
		expect(sichtbar[0].n).toBe(0);
		const stand = await portalStand(zA(), u.auftragA);
		expect(stand.dateien[0]).toMatchObject({ name: 'foto.png', geteilt: true });
	});

	it('Annahme im Portal: AGB-Häkchen Pflicht, Nachweis (Token- und IP-Hash), Auftrag beauftragt, Auftragsbestätigung mit Aufgabe und Glocke, Hook', async () => {
		await speicherePortalEinstellungen(kA(), { agbUrl: 'https://a.test/agb', abAutomatisch: 'ja', standard: 'nur_markierte' });
		const an = await versendetesAngebot(u.auftragA);
		const { token } = await erzeugeLink(zA(), u.kundeA);
		const gemeldet: AngebotAngenommen[] = [];
		const ab = abonniere('angebotAngenommen', async (e) => {
			gemeldet.push(e);
		});
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', name: 'Hans Müller', agb: false }, IP)).rejects.toMatchObject({ status: 400 });
		// kein Namensfeld mehr (msg 3032): ein mitgeschickter Name wird ignoriert, der Nachweis nimmt den Kunden aus dem CRM
		const r = await entscheide(token, an.id, { entscheidung: 'angenommen', name: 'Irgendwer', agb: true }, IP);
		ab();
		expect(r.status).toBe('angenommen');
		expect(r.hinweise[0]).toMatch(/^Auftragsbestätigung AB-\d{4}-0001 erstellt – bereit zum Versand/);
		expect(gemeldet).toEqual([{ betriebId: u.betriebA, benutzerId: null, angebotId: an.id, auftragId: u.auftragA, quelle: 'kundenportal' }]);
		const [st] = await root`select an.status, a.status as auftrag from app.angebote an join app.auftraege a on a.id = an.auftrag_id where an.id = ${an.id}`;
		expect(st).toEqual({ status: 'angenommen', auftrag: 'beauftragt' });
		const [ent] = await root`select name, agb_bestaetigt, agb_url, token_hash, ip_hash from app.angebot_entscheidungen where angebot_id = ${an.id}`;
		expect(ent).toMatchObject({ name: 'Hans Müller', agb_bestaetigt: true, agb_url: 'https://a.test/agb' });
		// ohne hinterlegtes AGB-PDF keine Fassung im Nachweis
		const [ohnePdf] = await root`select agb_pdf_hash, agb_pdf_stand from app.angebot_entscheidungen where angebot_id = ${an.id}`;
		expect(ohnePdf).toEqual({ agb_pdf_hash: null, agb_pdf_stand: null });
		expect(Buffer.from(ent.token_hash).equals(tokenHash(token))).toBe(true);
		expect(Buffer.from(ent.ip_hash).toString('hex')).not.toContain(Buffer.from(IP).toString('hex'));
		const abs = await listeAuftragsbestaetigungen(kA(), u.auftragA);
		expect(abs).toEqual([expect.objectContaining({ versandStatus: 'bereit', mailAn: 'mueller@kunde.test', mailBetreff: expect.stringMatching(/^Auftragsbestätigung AB-/) })]);
		const [pdf] = await root`select pdf from app.auftragsbestaetigungen where id = ${abs[0].id}`;
		expect(Buffer.from(pdf.pdf).subarray(0, 5).toString()).toBe('%PDF-');
		// Aufgabe und Glocke für den Zuständigen (Büro A ist zuständig)
		const [t] = await root`select zustaendig_id, titel from app.todos where id = (select todo_id from app.auftragsbestaetigungen where id = ${abs[0].id})`;
		expect(t).toMatchObject({ zustaendig_id: u.ids.bueroA, titel: expect.stringMatching(/an den Kunden senden/) });
		const [glocke] = await root`select benutzer_id, titel from app.erinnerungen where todo_id = (select todo_id from app.auftragsbestaetigungen where id = ${abs[0].id})`;
		expect(glocke).toMatchObject({ benutzer_id: u.ids.bueroA, titel: expect.stringMatching(/angenommen/) });
		// sofort im Portal sichtbar; zweite Entscheidung → 409
		const s = (await ladePortal(token, IP))!;
		expect(s.auftraege[0].auftragsbestaetigungen).toHaveLength(1);
		expect(s.auftraege[0].angebote[0]).toMatchObject({ status: 'angenommen', annehmbar: false, entscheidung: expect.objectContaining({ name: 'Hans Müller' }) });
		const abDok = await portalDokument(token, 'ab', abs[0].id, IP);
		expect(abDok.name).toMatch(/^Auftragsbestaetigung_AB-/);
		await expect(entscheide(token, an.id, { entscheidung: 'abgelehnt', name: 'X Y', agb: false }, IP)).rejects.toMatchObject({ status: 409 });
		// Verlauf: Kundenaktion + Auftragsbestätigung
		const v = (await portalVerlauf(kA(), u.auftragA)).map((x) => x.zeile.titel);
		expect(v).toEqual(expect.arrayContaining([expect.stringMatching(/online angenommen/), expect.stringMatching(/Auftragsbestätigung AB-.* erstellt/)]));
		await markiereAbGesendet(kA(), abs[0].id);
		const [erledigt] = await root`select erledigt_am from app.todos where id = (select todo_id from app.auftragsbestaetigungen where id = ${abs[0].id})`;
		expect(erledigt.erledigt_am).not.toBeNull();
	});

	it('Ablehnung mit Grund → Aufgabe; Online-Annahme abgeschaltet → 403', async () => {
		const an = await versendetesAngebot(u.auftragA);
		const { token } = await erzeugeLink(zA(), u.kundeA);
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', annahme: 'aus' });
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', name: 'Hans', agb: true }, IP)).rejects.toMatchObject({ status: 403 });
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an' });
		const r = await entscheide(token, an.id, { entscheidung: 'abgelehnt', agb: false, grund: 'zu teuer' }, IP);
		expect(r.status).toBe('abgelehnt');
		const [t] = await root`select titel, beschreibung from app.todos where titel like ${`%${an.nummer}%abgelehnt%`}`;
		expect(t.beschreibung).toMatch(/zu teuer/);
		expect(await listeAuftragsbestaetigungen(kA(), u.auftragA)).toEqual([]);
	});

	it('Auftragsbestätigung auch bei Annahme im Büro; Schalter je Betrieb aus, je Kunde wieder an', async () => {
		const an = await versendetesAngebot(u.auftragA);
		const r = await setzeAngebotStatus(kA(), an.id, 'angenommen');
		expect(r.hinweis).toMatch(/Auftragsbestätigung AB-\d{4}-\d{4} erstellt/);
		const [ab] = await root`select ausloeser from app.auftragsbestaetigungen where angebot_id = ${an.id}`;
		expect(ab.ausloeser).toBe('oberflaeche');
		// Betrieb aus → keine; Kunde an → doch (Jamil msg 3439: eingestellt wird beim Kunden)
		await speicherePortalEinstellungen(kA(), { abAutomatisch: false });
		const zwei = await u.neuerAuftrag('angebot', 'Zweiter');
		const an2 = await versendetesAngebot(zwei);
		await setzeAngebotStatus(kA(), an2.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), zwei)).toEqual([]);
		const drei = await u.neuerAuftrag('angebot', 'Dritter');
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an' });
		await speichereKundeAb(kA(), u.kundeA, 'an');
		const an3 = await versendetesAngebot(drei);
		await setzeAngebotStatus(kA(), an3.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), drei)).toHaveLength(1);
	});

	it('Ein Portal je Kunde (msg 2793): Regel „alle aktiven“ zeigt alle offenen Aufträge, „nein“ beim Kunden blendet alle aus; neuer Link ersetzt den alten', async () => {
		const zweiter = await u.neuerAuftrag('beauftragt', 'Zweiter Auftrag');
		const fertig = await u.neuerAuftrag('abgerechnet', 'Längst abgerechnet');
		const alt = await erzeugeLink(zA(), u.kundeA);
		const { token } = await erzeugeLink(zA(), u.kundeA);
		expect(await ladePortal(alt.token, IP)).toBeNull();
		// Regel „nur ausdrücklich eingeschaltete Kunden“ + Kunde A eingeschaltet: alle aktiven Aufträge von A, nie abgerechnete
		const eingeschaltet = (await ladePortal(token, IP))!.auftraege.map((a) => a.id);
		expect(eingeschaltet).toEqual(expect.arrayContaining([u.auftragA, zweiter]));
		expect(eingeschaltet).not.toContain(fertig);
		await speicherePortalEinstellungen(kA(), { standard: 'alle_aktiven', abAutomatisch: true });
		const ids = (await ladePortal(token, IP))!.auftraege.map((a) => a.id);
		expect(ids).toEqual(expect.arrayContaining([u.auftragA, zweiter]));
		expect(ids).not.toContain(fertig);
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'aus' });
		expect((await ladePortal(token, IP))!.auftraege).toEqual([]);
		expect((await portalStand(zA(), zweiter)).imPortal).toBe(false);
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: '' });
		expect((await portalStand(zA(), u.auftragA))).toMatchObject({ imPortal: true, kundeHatLink: true, kundeId: u.kundeA });
		// Monteur ohne „Kundenportal verwalten“: kein Zugriff
		await expect(portalZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		await expect(portalZugriff({ nutzer: u.bueroA })).resolves.toBeTruthy();
	});

	it('Sicherheit: Sicht und Preisrechte gelten auch in der Portal-Verwaltung', async () => {
		const an = await versendetesAngebot(u.auftragA);
		const fremd = await u.neuerAuftrag('angebot', 'Fremder Auftrag');
		const [kd2] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Zweitkunde') returning id`;
		// „nur eigene Aufträge“ (Monteur mit Bearbeiten-Recht): fremder Auftrag/Kunde → 404, keine Links, kein Schalter
		const nurEigene = { k: { betriebId: u.betriebA, benutzerId: u.ids.monteurA }, sicht: { alle: false, benutzerId: u.ids.monteurA }, preise: false };
		await expect(erzeugeLink(nurEigene, kd2.id)).rejects.toMatchObject({ status: 403 });
		// auch wenn er EINEN Auftrag des Kunden sieht (Monteur hat einen Einsatz bei Auftrag A, Kunde A hat weitere): 403
		const weiteres = await versendetesAngebot(fremd);
		await expect(erzeugeLink({ ...nurEigene, preise: true }, u.kundeA)).rejects.toMatchObject({ status: 403 });
		const [{ geteilt }] = await root`select count(*)::int as geteilt from app.portal_dokumente where ref_id = ${weiteres.id}`;
		expect(geteilt).toBe(0);
		await expect(erzeugeLink({ ...zA(), k: { betriebId: u.betriebB, benutzerId: u.ids.chefB } }, u.kundeA)).rejects.toMatchObject({ status: 404 });
		await expect(speichereKundenPortal(nurEigene, u.kundeA, { status: 'aus' })).rejects.toMatchObject({ status: 403 });
		await expect(portalStand(nurEigene, fremd)).rejects.toMatchObject({ status: 404 });
		const [{ n }] = await root`select count(*)::int as n from app.portal_links where kunde_id = ${kd2.id}`;
		expect(n).toBe(0);
		// ohne Preisrechte: Link ja, aber kein Angebot wird (automatisch oder von Hand) freigegeben
		const ohnePreise = { ...zA(), preise: false };
		const { token } = await erzeugeLink(ohnePreise, u.kundeA);
		await expect(setzeDokument(ohnePreise, u.auftragA, 'angebot', an.id, true)).rejects.toMatchObject({ status: 403 });
		expect((await ladePortal(token, IP))!.auftraege[0].angebote).toEqual([]);
		expect((await portalStand(ohnePreise, u.auftragA)).angebote).toEqual([]);
		await expect(portalZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		expect((await portalZugriff({ nutzer: u.ohnePreiseA })).preise).toBe(false);
	});

	it('Sprache: „Angebot Müller ist angenommen“ → bestätigen → angenommen, Auftragsbestätigung; Monteur darf nicht', async () => {
		setzeKiAnbieter(new FakeKi());
		await versendetesAngebot(u.auftragA);
		const sag = async (nutzer: Nutzer, text: string) => (await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const r = await sag(u.chefA, 'Angebot Müller ist angenommen');
		expect(r.karte.aktion).toBe('angebot_entscheidung');
		expect(r.vorschlag).toBeTruthy();
		const aus = await antwort(await ausfuehrenPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { vorschlag: r.vorschlag }) } as never));
		expect(aus.status).toBe(200);
		expect(aus.koerper.warnungen.join(' ')).toMatch(/Auftragsbestätigung/);
		const [ab] = await root`select ausloeser from app.auftragsbestaetigungen where auftrag_id = ${u.auftragA} order by angelegt desc limit 1`;
		expect(ab.ausloeser).toBe('sprache');
		expect((await sag(u.monteurA, 'Angebot Müller ist angenommen')).karte.fehler).toMatch(/Berechtigung/);
	});

	it('AGB als PDF (msg 3030): hochladen nur PDF + Recht, Portal-Abruf nur mit Token, Fassung im Nachweis und Verlauf', async () => {
		const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
		// Prüfung: kein PDF / leer → 400; Büro ohne „Einstellungen“ → 403
		await expect(speichereAgbPdf(kA(), new TextEncoder().encode('<svg onload=alert(1)>'))).rejects.toMatchObject({ status: 400 });
		await expect(speichereAgbPdf(kA(), new Uint8Array())).rejects.toMatchObject({ status: 400 });
		const f = new FormData();
		f.append('agb', new File([pdf('Fassung 1') as BlobPart], 'agb.pdf', { type: 'application/pdf' }));
		const verboten = (await einstellungenAktionen.agb({ locals: { nutzer: u.monteurA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never)) as { status: number };
		expect(verboten.status).toBe(403);
		// ohne PDF: Warnung in den Einstellungen (agbPdf null), Portal ohne PDF-Link
		expect(((await einstellungenLoad({ locals: { nutzer: u.chefA } } as never)) as { agbPdf: unknown }).agbPdf).toBeNull();
		const an = await versendetesAngebot(u.auftragA); // vor dem Link: dann ist es im Portal freigegeben
		const { token } = await erzeugeLink(zA(), u.kundeA);
		expect((await ladePortal(token, IP))!.agbPdf).toBeNull();
		await expect(portalAgb(token, IP)).rejects.toMatchObject({ status: 404 });
		// Chef lädt hoch → Fassung (SHA-256 + Zeitpunkt)
		expect(await einstellungenAktionen.agb({ locals: { nutzer: u.chefA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never)).toEqual({ agbGespeichert: true });
		const v1 = (await holeAgbPdfInfo(kA()))!;
		expect(v1.hash).toMatch(/^[0-9a-f]{64}$/);
		expect((await ladePortal(token, IP))!.agbPdf).toEqual({ stand: v1.hochgeladen });
		// Portal-Abruf: PDF mit sicheren Kopfzeilen; falscher Token → 404; anderer Betrieb nie
		const r = await agbGet({ params: { token }, locals: { portalAngemeldet: true }, request: new Request('http://t/'), getClientAddress: () => IP } as never);
		expect(r.headers.get('content-type')).toBe('application/pdf');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('referrer-policy')).toBe('no-referrer');
		expect(new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
		await expect(portalAgb('x'.repeat(43), IP)).rejects.toMatchObject({ status: 404 });
		// Annahme hält genau diese Fassung fest; danach neue Fassung → alter Nachweis bleibt
		await entscheide(token, an.id, { entscheidung: 'angenommen', agb: true }, IP);
		await speichereAgbPdf(kA(), pdf('Fassung 2'));
		const [ent] = await root`select name, agb_pdf_hash, agb_pdf_stand from app.angebot_entscheidungen where angebot_id = ${an.id}`;
		expect(ent.name).toBe('Hans Müller');
		expect(ent.agb_pdf_hash).toBe(v1.hash);
		expect(new Date(ent.agb_pdf_stand).toISOString()).toBe(v1.hochgeladen);
		expect((await holeAgbPdfInfo(kA()))!.hash).not.toBe(v1.hash);
		// Verlauf des Auftrags und Nachweis am Angebot nennen die Fassung
		const verlauf = (await portalVerlauf(kA(), u.auftragA)).map((x) => x.zeile.titel);
		expect(verlauf).toEqual(expect.arrayContaining([expect.stringContaining(`SHA-256 ${v1.hash.slice(0, 12)}`)]));
		expect(await nachweiseZumAngebot(kA(), an.id)).toEqual([expect.objectContaining({ entscheidung: 'angenommen', name: 'Hans Müller', agb: expect.stringContaining(v1.hash.slice(0, 12)) })]);
		// PDF-Bytes nie im Änderungsprotokoll
		const [p] = await root`select count(*)::int as n from app.aenderungen where tabelle = 'portal_einstellungen' and nachher ? 'agb_pdf'`;
		expect(p.n).toBe(0);
	});

	it('Leistungen für Bestandskunden (msg 3408): Standard, speichern mit Prüfung, Anzeige nur bei abgeschlossenem Auftrag und eingeschalteter Karte, Rechte, Mandanten', async () => {
		const sende = (nutzer: unknown, daten: unknown) => {
			const f = new FormData();
			f.set('daten', typeof daten === 'string' ? daten : JSON.stringify(daten));
			return bestandAktionen.bestand({ locals: { nutzer }, request: new Request('http://t/', { method: 'POST', body: f }) } as never) as Promise<{ bestandGespeichert?: boolean; status?: number; data?: { fehler?: string } }>;
		};
		const { token } = await erzeugeLink(zA(), u.kundeA);
		// Standard ohne gespeicherte Werte: an, sechs Leistungen, neutraler Titel
		expect(await ladeBestandskunden(kA())).toMatchObject({ aktiv: true, titel: 'Auch nach Abschluss für Sie da', knoepfe: [] });
		expect((await ladeBestandskunden(kA())).leistungen).toHaveLength(6);
		expect(((await bestandLoad({ locals: { nutzer: u.chefA } } as never)) as { bestand: { aktiv: boolean } }).bestand.aktiv).toBe(true);
		// alte Adresse leitet auf den Abschnitt in den Kundenportal-Einstellungen (Jamil msg 3534)
		let umleitung: unknown = null;
		try {
			await bestandAlt({} as never);
		} catch (e) {
			umleitung = e;
		}
		expect(umleitung).toMatchObject({ status: 308, location: '/einstellungen/kundenportal#bestandskunden' });
		// ohne abgeschlossenen Auftrag keine Karte (Aufträge anderer Tests stehen ggf. schon auf „abgerechnet“)
		await root`update app.auftraege set status = 'anfrage' where kunde_id = ${u.kundeA} and status = 'abgerechnet'`;
		await root`delete from app.portal_einstellungen`;
		expect((await ladePortal(token, IP))!.bestandskarte).toBeNull();
		const [fertig] = await root`insert into app.auftraege (betrieb_id, kunde_id, titel, status, nummer)
			select betrieb_id, kunde_id, 'Alt fertig', 'abgerechnet', 'A-TEST-9998' from app.auftraege where id = ${u.auftragA} returning id`;
		const standard = (await ladePortal(token, IP))!.bestandskarte;
		expect(standard).toMatchObject({ titel: 'Auch nach Abschluss für Sie da', knoepfe: [] });
		expect(standard!.leistungen.map((l) => l.titel)).toContain('Winterdienst');

		// Rechte: Monteur darf weder laden noch speichern
		expect((await sende(u.monteurA, { aktiv: false })).status).toBe(403);
		await expect(bestandLoad({ locals: { nutzer: u.monteurA } } as never)).rejects.toMatchObject({ status: 403 });
		// Büro/Chef speichern: eigene Überschrift, Text, Leistungen, Knöpfe
		const eigen = {
			aktiv: true,
			titel: 'Wir bleiben für Sie da',
			text: 'Rufen Sie uns an.',
			leistungen: [{ titel: 'Heizungswartung', text: 'Einmal im Jahr', symbol: 'reparatur' }, { titel: 'Notdienst', text: '', symbol: 'telefon' }],
			knoepfe: [{ text: 'Termin anfragen', url: 'https://www.beispiel.test/anfrage' }, { text: 'Anrufen', url: 'tel:+4940123456' }]
		};
		expect(await sende(u.chefA, eigen)).toEqual({ bestandGespeichert: true });
		const s = (await ladePortal(token, IP))!;
		expect(s.bestandskarte).toEqual({ titel: eigen.titel, text: eigen.text, leistungen: eigen.leistungen, knoepfe: eigen.knoepfe });
		// Mandant B sieht nichts davon (Standard), Portal-Karte von A bleibt unverändert
		expect(await ladeBestandskunden({ betriebId: u.betriebB, benutzerId: u.ids.chefB })).toMatchObject({ titel: 'Auch nach Abschluss für Sie da' });
		const [zeileB] = await root`select bestand_titel from app.portal_einstellungen where betrieb_id = ${u.betriebB}`;
		expect(zeileB).toBeUndefined();

		// Serverseitige Prüfung: gefährliche Links, Längen, Anzahl, kaputte Daten – nichts wird gespeichert
		const vorher = (await ladeBestandskunden(kA()));
		for (const schlecht of [
			{ ...eigen, knoepfe: [{ text: 'X', url: 'javascript:alert(1)' }] },
			{ ...eigen, knoepfe: [{ text: 'X', url: 'http://unsicher.test' }] },
			{ ...eigen, knoepfe: [{ text: 'X', url: 'data:text/html,hi' }] },
			{ ...eigen, titel: 'x'.repeat(61) },
			{ ...eigen, leistungen: Array.from({ length: 11 }, () => ({ titel: 'a', symbol: 'haus' })) },
			{ ...eigen, knoepfe: Array.from({ length: 5 }, () => eigen.knoepfe[0]) }
		]) {
			const r = await sende(u.chefA, schlecht);
			expect(r.status).toBe(400);
		}
		expect((await sende(u.chefA, 'kein json')).status).toBe(400);
		expect(await ladeBestandskunden(kA())).toEqual(vorher);
		// Die Datenbank sichert Grenzen zusätzlich ab (auch am Pflichtweg vorbei)
		await expect(root`update app.portal_einstellungen set bestand_knoepfe = '{"a":1}'::jsonb where betrieb_id = ${u.betriebA}`).rejects.toThrow();
		await expect(root`update app.portal_einstellungen set bestand_titel = ${'x'.repeat(61)} where betrieb_id = ${u.betriebA}`).rejects.toThrow();
		// Text mit HTML bleibt Text (Ausgabe geschieht im Portal escaped)
		expect(await sende(u.chefA, { ...eigen, titel: '<b>Fett</b>', leistungen: [], knoepfe: [] })).toEqual({ bestandGespeichert: true });
		expect((await ladePortal(token, IP))!.bestandskarte).toMatchObject({ titel: '<b>Fett</b>', leistungen: [] });

		// Ausgeschaltet: keine Karte, obwohl der Kunde Bestandskunde ist
		expect(await sende(u.chefA, { ...eigen, aktiv: false })).toEqual({ bestandGespeichert: true });
		const aus = (await ladePortal(token, IP))!;
		expect(aus.bestandskunde).toBe(true);
		expect(aus.bestandskarte).toBeNull();
		// Wieder an, aber Auftrag nicht mehr abgeschlossen: keine Karte
		await sende(u.chefA, eigen);
		expect((await ladePortal(token, IP))!.bestandskarte).not.toBeNull();
		await root`delete from app.auftraege where id = ${fertig.id}`;
		expect((await ladePortal(token, IP))!.bestandskarte).toBeNull();
		// Änderung ist im Änderungsprotokoll nachvollziehbar
		const [p] = await root`select count(*)::int as n from app.aenderungen where betrieb_id = ${u.betriebA} and tabelle = 'portal_einstellungen' and nachher ? 'bestand_titel'`;
		expect(p.n).toBeGreaterThan(0);
	});

	it('Portal-Einstellungen beim Kunden (msg 3439): Vererbung Firma → Kunde, Rückfallwerte, Prüfung, Rechte, Mandanten', async () => {
		const seite = async (token: string) => (await ladePortal(token, IP))!.auftraege[0];
		// Firma: Termine aus, alles andere an
		await speicherePortalEinstellungen(kA(), { standard: 'alle_aktiven', abAutomatisch: true, freiGesendet: '1', freiStatus: 'on', freiMitarbeiter: 'on', freiAnnahme: 'on' });
		expect(await ladePortalEinstellungen(kA())).toMatchObject({ freiStatus: true, freiTermine: false, freiMitarbeiter: true, freiAnnahme: true });
		await root`delete from app.kunden_portal`;
		const { token } = await erzeugeLink(zA(), u.kundeA);
		let a = await seite(token);
		expect(a.termine).toBeNull();
		expect(a.status).not.toBeNull();
		// Kunde überschreibt: Termine ja → erbt nichts mehr für Termine, Rest erbt weiter
		await speichereKundenPortal(zA(), u.kundeA, { termine: 'an' });
		a = await seite(token);
		expect(a.termine).not.toBeNull();
		expect(a.status).not.toBeNull();
		let e = (await kundenPortal(zA(), u.kundeA)).einstellung;
		expect(e.kunde).toEqual({ sichtbar: null, status: null, termine: true, mitarbeiter: null, apAusblenden: null, annahme: null, bestand: null, abAutomatisch: null });
		expect(e.firma).toMatchObject({ sichtbar: true, termine: false, status: true, abAutomatisch: true });
		// Kunde leer → Zeile entfällt, erbt wieder
		await speichereKundenPortal(zA(), u.kundeA, { termine: '' });
		expect((await root`select count(*)::int as n from app.kunden_portal where kunde_id = ${u.kundeA}`)[0].n).toBe(0);
		expect((await seite(token)).termine).toBeNull();
		e = (await kundenPortal(zA(), u.kundeA)).einstellung;
		expect(Object.values(e.kunde).every((x) => x === null)).toBe(true);
		// Rückfallwerte: ganz ohne Firmen-Zeile gilt „alles an, alle aktiven Aufträge“
		await root`delete from app.portal_einstellungen`;
		a = await seite(token);
		expect(a.status).not.toBeNull();
		expect(a.termine).not.toBeNull();
		expect(await ladePortalEinstellungen(kA())).toMatchObject({ standard: 'alle_aktiven', freiStatus: true, freiTermine: true, freiMitarbeiter: true, freiAnnahme: true });
		// Prüfung der Eingaben und Zugriff
		await expect(speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'vielleicht' })).rejects.toMatchObject({ status: 400 });
		await expect(speichereKundenPortal(zA(), u.kundeA, { status: 'ja' })).rejects.toMatchObject({ status: 400 });
		await expect(speichereKundenPortal(zA(), 'kein-uuid', {})).rejects.toMatchObject({ status: 404 });
		await expect(speichereKundenPortal(zA(), u.kundeB, { status: 'aus' })).rejects.toMatchObject({ status: 404 });
		await expect(speichereKundenPortal({ ...zA(), k: { betriebId: u.betriebB, benutzerId: u.ids.chefB } }, u.kundeA, { status: 'aus' })).rejects.toMatchObject({ status: 404 });
		const nurEigene = { k: { betriebId: u.betriebA, benutzerId: u.ids.monteurA }, sicht: { alle: false, benutzerId: u.ids.monteurA }, preise: false };
		await expect(speichereKundenPortal(nurEigene, u.kundeA, { status: 'aus' })).rejects.toMatchObject({ status: 403 });
		// Seitenaktion beim Kunden: Monteur 403, Büro/Chef speichern
		const sende = (nutzer: unknown, felder: Record<string, string>) =>
			kundenAktionen.portalEinstellung({ locals: { nutzer }, params: { id: u.kundeA }, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams(felder) }) } as never) as unknown as Promise<{ status?: number; einstellungMeldung?: string }>;
		expect((await sende(u.monteurA, { status: 'aus' })).status).toBe(403);
		expect((await sende(u.chefA, { sichtbar: 'bla' })).status).toBe(400);
		expect(await sende(u.bueroA, { status: 'aus' })).toMatchObject({ einstellungMeldung: expect.stringContaining('gespeichert') });
		expect((await seite(token)).status).toBeNull();
		// Mandanten: Betrieb B sieht die Zeile von A nie, und eine Zeile für einen fremden Kunden ist nicht möglich
		expect((await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select count(*)::int as n from app.kunden_portal`))[0].n).toBe(0);
		expect((await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select count(*)::int as n from app.kunden_portal`))[0].n).toBe(1);
		await expect(root`insert into app.kunden_portal (kunde_id, betrieb_id, sichtbar) values (${u.kundeB}, ${u.betriebA}, true)`).rejects.toThrow();
		// Auftragsbestätigung: Kunde „aus“ schlägt Firma „an“, Kunde leer erbt
		await speichereKundeAb(kA(), u.kundeA, 'aus');
		const an1 = await versendetesAngebot(u.auftragA);
		await setzeAngebotStatus(kA(), an1.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), u.auftragA)).toEqual([]);
		await speichereKundeAb(kA(), u.kundeA, '');
		const zwei = await u.neuerAuftrag('angebot', 'Zweiter für AB');
		const an2 = await versendetesAngebot(zwei);
		await setzeAngebotStatus(kA(), an2.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), zwei)).toHaveLength(1);
	});

	it('Auftragsseite (msg 3439): nur Hinweis „wird beim Kunden eingestellt“, keine Portal-Schalter mehr; Dokument-Freigabe bleibt', async () => {
		const { load: auftragLoad, actions: auftragAktionen } = await import('../../src/routes/(app)/auftraege/[id]/+page.server');
		await erzeugeLink(zA(), u.kundeA);
		const laden = async () => (await auftragLoad({ locals: { nutzer: u.chefA }, params: { id: u.auftragA }, url: new URL('https://crm.test/x') } as never)) as any;
		let seite = await laden();
		expect(seite.portal.freigabe).toBeUndefined();
		expect(seite.portal.standard).toBeUndefined();
		expect(seite.portal.kundeId).toBe(u.kundeA);
		expect(seite.abHinweis).toMatchObject({ an: true, kundeId: u.kundeA });
		expect(seite.kundeEinstellbar).toBe(true);
		// Monteur (ohne „Kundenportal verwalten“): kein Link zur Kundenakte, keine AB-Anzeige
		const monteurSeite = (await auftragLoad({ locals: { nutzer: u.monteurA }, params: { id: u.auftragA }, url: new URL('https://crm.test/x') } as never)) as any;
		expect(monteurSeite.kundeEinstellbar).toBe(false);
		expect(monteurSeite.abHinweis).toBeNull();
		await speichereKundeAb(kA(), u.kundeA, 'aus');
		seite = await laden();
		expect(seite.abHinweis.an).toBe(false);
		expect((auftragAktionen as Record<string, unknown>).portalFreigabe).toBeUndefined();
		expect((auftragAktionen as Record<string, unknown>).abAutomatisch).toBeUndefined();
		expect((auftragAktionen as Record<string, unknown>).portalDokument).toBeTypeOf('function');
		expect(Array.isArray(seite.portal.dateien)).toBe(true);
	});

	it('Kunde „Aufträge im Portal zeigen: ja“ nachträglich: schon versendete Angebote erscheinen wie beim Erzeugen des Links (msg 2793)', async () => {
		await root`delete from app.kunden_portal`; // Regel „nur ausdrücklich eingeschaltete Kunden“ → Kunde A steht nicht im Portal
		const { token } = await erzeugeLink(zA(), u.kundeA);
		const an = await versendetesAngebot(u.auftragA);
		expect((await ladePortal(token, IP))!.auftraege).toHaveLength(0);
		expect(await root`select 1 from app.portal_dokumente where ref_id = ${an.id}`).toHaveLength(0);
		// ohne Preisrechte wird nichts freigegeben (wie beim Link)
		await speichereKundenPortal({ ...zA(), preise: false }, u.kundeA, { sichtbar: 'an' });
		expect(await root`select 1 from app.portal_dokumente where ref_id = ${an.id}`).toHaveLength(0);
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an' });
		const seite = (await ladePortal(token, IP))!;
		expect(seite.auftraege).toHaveLength(1);
		expect(seite.auftraege[0].angebote.map((x: { id: string }) => x.id)).toContain(an.id);
		// wieder „nein“: Auftrag verschwindet, die Freigabe bleibt stehen (wird erst wieder sichtbar, wenn der Auftrag im Portal steht)
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'aus' });
		expect((await ladePortal(token, IP))!.auftraege).toHaveLength(0);
	});

	it('Funktionen & Automatisierungen: Schalter nur mit „Einstellungen“ und Modul wie die Einstellungsseiten', async () => {
		const { actions: funktionenAktionen } = await import('../../src/routes/(app)/einstellungen/funktionen/+page.server');
		const schalten = (nutzer: unknown) =>
			funktionenAktionen.schalten({ locals: { nutzer }, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams({ name: 'bestand_aktiv', wert: 'aus' }) }) } as never) as unknown as Promise<{ status?: number }>;
		expect((await schalten(u.monteurA)).status).toBe(403);
		expect((await schalten(u.chefC)).status).toBe(402);
		expect(await schalten(u.chefA)).toMatchObject({ gespeichert: true });
		expect((await ladeBestandskunden(kA())).aktiv).toBe(false);
	});

	it('Jamil msg 3521 B/C: Karte ab Status oder immer, je Kunde ein/aus (Vererbung Firma → Kunde)', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		await root`update app.auftraege set status = 'beauftragt' where kunde_id = ${u.kundeA}`;
		const karte = async () => (await ladePortal(token, IP))!.bestandskarte;
		const sende = (daten: unknown) => {
			const f = new FormData();
			f.set('daten', JSON.stringify(daten));
			return bestandAktionen.bestand({ locals: { nutzer: u.chefA }, request: new Request('http://t/', { method: 'POST', body: f }) } as never) as Promise<{ bestandGespeichert?: boolean; status?: number }>;
		};
		const basis = { aktiv: true, titel: 'Da', text: 'Hallo', leistungen: [], knoepfe: [] };
		// Standard „abgerechnet“: Auftrag nur beauftragt → keine Karte
		expect(await karte()).toBeNull();
		expect(await sende({ ...basis, ab: 'beauftragt' })).toEqual({ bestandGespeichert: true });
		expect(await karte()).toMatchObject({ titel: 'Da' });
		expect(await sende({ ...basis, ab: 'abgenommen' })).toEqual({ bestandGespeichert: true });
		expect(await karte()).toBeNull();
		expect(await sende({ ...basis, ab: 'immer' })).toEqual({ bestandGespeichert: true });
		expect(await karte()).not.toBeNull();
		expect((await sende({ ...basis, ab: 'irgendwann' })).status).toBe(400);
		await expect(root`update app.portal_einstellungen set bestand_ab = 'bald' where betrieb_id = ${u.betriebA}`).rejects.toThrow();
		// je Kunde aus → keine Karte; Firma aus + Kunde an → Karte
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', bestand: 'aus' });
		expect(await karte()).toBeNull();
		await sende({ ...basis, ab: 'immer', aktiv: false });
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', bestand: 'an' });
		expect(await karte()).not.toBeNull();
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', bestand: '' });
		expect(await karte()).toBeNull();
		expect((await kundenPortal(zA(), u.kundeA)).einstellung.firma.bestand).toBe(false);
	});

	it('Jamil msg 3521 D: ohne Mitarbeiternamen auf Wunsch auch den Projektbegleiter ausblenden (Firma, je Kunde)', async () => {
		const { token } = await erzeugeLink(zA(), u.kundeA);
		const a = async () => (await ladePortal(token, IP))!.auftraege[0];
		expect((await a()).ansprechpartner).not.toBeNull();
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', mitarbeiter: 'aus' });
		expect((await a()).team).toEqual([]);
		expect((await a()).ansprechpartner).not.toBeNull(); // Standard: Projektbegleiter bleibt
		await speicherePortalEinstellungen(kA(), { standard: 'nur_markierte', abAutomatisch: true, apAusblenden: 'on' });
		expect((await ladePortalEinstellungen(kA())).apAusblenden).toBe(true);
		expect((await a()).ansprechpartner).toBeNull();
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', mitarbeiter: 'aus', apAusblenden: 'aus' });
		expect((await a()).ansprechpartner).not.toBeNull();
		// Team gezeigt → die Einstellung wirkt nicht
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', apAusblenden: 'an' });
		expect((await a()).ansprechpartner).not.toBeNull();
	});

	it('Jamil msg 3521 E: Auftragsbestätigung beim Kunden auch ohne Kundenportal – Recht „Aufträge bearbeiten“', async () => {
		const sende = (nutzer: unknown, wert: string) =>
			kundenAktionen.abAutomatisch({ locals: { nutzer }, params: { id: u.kundeA }, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams({ abAutomatisch: wert }) }) } as never) as unknown as Promise<{ status?: number; abMeldung?: string }>;
		expect((await sende(u.monteurA, 'aus')).status).toBe(403);
		expect((await sende(u.chefA, 'vielleicht')).status).toBe(400);
		// Portal-Einstellungen des Kunden bleiben unberührt
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an', termine: 'aus' });
		expect(await sende(u.bueroA, 'aus')).toMatchObject({ abMeldung: 'Gespeichert.' });
		expect(await ladeKundeAb(kA(), u.kundeA)).toEqual({ kunde: false, firma: true });
		expect((await kundenPortal(zA(), u.kundeA)).einstellung.kunde).toMatchObject({ termine: false, abAutomatisch: false });
		// Portal-Formular speichern ändert die Auftragsbestätigung nicht
		await speichereKundenPortal(zA(), u.kundeA, { sichtbar: 'an' });
		expect((await ladeKundeAb(kA(), u.kundeA)).kunde).toBe(false);
		// beides leer → Zeile entfällt
		await speichereKundenPortal(zA(), u.kundeA, {});
		await speichereKundeAb(kA(), u.kundeA, '');
		expect(await root`select 1 from app.kunden_portal where kunde_id = ${u.kundeA}`).toHaveLength(0);
		// Mandanten: fremder Kunde → 404
		await expect(speichereKundeAb(kA(), u.kundeB, 'an')).rejects.toMatchObject({ status: 404 });
		await expect(speichereKundeAb({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, u.kundeA, 'an')).rejects.toMatchObject({ status: 404 });
		// Betrieb ohne Modul Angebote → 402
		expect(((await kundenAktionen.abAutomatisch({ locals: { nutzer: u.chefC }, params: { id: u.kundeA }, request: new Request('http://t/', { method: 'POST', body: new URLSearchParams({ abAutomatisch: 'an' }) }) } as never)) as unknown as { status?: number }).status).toBe(402);
	});

	it('Migration 108: bisherige Werte am Auftrag werden je Kunde übernommen (vorsichtigste Auswahl), nichts geht verloren', async () => {
		const [kd2] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Migration Zwei') returning id`;
		const [kd3] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Migration Drei') returning id`;
		const o = async (kunde: string, titel: string) => (await root`insert into app.auftraege (betrieb_id, kunde_id, titel) values (${u.betriebA}, ${kunde}, ${titel}) returning id`)[0].id as string;
		const zweiterA = await o(u.kundeA, 'Mig A2');
		const aKd2 = await o(kd2.id, 'Mig K2');
		const aKd3 = await o(kd3.id, 'Mig K3');
		// Altwerte: Kunde A: Auftrag 1 ausdrücklich im Portal, Status aus; Auftrag 2 Auftragsbestätigung aus.
		// Kunde 2: einziger Auftrag ausdrücklich ausgeblendet. Kunde 3: nur Standardwerte.
		await root`insert into app.portal_auftrag (auftrag_id, betrieb_id, sichtbar, status) values (${u.auftragA}, ${u.betriebA}, true, false) on conflict (auftrag_id) do update set sichtbar = true, status = false`;
		await root`update app.auftraege set ab_automatisch = false where id = ${zweiterA}`;
		await root`insert into app.portal_auftrag (auftrag_id, betrieb_id, sichtbar) values (${aKd2}, ${u.betriebA}, false)`;
		await root`insert into app.portal_auftrag (auftrag_id, betrieb_id, termine, mitarbeiter, annahme) values (${aKd3}, ${u.betriebA}, false, false, false)`;
		const teil = readFileSync('db/migrations/108_portal_je_kunde.sql', 'utf8');
		const uebernahme = teil.slice(teil.indexOf('-- Übernahme der bisherigen Werte'));
		const zeile = async (id: string) => (await root`select sichtbar, frei_status, frei_termine, frei_mitarbeiter, frei_annahme, ab_automatisch from app.kunden_portal where kunde_id = ${id}`)[0];
		// Regel „nur markierte“ (Firma): Kunde A hatte einen ausdrücklich gezeigten Auftrag → Kunde ja
		await root`delete from app.kunden_portal`;
		await root.unsafe(uebernahme);
		expect(await zeile(u.kundeA)).toEqual({ sichtbar: true, frei_status: false, frei_termine: null, frei_mitarbeiter: null, frei_annahme: null, ab_automatisch: false });
		expect(await zeile(kd2.id)).toBeUndefined(); // „nur markierte“: ausdrücklich ausgeblendet = Standard, nichts zu übernehmen
		expect(await zeile(kd3.id)).toEqual({ sichtbar: null, frei_status: null, frei_termine: false, frei_mitarbeiter: false, frei_annahme: false, ab_automatisch: null });
		// Regel „alle aktiven“: ausdrücklich ausgeblendeter Kunde bleibt ausgeblendet
		await root`update app.portal_einstellungen set standard = 'alle_aktiven' where betrieb_id = ${u.betriebA}`;
		await root`delete from app.kunden_portal`;
		await root.unsafe(uebernahme);
		expect((await zeile(kd2.id)).sichtbar).toBe(false);
		expect((await zeile(u.kundeA)).sichtbar).toBeNull();
		// zweiter Lauf ändert nichts (idempotent) und die Altwerte am Auftrag sind unverändert
		await root.unsafe(uebernahme);
		expect((await root`select count(*)::int as n from app.kunden_portal`)[0].n).toBe(3);
		expect((await root`select status from app.portal_auftrag where auftrag_id = ${u.auftragA}`)[0].status).toBe(false);
		expect((await root`select ab_automatisch from app.auftraege where id = ${zweiterA}`)[0].ab_automatisch).toBe(false);
		// Firma ab aus + Auftrag ab an → Kunde an
		await root`update app.portal_einstellungen set ab_automatisch = false where betrieb_id = ${u.betriebA}`;
		await root`update app.auftraege set ab_automatisch = true where id = ${aKd2}`;
		await root`delete from app.kunden_portal`;
		await root.unsafe(uebernahme);
		expect((await zeile(kd2.id)).ab_automatisch).toBe(true);
		// Aufräumen
		await root`delete from app.auftraege where id in (${zweiterA}, ${aKd2}, ${aKd3})`;
		await root`delete from app.kunden where id in (${kd2.id}, ${kd3.id})`;
	});
});

describe('Logos und Dateien: kein SVG/HTML vom App-Ursprung', () => {
	let u2: Umgebung;
	beforeAll(async () => {
		u2 = await baueUmgebung();
	});
	afterAll(async () => {
		await schliesseDb();
		await u2?.root.end();
	});
	it('SVG/HTML-Logo lässt die Datenbank gar nicht zu; Portal- und Buchungslogo nur als Rasterbild mit sandbox', async () => {
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
		for (const typ of ['image/svg+xml', 'text/html']) {
			await expect(u2.root`insert into app.betrieb_profil (betrieb_id, logo, logo_typ) values (${u2.betriebA}, ${svg}, ${typ})
				on conflict (betrieb_id) do update set logo = excluded.logo, logo_typ = excluded.logo_typ`).rejects.toMatchObject({ code: '23514' });
		}
		await u2.root`insert into app.betrieb_profil (betrieb_id, logo, logo_typ) values (${u2.betriebA}, ${Buffer.from(testPng())}, 'image/png')
			on conflict (betrieb_id) do update set logo = excluded.logo, logo_typ = excluded.logo_typ`;
		const { token } = await erzeugeLink({ k: { betriebId: u2.betriebA, benutzerId: u2.ids.chefA }, sicht: { alle: true, benutzerId: u2.ids.chefA }, preise: true }, u2.kundeA);
		const { GET } = await import('../../src/routes/portal/[token]/logo/+server');
		const r = await GET({ params: { token }, url: new URL(`http://t/portal/${token}/logo`), locals: { portalAngemeldet: true }, getClientAddress: () => '192.0.2.1' } as never);
		expect(r.headers.get('content-type')).toBe('image/png');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toMatch(/sandbox/);
		// Upload-Prüfung: SVG als Datei am Auftrag wird abgelehnt
		const { speichereDatei } = await import('../../src/lib/server/dateien');
		await expect(speichereDatei({ betriebId: u2.betriebA, benutzerId: u2.ids.chefA }, u2.auftragA, 'x.svg', 'image/svg+xml', svg.length, new Uint8Array(svg))).rejects.toMatchObject({ status: 400 });
	});

});
