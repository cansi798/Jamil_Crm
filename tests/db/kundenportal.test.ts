import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, testPng, type Umgebung } from './hilfe-1c';
import { erzeugeLink, portalStand, portalVerlauf, portalZugriff, setzeAbAutomatisch, setzeDokument, setzeFreigabe, speicherePortalEinstellungen, widerrufeLink, tokenHash } from '../../src/lib/server/kundenportal';
import { entscheide, ladePortal, portalAbruf, portalAktion, portalDokument, portalFehlversuch } from '../../src/lib/server/kundenportal-oeffentlich';
import { setzeAngebotStatus } from '../../src/lib/server/angebote';
import { listeAuftragsbestaetigungen, markiereAbGesendet } from '../../src/lib/server/auftragsbestaetigung';
import { abonniere, type AngebotAngenommen } from '../../src/lib/server/ereignisse';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

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
		await root`delete from app.portal_einstellungen`;
		await root`update app.auftraege set ab_automatisch = null`;
		// Regel „nur markierte“ + Auftrag A markiert: so steht in den meisten Tests genau ein Auftrag im Portal
		await root`insert into app.portal_einstellungen (betrieb_id, standard) values (${u.betriebA}, 'nur_markierte')`;
		await root`insert into app.portal_auftrag (auftrag_id, betrieb_id, sichtbar) values (${u.auftragA}, ${u.betriebA}, true)`;
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
		expect(s.auftraege[0]).toMatchObject({ id: u.auftragA, status: { schluessel: 'anfrage' } });
		expect(s.auftraege[0].termine![0].mitarbeiter).toEqual(['Ali']);
		expect(JSON.stringify(s)).not.toMatch(/Fremd|Monteur|Lindenweg|monteur-a@/);
		// Freigabe: ohne Termine/Vornamen/Status
		await setzeFreigabe(zA(), u.auftragA, { sichtbar: 'an', status: false, termine: false, mitarbeiter: false, annahme: false });
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
				{ titel: 'Fliesen abschlagen', erledigt: true, tag: '2026-10-20', laerm: 3, schmutz: 3 },
				{ titel: 'Fugen', erledigt: false, tag: null, laerm: null, schmutz: 1 }
			]);
			expect(JSON.stringify(s)).not.toMatch(/Silikon|schwierig/);
			// Standard „nur Vorname“: Zuständige (Büro) als Ansprechpartner, Team = Zuständige + kommende Termine
			expect(a.ansprechpartner).toBe('Büro');
			expect(a.team).toEqual(['Ali', 'Büro']);
			await root`update app.portal_einstellungen set team_namen = 'voll' where betrieb_id = ${u.betriebA}`;
			const voll = (await ladePortal(token, IP))!.auftraege[0];
			expect(voll).toMatchObject({ ansprechpartner: 'Büro A', team: ['Ali Monteur', 'Büro A'] });
			expect(voll.termine![0].mitarbeiter).toEqual(['Ali Monteur']);
			await root`update app.portal_einstellungen set team_namen = 'aus' where betrieb_id = ${u.betriebA}`;
			const aus = (await ladePortal(token, IP))!.auftraege[0];
			expect(aus).toMatchObject({ ansprechpartner: null, team: [] });
			expect(aus.termine![0].mitarbeiter).toEqual([]);
			// Schalter „Namen der Mitarbeiter“ am Auftrag aus → kein Team, Status aus → keine Schritte
			await root`update app.portal_einstellungen set team_namen = 'vorname' where betrieb_id = ${u.betriebA}`;
			await setzeFreigabe(zA(), u.auftragA, { sichtbar: 'an', status: false, termine: true, mitarbeiter: false, annahme: true });
			const ohne = (await ladePortal(token, IP))!.auftraege[0];
			expect(ohne).toMatchObject({ schritte: null, team: [], ansprechpartner: 'Büro' });
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
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', name: '', agb: true }, IP)).rejects.toMatchObject({ status: 400 });
		const r = await entscheide(token, an.id, { entscheidung: 'angenommen', name: 'Hans Müller', agb: true }, IP);
		ab();
		expect(r.status).toBe('angenommen');
		expect(r.hinweise[0]).toMatch(/^Auftragsbestätigung AB-\d{4}-0001 erstellt – bereit zum Versand/);
		expect(gemeldet).toEqual([{ betriebId: u.betriebA, benutzerId: null, angebotId: an.id, auftragId: u.auftragA, quelle: 'kundenportal' }]);
		const [st] = await root`select an.status, a.status as auftrag from app.angebote an join app.auftraege a on a.id = an.auftrag_id where an.id = ${an.id}`;
		expect(st).toEqual({ status: 'angenommen', auftrag: 'beauftragt' });
		const [ent] = await root`select name, agb_bestaetigt, agb_url, token_hash, ip_hash from app.angebot_entscheidungen where angebot_id = ${an.id}`;
		expect(ent).toMatchObject({ name: 'Hans Müller', agb_bestaetigt: true, agb_url: 'https://a.test/agb' });
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
		await setzeFreigabe(zA(), u.auftragA, { sichtbar: 'an', status: true, termine: true, mitarbeiter: true, annahme: false });
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', name: 'Hans', agb: true }, IP)).rejects.toMatchObject({ status: 403 });
		await setzeFreigabe(zA(), u.auftragA, { sichtbar: 'an', status: true, termine: true, mitarbeiter: true, annahme: true });
		const r = await entscheide(token, an.id, { entscheidung: 'abgelehnt', name: 'Hans Müller', agb: false, grund: 'zu teuer' }, IP);
		expect(r.status).toBe('abgelehnt');
		const [t] = await root`select titel, beschreibung from app.todos where titel like ${`%${an.nummer}%abgelehnt%`}`;
		expect(t.beschreibung).toMatch(/zu teuer/);
		expect(await listeAuftragsbestaetigungen(kA(), u.auftragA)).toEqual([]);
	});

	it('Auftragsbestätigung auch bei Annahme im Büro; Schalter je Betrieb aus, je Auftrag wieder an', async () => {
		const an = await versendetesAngebot(u.auftragA);
		const r = await setzeAngebotStatus(kA(), an.id, 'angenommen');
		expect(r.hinweis).toMatch(/Auftragsbestätigung AB-\d{4}-\d{4} erstellt/);
		const [ab] = await root`select ausloeser from app.auftragsbestaetigungen where angebot_id = ${an.id}`;
		expect(ab.ausloeser).toBe('oberflaeche');
		// Betrieb aus → keine; Auftrag an → doch
		await speicherePortalEinstellungen(kA(), { abAutomatisch: false });
		const zwei = await u.neuerAuftrag('angebot', 'Zweiter');
		const an2 = await versendetesAngebot(zwei);
		await setzeAngebotStatus(kA(), an2.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), zwei)).toEqual([]);
		const drei = await u.neuerAuftrag('angebot', 'Dritter');
		await setzeAbAutomatisch(zA(), drei, true);
		const an3 = await versendetesAngebot(drei);
		await setzeAngebotStatus(kA(), an3.id, 'angenommen');
		expect(await listeAuftragsbestaetigungen(kA(), drei)).toHaveLength(1);
	});

	it('Ein Portal je Kunde (msg 2793): Regel „alle aktiven“ zeigt alle offenen Aufträge, „nein“ am Auftrag blendet aus; neuer Link ersetzt den alten', async () => {
		const zweiter = await u.neuerAuftrag('beauftragt', 'Zweiter Auftrag');
		const fertig = await u.neuerAuftrag('abgerechnet', 'Längst abgerechnet');
		const alt = await erzeugeLink(zA(), u.kundeA);
		const { token } = await erzeugeLink(zA(), u.kundeA);
		expect(await ladePortal(alt.token, IP)).toBeNull();
		expect((await ladePortal(token, IP))!.auftraege.map((a) => a.id)).toEqual([u.auftragA]);
		await speicherePortalEinstellungen(kA(), { standard: 'alle_aktiven', abAutomatisch: true });
		const ids = (await ladePortal(token, IP))!.auftraege.map((a) => a.id);
		expect(ids).toEqual(expect.arrayContaining([u.auftragA, zweiter]));
		expect(ids).not.toContain(fertig);
		await setzeFreigabe(zA(), zweiter, { sichtbar: 'aus', status: true, termine: true, mitarbeiter: true, annahme: true });
		expect((await ladePortal(token, IP))!.auftraege.map((a) => a.id)).not.toContain(zweiter);
		expect((await portalStand(zA(), zweiter)).imPortal).toBe(false);
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
		await expect(setzeAbAutomatisch(nurEigene, fremd, false)).rejects.toMatchObject({ status: 404 });
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
		const r = await GET({ params: { token }, getClientAddress: () => '192.0.2.1' } as never);
		expect(r.headers.get('content-type')).toBe('image/png');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toMatch(/sandbox/);
		// Upload-Prüfung: SVG als Datei am Auftrag wird abgelehnt
		const { speichereDatei } = await import('../../src/lib/server/dateien');
		await expect(speichereDatei({ betriebId: u2.betriebA, benutzerId: u2.ids.chefA }, u2.auftragA, 'x.svg', 'image/svg+xml', svg.length, new Uint8Array(svg))).rejects.toMatchObject({ status: 400 });
	});
});
