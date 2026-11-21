import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { _ratenlimitLeeren } from '../../src/lib/server/lexware/ratenlimit';
import { holeClient, speichereLexwareSchluessel } from '../../src/lib/server/lexware/konfig';
import { laufFuerBetrieb } from '../../src/lib/server/lexware/dienst';
import { starteAbgleich } from '../../src/lib/server/lexware/abgleich';
import { lexwareAngebotPdf, lexwareHinweise, markiereAngebotGesendet } from '../../src/lib/server/lexware/angebote';
import {
	ENTWURF_OHNE_NUMMER,
	holeAngebot,
	legeAngebotAn,
	neueVersion,
	setzeAngebotStatus,
	setzeTerminvorschlaege,
	speichereAngebot
} from '../../src/lib/server/angebote';
import { setzeMailVersand, type Mail } from '../../src/lib/server/mail/versand';
import { erzeugeLink, speicherePortalEinstellungen } from '../../src/lib/server/kundenportal';
import { entscheide, ladePortal, portalAktion, portalDokument } from '../../src/lib/server/kundenportal-oeffentlich';
import { starteAttrappe, type Attrappe } from '../hilfe/lexware-attrappe';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { antwort, jsonAnfrage } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/** Angebot über Lexware, Annahme → Lexware-AB, drei Terminvorschläge (Plan Phase 2; Migration 121). */
describe('Lexware: Angebote, Auftragsbestätigung, Terminvorschläge', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const NACHTS_1UHR = new Date('2026-11-15T00:00:00Z');
	const lauf = async () => laufFuerBetrieb(kA(), { client: await holeClient(kA(), { abstandMs: 0, zeitlimitMs: 300 }), jetzt: NACHTS_1UHR });
	const morgen = (n = 1) => tagPlus(berlinTag(new Date()), n);
	const POS = [
		{ bezeichnung: 'Fliesen verlegen', menge: '10', einheit: 'm²', einzelpreis: '60,00', materialCent: 2000 },
		{ bezeichnung: 'Anfahrt', menge: '1', einheit: 'psch', einzelpreis: '45,00', materialCent: 0 }
	];
	const posts = (pfad: string) => a.anfragen.filter((x) => x.methode === 'POST' && x.pfad === pfad);

	async function neuesAngebot(auftrag = u.auftragA) {
		const an = await legeAngebotAn(kA(), auftrag);
		return speichereAngebot(kA(), an.id, { positionen: POS });
	}

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
		await root`update app.kunden set email = 'hans@kunde.test' where id = ${u.kundeA}`;
		await root`insert into app.betrieb_profil (betrieb_id, firmenname) values (${u.betriebA}, 'Bauwelt A') on conflict (betrieb_id) do nothing`;
		await speichereLexwareSchluessel(kA(), a.schluessel);
	});
	beforeEach(async () => {
		a.ruhe();
		_ratenlimitLeeren();
		await root`delete from app.lexware_auftraege`;
		await root`delete from app.auftragsbestaetigungen`;
		await root`delete from app.angebot_entscheidungen`;
		await root`delete from app.einsaetze where titel = 'Baubeginn (reserviert)'`;
		await leereAngebote(root);
		await root`update app.auftraege set status = 'anfrage', baubeginn = null where id = ${u.auftragA}`;
	});
	afterEach(() => setzeMailVersand(null));
	afterAll(async () => {
		setzeLexwareBasisFuerTests(null);
		await a?.stop();
		await schliesseDb();
		await root?.end();
	});

	it('Nummernkreis: Lexware-Betrieb → keine CRM-Nummer („Entwurf (noch ohne Nummer)“); Betrieb ohne Lexware → weiter AN-…', async () => {
		const an = await neuesAngebot();
		expect(an).toMatchObject({ nummer: ENTWURF_OHNE_NUMMER, belegQuelle: 'lexware', altbeleg: false });
		expect((await root`select nummer, beleg_quelle from app.angebote where id = ${an.id}`)[0]).toEqual({ nummer: null, beleg_quelle: 'lexware' });
		const b = await legeAngebotAn(kB(), u.auftragB);
		expect(b.nummer).toMatch(/^AN-\d{4}-\d{4}$/);
		expect(b).toMatchObject({ belegQuelle: 'crm', altbeleg: false, lexware: null });
		// auch direkt in der Datenbank: Lexware-Angebot mit erfundener Nummer → abgelehnt
		await expect(root`update app.angebote set nummer = 'AN-2026-9999' where id = ${an.id}`).rejects.toMatchObject({ code: '23514' });
		// RLS: Betrieb B sieht Terminvorschläge/Dateien von A nicht
		await setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(10) }]);
		const n = await mitBetrieb(kB(), (tx) => tx`select (select count(*)::int from app.angebot_terminvorschlaege) + (select count(*)::int from app.lexware_dateien) as n`);
		expect(n[0].n).toBe(0);
	});

	it('Versenden: genau ein festgeschriebener Beleg (Doppelklick 409), Kontakt angelegt, Lexware-Nummer + PDF, ohne Postfach Aufgabe; danach nicht mehr Entwurf', async () => {
		const an = await neuesAngebot();
		const v = await setzeAngebotStatus(kA(), an.id, 'versendet');
		expect(v.hinweis).toMatch(/Lexware festgeschrieben/);
		await expect(setzeAngebotStatus(kA(), an.id, 'versendet')).rejects.toMatchObject({ status: 409 });
		expect((await root`select lexware_phase, versendet_am from app.angebote where id = ${an.id}`)[0]).toEqual({ lexware_phase: 'wartet', versendet_am: null });
		await lauf();
		expect(posts('/v1/quotations')).toHaveLength(1);
		const anfrage = posts('/v1/quotations')[0];
		expect(anfrage.query.get('finalize')).toBe('true');
		expect(anfrage.body.address.contactId).toBe((await root`select lexware_id from app.kunden where id = ${u.kundeA}`)[0].lexware_id);
		expect(anfrage.body.remark).toContain('Arbeitskosten nach § 35a EStG');
		const fertig = await holeAngebot(kA(), an.id);
		expect(fertig.nummer).toMatch(/^AG\d{4}$/);
		expect(fertig.lexware).toMatchObject({ nummer: fertig.nummer, status: 'open', phase: 'pdf' });
		expect(fertig.versendetAm).toBeNull();
		const pdf = await lexwareAngebotPdf(kA(), an.id, { sicht: { alle: true, benutzerId: u.ids.chefA }, auftragAendern: true });
		expect(pdf!.name).toBe(`Angebot_${fertig.nummer}.pdf`);
		expect(Buffer.from(pdf!.bytes).toString('latin1')).toContain('%PDF');
		expect(await root`select 1 from app.todos where titel = ${`Angebot ${fertig.nummer} an den Kunden senden`} and erledigt_am is null`).toHaveLength(1);
		// festgeschrieben: nie wieder Entwurf (App und Datenbank)
		await expect(setzeAngebotStatus(kA(), an.id, 'entwurf')).rejects.toMatchObject({ status: 409 });
		await expect(root`update app.angebote set status = 'entwurf' where id = ${an.id}`).rejects.toMatchObject({ code: '55000' });
		await markiereAngebotGesendet(kA(), an.id, { sicht: { alle: true, benutzerId: u.ids.chefA }, auftragAendern: true });
		expect((await holeAngebot(kA(), an.id)).versendetAm).not.toBeNull();
		expect(await root`select 1 from app.todos where titel = ${`Angebot ${fertig.nummer} an den Kunden senden`} and erledigt_am is null`).toHaveLength(0);
	});

	it('Mit Postfach: Mail mit dem Lexware-PDF als Anhang (Vorlage „Angebot senden“), Versanddatum gesetzt', async () => {
		const gesendet: Mail[] = [];
		setzeMailVersand({ verbunden: true, senden: async (m) => void gesendet.push(m) });
		const an = await neuesAngebot();
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		await lauf();
		const fertig = await holeAngebot(kA(), an.id);
		expect(fertig.lexware?.phase).toBe('gesendet');
		expect(fertig.versendetAm).not.toBeNull();
		expect(gesendet).toHaveLength(1);
		expect(gesendet[0].an).toBe('hans@kunde.test');
		expect(gesendet[0].betreff).toContain(fertig.nummer);
		expect(gesendet[0].anhaenge![0]).toMatchObject({ name: `Angebot_${fertig.nummer}.pdf`, typ: 'application/pdf' });
		expect((await root`select art, lexware_id::text from app.mail_ausgang where bezug_id = ${an.id}`)[0]).toEqual({ art: 'angebot', lexware_id: fertig.lexware!.id });
	});

	it('Zeitüberschreitung beim Festschreiben → ungewiss → Belegliste findet das Angebot, kein zweiter Beleg', async () => {
		const an = await neuesAngebot();
		// Belege früherer Tests (gleicher Kunde, gleicher Betrag, gerade erst angelegt) wären sonst ebenfalls Treffer
		a.belege.length = 0;
		a.verkaufsbelege.clear();
		const vorher = posts('/v1/quotations').length;
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		a.stoerung({ verzoegerungMs: 700, trotzdemAusfuehren: true, nurPfad: /^\/v1\/quotations$/ });
		await lauf();
		expect((await root`select status from app.lexware_auftraege where art = 'angebot_festschreiben'`)[0].status).toBe('ungewiss');
		await root`update app.lexware_auftraege set naechster_versuch = now() where art = 'angebot_festschreiben'`;
		await lauf();
		expect(posts('/v1/quotations').length - vorher).toBe(1);
		expect(a.anfragen.some((x) => x.pfad === '/v1/voucherlist' && x.query.get('voucherType') === 'quotation')).toBe(true);
		expect((await holeAngebot(kA(), an.id)).lexware?.phase).toBe('pdf');
	});

	it('Versand zurücknehmen, solange Lexware noch nichts angelegt hat → wieder Entwurf, Auftrag abgebrochen; Neue Version → neuer Entwurf ohne Nummer mit Terminen', async () => {
		const an = await neuesAngebot();
		await setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(20), hinweis: 'vormittags' }, { beginn: morgen(27) }]);
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		const zurueck = await setzeAngebotStatus(kA(), an.id, 'entwurf');
		expect(zurueck).toMatchObject({ status: 'entwurf', lexware: { phase: null } });
		expect((await root`select status from app.lexware_auftraege where art = 'angebot_festschreiben'`)[0].status).toBe('abgebrochen');
		const vorher = posts('/v1/quotations').length;
		await lauf();
		expect(posts('/v1/quotations').length).toBe(vorher);
		const neu = await neueVersion(kA(), an.id);
		expect(neu).toMatchObject({ nummer: ENTWURF_OHNE_NUMMER, vorgaengerId: an.id, belegQuelle: 'lexware' });
		expect(neu.terminvorschlaege.map((t) => t.beginn)).toEqual([morgen(20), morgen(27)]);
	});

	it('Altbeleg (CRM-Nummer aus der Zeit vor Lexware): nicht änderbar, nicht versendbar; Neue Version wird ein Lexware-Angebot', async () => {
		await root`update app.lexware_konfig set belege_in_lexware = false where betrieb_id = ${u.betriebA}`;
		const alt = await neuesAngebot();
		await root`update app.lexware_konfig set belege_in_lexware = true where betrieb_id = ${u.betriebA}`;
		expect(alt.nummer).toMatch(/^AN-/);
		const jetzt = await holeAngebot(kA(), alt.id);
		expect(jetzt).toMatchObject({ belegQuelle: 'crm', altbeleg: true });
		await expect(speichereAngebot(kA(), alt.id, { einleitung: 'neu' })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Altbeleg/) });
		await expect(setzeAngebotStatus(kA(), alt.id, 'versendet')).rejects.toMatchObject({ status: 409 });
		const neu = await neueVersion(kA(), alt.id);
		expect(neu).toMatchObject({ belegQuelle: 'lexware', nummer: ENTWURF_OHNE_NUMMER, altbeleg: false });
	});

	it('Terminvorschläge: höchstens drei, nur Zukunft, nur im Entwurf; im Lexware-Angebot als Text', async () => {
		const an = await neuesAngebot();
		await expect(setzeTerminvorschlaege(kA(), an.id, [{ beginn: berlinTag(new Date()) }])).rejects.toMatchObject({ status: 400 });
		await expect(setzeTerminvorschlaege(kA(), an.id, [1, 2, 3, 4].map((n) => ({ beginn: morgen(n) })))).rejects.toMatchObject({ status: 400 });
		await expect(setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(5) }, { beginn: morgen(5) }])).rejects.toMatchObject({ status: 400 });
		const mit = await setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(14) }, { beginn: morgen(7), hinweis: 'ab 8 Uhr' }]);
		expect(mit.terminvorschlaege.map((t) => [t.pos, t.beginn])).toEqual([[1, morgen(7)], [2, morgen(14)]]);
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		await expect(setzeTerminvorschlaege(kA(), an.id, [])).rejects.toMatchObject({ status: 409 });
		await lauf();
		expect(posts('/v1/quotations').at(-1)!.body.remark).toMatch(/Mögliche Termine für den Baubeginn: 1\) .+ \(ab 8 Uhr\) 2\) /);
	});

	it('Annahme im Büro mit Termin → Lexware-AB aus dem Angebot (precedingSalesVoucherId, finalize), Baubeginn am Auftrag + reservierter Einsatz, Aufgabe „in Lexware als angenommen markieren“', async () => {
		await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${u.betriebA}, ${u.auftragA}, ${u.ids.bueroA}) on conflict do nothing`;
		const an = await neuesAngebot();
		await setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(10) }, { beginn: morgen(17) }]);
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		await lauf();
		const lx = (await holeAngebot(kA(), an.id)).lexware!;
		const r = await setzeAngebotStatus(kA(), an.id, 'angenommen', undefined, 'oberflaeche', { termin: '2' });
		expect(r.hinweis).toMatch(/Baubeginn gewählt/);
		expect(r.hinweis).toMatch(/Lexware: Die Auftragsbestätigung/);
		expect((await root`select to_char(baubeginn, 'YYYY-MM-DD') as b, status from app.auftraege where id = ${u.auftragA}`)[0]).toEqual({ b: morgen(17), status: 'beauftragt' });
		expect(await root`select benutzer_id from app.einsaetze where auftrag_id = ${u.auftragA} and titel = 'Baubeginn (reserviert)'`).toEqual([{ benutzer_id: u.ids.bueroA }]);
		await lauf();
		const ab = posts('/v1/order-confirmations');
		expect(ab).toHaveLength(1);
		expect(ab[0].query.get('precedingSalesVoucherId')).toBe(lx.id);
		expect(ab[0].query.get('finalize')).toBe('true');
		expect(ab[0].body.introduction).toContain(`Angebots ${lx.nummer}`);
		expect(ab[0].body.introduction).toContain('Baubeginn:');
		expect(ab[0].body.shippingConditions.shippingType).toBe('service');
		const [zeile] = await root`select nummer, beleg_quelle, lexware_id::text, versand_status from app.auftragsbestaetigungen where angebot_id = ${an.id}`;
		expect(zeile).toMatchObject({ beleg_quelle: 'lexware', versand_status: 'bereit' });
		expect(zeile.nummer).toMatch(/^AB\d{4}$/);
		expect(await root`select 1 from app.auftragsbestaetigungen where nummer like 'AB-%'`).toHaveLength(0);
		expect(await root`select beschreibung from app.todos where titel = ${`Angebot ${lx.nummer} in Lexware als angenommen markieren`}`).toEqual([
			{ beschreibung: expect.stringContaining(`https://app.lexware.de/permalink/quotations/view/${lx.id}`) }
		]);
	});

	it('Lexware fällt aus: Annahme bleibt gespeichert, die AB wartet und kommt nach; Nachfassen stoppt bei Lexware-Status „angenommen“', async () => {
		const an = await neuesAngebot();
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		await lauf();
		a.stoerung({ status: 503, nurPfad: /^\/v1\/order-confirmations$/ });
		await setzeAngebotStatus(kA(), an.id, 'angenommen');
		await lauf();
		expect((await holeAngebot(kA(), an.id)).status).toBe('angenommen');
		// 5xx beim Anlegen: unklar, ob Lexware schon angelegt hat → „ungewiss“ (vor dem nächsten Versuch erst nachsehen)
		expect((await root`select status from app.lexware_auftraege where art = 'ab_anlegen'`)[0].status).toBe('ungewiss');
		await root`update app.lexware_auftraege set naechster_versuch = now() where art = 'ab_anlegen'`;
		await lauf();
		expect(await root`select 1 from app.auftragsbestaetigungen where angebot_id = ${an.id} and beleg_quelle = 'lexware'`).toHaveLength(1);
		// Lexware meldet „accepted“ (z. B. von Hand) → Spiegel am Angebot
		const lxId = (await holeAngebot(kA(), an.id)).lexware!.id!;
		a.belege.find((b) => b.id === lxId)!.voucherStatus = 'accepted';
		await starteAbgleich(kA());
		await lauf();
		expect((await holeAngebot(kA(), an.id)).lexware?.status).toBe('accepted');
	});

	it('Portal: Lexware-PDF, Annahme ohne Terminwahl → 400, mit Wahl → Nachweis mit Termin; „keiner passt“ → Aufgabe anrufen', async () => {
		await root`delete from app.portal_links`;
		await root`delete from app.portal_dokumente`;
		await root`delete from app.portal_einstellungen`;
		await root`delete from app.kunden_portal`;
		await root`insert into app.portal_einstellungen (betrieb_id, standard) values (${u.betriebA}, 'nur_markierte')`;
		await root`insert into app.kunden_portal (kunde_id, betrieb_id, sichtbar) values (${u.kundeA}, ${u.betriebA}, true)`;
		await speicherePortalEinstellungen(kA(), { agbUrl: 'https://a.test/agb', abAutomatisch: 'ja', standard: 'nur_markierte' });
		const { token } = await erzeugeLink({ k: kA(), sicht: { alle: true, benutzerId: u.ids.chefA }, preise: true }, u.kundeA);
		const an = await neuesAngebot();
		await setzeTerminvorschlaege(kA(), an.id, [{ beginn: morgen(10) }, { beginn: morgen(17) }, { beginn: morgen(24) }]);
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		expect((await ladePortal(token, '203.0.113.9'))!.auftraege.flatMap((x) => x.angebote)).toHaveLength(0);
		await lauf();
		const portal = (await ladePortal(token, '203.0.113.9'))!.auftraege.flatMap((x) => x.angebote);
		expect(portal[0]).toMatchObject({ id: an.id, annehmbar: true });
		expect(portal[0].termine.map((t) => t.beginn)).toEqual([morgen(10), morgen(17), morgen(24)]);
		const pdf = await portalDokument(token, 'angebot', an.id, '203.0.113.9');
		expect(pdf.name).toMatch(/^Angebot_AG\d{4}\.pdf$/);
		portalAktion.leeren();
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true }, '203.0.113.9')).rejects.toMatchObject({ status: 400 });
		await expect(entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, termin: '4' }, '203.0.113.9')).rejects.toMatchObject({ status: 400 });
		const r = await entscheide(token, an.id, { entscheidung: 'angenommen', agb: true, termin: portal[0].termine[0].id }, '203.0.113.9');
		expect(r.status).toBe('angenommen');
		expect((await root`select to_char(termin_beginn, 'YYYY-MM-DD') as t from app.angebot_entscheidungen where angebot_id = ${an.id}`)[0].t).toBe(morgen(10));
		await lauf();
		expect(posts('/v1/order-confirmations').at(-1)!.body.shippingConditions.shippingDate).toContain(morgen(10));
		// zweites Angebot: keiner passt
		const an2 = await neuesAngebot(await u.neuerAuftrag('angebot', 'Terrasse'));
		await setzeTerminvorschlaege(kA(), an2.id, [{ beginn: morgen(30) }]);
		await setzeAngebotStatus(kA(), an2.id, 'versendet');
		await lauf();
		await entscheide(token, an2.id, { entscheidung: 'angenommen', agb: true, termin: 'keiner', terminWunsch: 'lieber im Mai' }, '203.0.113.9');
		expect(await root`select beschreibung from app.todos where titel = 'Kunden anrufen: kein Baubeginn-Termin passt'`).toEqual([{ beschreibung: expect.stringContaining('lieber im Mai') }]);
	});

	it('Sprache: Termine setzen, versenden (Rückfrage mit Warnung), annehmen mit Termin 2, neue Version; Monteur ohne Preisrechte → Hinweis', async () => {
		setzeKiAnbieter(new FakeKi());
		await root`update app.rollen set rechte = array_append(rechte, 'sprache.nutzen') where name = 'Chef' and not ('sprache.nutzen' = any (rechte))`;
		const chef = { ...u.chefA, rechte: [...u.chefA.rechte, 'sprache.nutzen'] };
		const sag = async (text: string, nutzer: Nutzer = chef) => (await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const ja = async (r: any) => (await antwort(await ausfuehrenPost({ locals: { nutzer: chef }, request: jsonAnfrage('POST', { vorschlag: r.vorschlag }) } as never)));
		const an = await neuesAngebot();
		const jahr = Number(berlinTag(new Date()).slice(0, 4)) + 1;
		let r = await sag(`Termine für das Angebot Müller: 1., 8. und 15. März ${jahr}`);
		expect(r.karte.aktion).toBe('terminvorschlaege_setzen');
		expect((await ja(r)).status).toBe(200);
		expect((await holeAngebot(kA(), an.id)).terminvorschlaege.map((t) => t.beginn)).toEqual([`${jahr}-03-01`, `${jahr}-03-08`, `${jahr}-03-15`]);
		r = await sag('Angebot Müller versenden');
		expect(r.karte.aktion).toBe('angebot_versenden');
		expect(r.karte.warnungen.join(' ')).toMatch(/nicht mehr änderbar/);
		expect((await ja(r)).status).toBe(200);
		await lauf();
		r = await sag('Angebot Müller ist angenommen, Termin 2');
		expect(r.karte.zeilen).toContainEqual({ label: 'Baubeginn', wert: `08.03.${jahr}` });
		expect((await ja(r)).status).toBe(200);
		expect((await root`select to_char(baubeginn, 'YYYY-MM-DD') as b from app.auftraege where id = ${u.auftragA}`)[0].b).toBe(`${jahr}-03-08`);
		r = await sag('Neue Version vom Angebot Müller');
		expect(r.karte.aktion).toBe('neue_angebotsversion');
		const neu = await ja(r);
		expect(neu.status).toBe(201);
		const monteur = { ...u.monteurA, rechte: [...u.monteurA.rechte, 'sprache.nutzen'] };
		const m = await sag('Angebot Müller versenden', monteur);
		expect(m.vorschlag).toBeNull();
		setzeKiAnbieter(null);
	});

	it('Hinweise vor dem Versand: § 35a ohne Materialanteil', async () => {
		const an = await legeAngebotAn(kA(), u.auftragA);
		await speichereAngebot(kA(), an.id, { positionen: [{ bezeichnung: 'Frei', menge: '1', einheit: 'Stk', einzelpreis: '10,00' }] });
		expect((await lexwareHinweise(kA(), an.id)).join(' ')).toMatch(/§ 35a.*Position 1/);
	});
});
