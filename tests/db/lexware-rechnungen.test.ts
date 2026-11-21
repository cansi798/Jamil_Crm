import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { setzeLexwareBasisFuerTests } from '../../src/lib/server/lexware/client';
import { _ratenlimitLeeren } from '../../src/lib/server/lexware/ratenlimit';
import { holeClient, speichereLexwareSchluessel } from '../../src/lib/server/lexware/konfig';
import { laufFuerBetrieb } from '../../src/lib/server/lexware/dienst';
import { starteAbgleich } from '../../src/lib/server/lexware/abgleich';
import { rechnungLexwarePaket } from '../../src/lib/server/lexware/export';
import { auftragErneut } from '../../src/lib/server/lexware/warteschlange';
import { legeAngebotAn, setzeAngebotStatus, speichereAngebot } from '../../src/lib/server/angebote';
import {
	erstelleRechnung,
	holeRechnung,
	listeRechnungen,
	markiereRechnungGesendet,
	offeneRechnungen,
	rechnungPdf,
	rechnungsVorschlag,
	setzeMahnPause
} from '../../src/lib/server/lexware/rechnungen';
import { mahnLaeufe, mahnungFreigeben, markiereLaufGesendet, pruefeMahnungen, uebernimmMahnStandard } from '../../src/lib/server/lexware/mahnungen';
import { starteAttrappe, beleg, type Attrappe } from '../hilfe/lexware-attrappe';
import { berlinTag, tagPlus } from '../../src/lib/zeit';
import { antwort, jsonAnfrage } from './hilfe-1c';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/** Rechnungen, Zahlungsstand, Mahnungen über Lexware (Plan Phase 3; Migration 122). */
describe('Lexware: Rechnungen, Zahlungsstand, Mahnungen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let a: Attrappe;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const NACHTS_1UHR = new Date('2026-11-15T00:00:00Z');
	const lauf = async () => laufFuerBetrieb(kA(), { client: await holeClient(kA(), { abstandMs: 0, zeitlimitMs: 300 }), jetzt: NACHTS_1UHR });
	const heute = () => berlinTag(new Date());
	const POS = [
		{ bezeichnung: 'Fliesen verlegen', menge: '10', einheit: 'm²', einzelpreis: '60,00', materialCent: 2000 },
		{ bezeichnung: 'Anfahrt', menge: '1', einheit: 'psch', einzelpreis: '45,00', materialCent: 0 }
	];
	const posts = (pfad: string) => a.anfragen.filter((x) => x.methode === 'POST' && x.pfad === pfad);

	/** Angebot über Lexware versenden und annehmen → Lexware-AB; liefert die AB-ID in Lexware. */
	async function angenommen(): Promise<string> {
		const an = await legeAngebotAn(kA(), u.auftragA);
		await speichereAngebot(kA(), an.id, { positionen: POS });
		await setzeAngebotStatus(kA(), an.id, 'versendet');
		await lauf();
		await setzeAngebotStatus(kA(), an.id, 'angenommen');
		await lauf();
		const [ab] = await root`select lexware_id from app.auftragsbestaetigungen where angebot_id = ${an.id}`;
		return ab.lexware_id;
	}
	const rechnungsId = async () => (await root`select lexware_id from app.rechnungen where auftrag_id = ${u.auftragA} order by angelegt desc limit 1`)[0].lexware_id as string;

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
		a = await starteAttrappe();
		setzeLexwareBasisFuerTests(a.url);
		await root`update app.kunden set email = 'hans@kunde.test' where id = ${u.kundeA}`;
		await speichereLexwareSchluessel(kA(), a.schluessel);
	});
	beforeEach(async () => {
		a.ruhe();
		_ratenlimitLeeren();
		await root`delete from app.nachfass_laeufe where rechnung_id is not null`;
		await root`delete from app.nachfass_stufen where art = 'rechnung'`;
		await root`delete from app.rechnungen`;
		await root`delete from app.lexware_belege`;
		await root`delete from app.lexware_auftraege`;
		await root`delete from app.todos where titel like '%Rechnung%' or titel like '%Mahnung%' or titel like 'Zahlungserinnerung%'`;
		await leereAngebote(root);
		a.belege.length = 0;
		a.verkaufsbelege.clear();
		a.anfragen.length = 0;
		await root`update app.auftraege set status = 'anfrage', baubeginn = null where id = ${u.auftragA}`;
	});
	afterAll(async () => {
		setzeLexwareBasisFuerTests(null);
		await a?.stop();
		await schliesseDb();
		await root?.end();
	});

	it('Vorschlag: ohne angenommenes Angebot bzw. ohne Lexware ein Grund; Betrieb B sieht nichts von A', async () => {
		expect((await rechnungsVorschlag(kA(), u.auftragA)).grund).toMatch(/kein angenommenes Angebot/);
		expect((await rechnungsVorschlag(kB(), u.auftragB)).grund).toMatch(/nur in Lexware/);
		await expect(erstelleRechnung(kA(), u.auftragA, {})).rejects.toMatchObject({ status: 409 });
		await expect(rechnungsVorschlag(kB(), u.auftragA)).rejects.toMatchObject({ status: 404 });
	});

	it('Rechnung aus der AB: Mengen laut Aufmaß → Teilrechnung, precedingSalesVoucherId, Entwurf, Pflichttexte; Doppelklick 409; Festschreiben in Lexware → Aufgabe senden, PDF', async () => {
		const abId = await angenommen();
		const v = await rechnungsVorschlag(kA(), u.auftragA);
		expect(v).toMatchObject({ grund: null, lexware: true, zahlungszielTage: 14, ab: { nummer: expect.stringMatching(/^AB/) } });
		expect(v.positionen.map((p) => p.menge)).toEqual([10, 1]);
		const r = await erstelleRechnung(kA(), u.auftragA, { mengen: ['11,5', '1'], leistungVon: '2026-11-02', leistungBis: '2026-11-13', zahlungszielTage: '10' });
		expect(r.phase).toBe('wartet');
		await expect(erstelleRechnung(kA(), u.auftragA, {})).rejects.toMatchObject({ status: 409 });
		expect((await root`select art from app.rechnungen where id = ${r.id}`)[0].art).toBe('teil');
		await lauf();
		const inv = posts('/v1/invoices');
		expect(inv).toHaveLength(1);
		expect(inv[0].query.get('precedingSalesVoucherId')).toBe(abId);
		expect(inv[0].query.get('finalize')).toBeNull();
		expect(inv[0].body).toMatchObject({ title: 'Teilrechnung', paymentConditions: { paymentTermDuration: 10 }, shippingConditions: { shippingType: 'serviceperiod' } });
		expect(inv[0].body.lineItems[0].quantity).toBe(11.5);
		expect(inv[0].body.remark).toContain('§ 286 Abs. 3 BGB');
		const d1 = await holeRechnung(kA(), r.id, true);
		expect(d1).toMatchObject({ status: 'entwurf', nummer: null, art: 'teil' });
		expect(await root`select 1 from app.todos where titel like 'Rechnung in Lexware prüfen und festschreiben%' and erledigt_am is null`).toHaveLength(1);
		await expect(rechnungPdf(kA(), r.id)).rejects.toMatchObject({ status: 409 });
		// Jamil schreibt in Lexware fest → Abgleich (Rückmeldung) → Nummer, Aufgabe „senden“
		a.festschreiben(await rechnungsId());
		await starteAbgleich(kA());
		await lauf();
		const d2 = await holeRechnung(kA(), r.id, true);
		expect(d2.nummer).toMatch(/^RE\d{4}$/);
		expect(d2.status).toBe('offen');
		expect(await root`select 1 from app.todos where titel like 'Rechnung in Lexware prüfen%' and erledigt_am is null`).toHaveLength(0);
		expect(await root`select 1 from app.todos where titel = ${`Rechnung ${d2.nummer} an den Kunden senden`} and erledigt_am is null`).toHaveLength(1);
		const pdf = await rechnungPdf(kA(), r.id);
		expect(pdf.name).toBe(`Rechnung_${d2.nummer}.pdf`);
		await markiereRechnungGesendet(kA(), r.id);
		expect(await root`select 1 from app.todos where titel = ${`Rechnung ${d2.nummer} an den Kunden senden`} and erledigt_am is null`).toHaveLength(0);
		// Mandantentrennung
		await expect(holeRechnung(kB(), r.id, true)).rejects.toMatchObject({ status: 404 });
		expect(await listeRechnungen(kB(), { preise: true })).toEqual([]);
		// Monteur-Sicht: ohne Preise keine Beträge
		expect((await holeRechnung(kA(), r.id, false)).bruttoCent).toBeNull();
	});

	it('„gleich festschreiben“ → finalize=true, PDF sofort; Zeitüberschreitung → ungewiss → Belegliste findet die Rechnung, keine zweite', async () => {
		await angenommen();
		const r = await erstelleRechnung(kA(), u.auftragA, { festschreiben: 'ja' });
		a.stoerung({ verzoegerungMs: 700, trotzdemAusfuehren: true, nurPfad: /^\/v1\/invoices$/ });
		await lauf();
		expect((await root`select status from app.lexware_auftraege where art = 'rechnung_anlegen'`)[0].status).toBe('ungewiss');
		await root`update app.lexware_auftraege set naechster_versuch = now() where art = 'rechnung_anlegen'`;
		await lauf();
		expect(posts('/v1/invoices')).toHaveLength(1);
		expect(posts('/v1/invoices')[0].query.get('finalize')).toBe('true');
		const d = await holeRechnung(kA(), r.id, true);
		expect(d).toMatchObject({ art: 'rechnung', status: 'offen', pdf: true });
	});

	it('Zahlungsstand: Teilzahlung → teilweise bezahlt (Zahlungen gespiegelt), Rest → bezahlt; Liste/Kachel offen und überfällig', async () => {
		await angenommen();
		const r = await erstelleRechnung(kA(), u.auftragA, { festschreiben: true });
		await lauf();
		const lx = await rechnungsId();
		a.bezahle(lx, 100, '2026-11-25');
		await starteAbgleich(kA());
		await lauf();
		await lauf();
		const d = await holeRechnung(kA(), r.id, true);
		expect(d.status).toBe('teilbezahlt');
		expect(d.zahlungen).toEqual([{ art: 'manualPayment', datum: '2026-11-25', cent: 10000 }]);
		expect((await listeRechnungen(kA(), { preise: true, filter: 'offen' })).map((x) => x.id)).toEqual([r.id]);
		const kz = await offeneRechnungen(kA());
		expect(kz).toMatchObject({ anzahl: 1, teilbezahlt: 1, offenCent: d.offenCent });
		// nach der Fälligkeit: überfällig (ohne dass Lexware schon „overdue“ meldet)
		expect((await offeneRechnungen(kA(), tagPlus(heute(), 30))).ueberfaellig).toBe(1);
		a.bezahle(lx, d.offenCent! / 100, '2026-11-30');
		await root`delete from app.lexware_auftraege where art = 'belege_abgleichen'`; // „höchstens einmal je Minute“
		await starteAbgleich(kA());
		await lauf();
		await lauf();
		const fertig = await holeRechnung(kA(), r.id, true);
		expect(fertig).toMatchObject({ status: 'bezahlt', bezahltAm: '2026-11-30', offenCent: 0 });
	});

	it('Mahnungen: Erinnerung → 1. Mahnung per Lexware (Vorgänger, PDF) → 3. Mahnung nur nach Freigabe; Pause; Stopp bei Zahlung', async () => {
		await uebernimmMahnStandard(kA());
		await expect(uebernimmMahnStandard(kA())).rejects.toMatchObject({ status: 409 });
		await root`update app.kunden set art = 'firma', firma = 'Hans GmbH' where id = ${u.kundeA}`;
		try {
			await angenommen();
			const r = await erstelleRechnung(kA(), u.auftragA, { festschreiben: true });
			await lauf();
			const lx = await rechnungsId();
			const faellig = (await root`select to_char(faellig, 'YYYY-MM-DD') as f from app.lexware_belege where lexware_id = ${lx}`)[0].f as string;
			expect(await pruefeMahnungen(kA(), faellig)).toBe(0); // am Fälligkeitstag noch nichts
			expect(await pruefeMahnungen(kA(), tagPlus(faellig, 4))).toBe(1);
			expect(await pruefeMahnungen(kA(), tagPlus(faellig, 4))).toBe(0); // je Stufe genau einmal
			let l = await mahnLaeufe(kA(), r.id);
			expect(l[0]).toMatchObject({ stufe: 0, status: 'bereit', mailAn: 'hans@kunde.test' });
			expect(l[0].mailBetreff).toBe('Zahlungserinnerung');
			await markiereLaufGesendet(kA(), l[0].id);
			// Pause bis … → keine neue Stufe
			await setzeMahnPause(kA(), r.id, tagPlus(faellig, 20));
			expect(await pruefeMahnungen(kA(), tagPlus(faellig, 18))).toBe(0);
			await setzeMahnPause(kA(), r.id, null);
			expect(await pruefeMahnungen(kA(), tagPlus(faellig, 18))).toBe(1);
			await lauf();
			await lauf();
			const d = posts('/v1/dunnings');
			expect(d).toHaveLength(1);
			expect(d[0].query.get('precedingSalesVoucherId')).toBe(lx);
			expect(d[0].body).toMatchObject({ title: '1. Mahnung', taxConditions: { taxType: 'net' } });
			l = await mahnLaeufe(kA(), r.id);
			expect(l[1]).toMatchObject({ stufe: 1, status: 'bereit', pdf: true });
			// +61: Stufe 3 (mit Freigabe, Firma → Pauschale, Zinshinweis) → wartet auf Freigabe, noch keine Lexware-Mahnung
			expect(await pruefeMahnungen(kA(), tagPlus(faellig, 61))).toBe(1);
			l = await mahnLaeufe(kA(), r.id);
			expect(l[2]).toMatchObject({ stufe: 3, status: 'freigabe', gebuehrCent: 4000 });
			expect(l[2].zinsenCent).toBeGreaterThan(0);
			await lauf();
			expect(posts('/v1/dunnings')).toHaveLength(1);
			await mahnungFreigeben(kA(), l[2].id);
			await expect(mahnungFreigeben(kA(), l[2].id)).rejects.toMatchObject({ status: 409 });
			// Kunde zahlt, bevor die Mahnung angelegt ist → keine zweite Lexware-Mahnung, Lauf gestoppt, Aufgabe erledigt
			a.bezahle(lx, 9999999 / 100);
			await lauf();
			expect(posts('/v1/dunnings')).toHaveLength(1);
			l = await mahnLaeufe(kA(), r.id);
			expect(l[2].status).toBe('gestoppt');
			expect(l[2].todoErledigt).toBe(true);
			// Betrieb B sieht keine Läufe von A
			expect(await mahnLaeufe(kB(), r.id)).toEqual([]);
		} finally {
			await root`update app.kunden set art = 'privat' where id = ${u.kundeA}`;
		}
	});

	it('Abschlag: vorbereitet (30 %) → in Lexware angelegt → Abgleich ordnet zu; Schluss = Gesamt − Abschlag', async () => {
		await angenommen();
		const v = await rechnungsVorschlag(kA(), u.auftragA);
		const r = await erstelleRechnung(kA(), u.auftragA, { art: 'abschlag', abschlagProzent: '30' });
		expect(r.phase).toBe('vorbereitet');
		const brutto = Math.round(v.gesamtBruttoCent * 0.3);
		expect((await root`select brutto_cent from app.rechnungen where id = ${r.id}`)[0].brutto_cent).toBe(String(brutto));
		expect(posts('/v1/invoices')).toHaveLength(0);
		await expect(erstelleRechnung(kA(), u.auftragA, { art: 'schluss' })).rejects.toMatchObject({ status: 409 });
		// Jamil legt die Abschlagsrechnung in Lexware an (API kann das nicht)
		const kontakt = (await root`select lexware_id from app.kunden where id = ${u.kundeA}`)[0].lexware_id;
		const t = new Date().toISOString();
		a.belege.push(beleg({ voucherType: 'downpaymentinvoice', voucherNumber: 'AR0001', contactId: kontakt, totalAmount: brutto / 100, openAmount: brutto / 100, createdDate: t, updatedDate: t }));
		await starteAbgleich(kA());
		await lauf();
		const d = await holeRechnung(kA(), r.id, true);
		expect(d).toMatchObject({ art: 'abschlag', nummer: 'AR0001', status: expect.stringMatching(/offen|ueberfaellig/) });
		const s = await erstelleRechnung(kA(), u.auftragA, { art: 'schluss' });
		expect((await root`select brutto_cent from app.rechnungen where id = ${s.id}`)[0].brutto_cent).toBe(String(v.gesamtBruttoCent - brutto));
	});

	it('Mahnung: Serverfehler → unklar → „Erneut versuchen“ von Hand legt die Mahnung wirklich an (Prüfbericht 21.11.2026)', async () => {
		await uebernimmMahnStandard(kA()).catch(() => undefined);
		await angenommen();
		const r = await erstelleRechnung(kA(), u.auftragA, { festschreiben: true });
		await lauf();
		const lx = await rechnungsId();
		const faellig = (await root`select to_char(faellig, 'YYYY-MM-DD') as f from app.lexware_belege where lexware_id = ${lx}`)[0].f as string;
		expect(await pruefeMahnungen(kA(), tagPlus(faellig, 4))).toBe(1);
		await markiereLaufGesendet(kA(), (await mahnLaeufe(kA(), r.id))[0].id);
		expect(await pruefeMahnungen(kA(), tagPlus(faellig, 18))).toBe(1);
		// 503 beim Anlegen (Lexware hat nichts angelegt) → ungewiss → nicht suchbar → „prüfen“, Lauf im Fehler
		a.stoerung({ status: 503, nurPfad: /^\/v1\/dunnings$/ });
		await lauf();
		await root`update app.lexware_auftraege set naechster_versuch = now() where art = 'mahnung_anlegen'`;
		await lauf();
		const [j] = await root`select id, status from app.lexware_auftraege where art = 'mahnung_anlegen'`;
		expect(j.status).toBe('pruefen');
		expect((await mahnLaeufe(kA(), r.id))[1].status).toBe('fehler');
		expect(posts('/v1/dunnings').filter((x) => x.query.get('precedingSalesVoucherId') === lx)).toHaveLength(1);
		// Büro hat in Lexware nachgesehen: keine Mahnung da → „Erneut versuchen“
		await auftragErneut(kA(), j.id);
		await lauf();
		await lauf();
		expect((await root`select status from app.lexware_auftraege where id = ${j.id}`)[0].status).toBe('erledigt');
		expect(posts('/v1/dunnings').filter((x) => x.query.get('precedingSalesVoucherId') === lx)).toHaveLength(2);
		expect((await mahnLaeufe(kA(), r.id))[1]).toMatchObject({ stufe: 1, status: 'bereit' });
	});

	it('Abschlag als Bruttobetrag (taxType gross): Lexware-Attrappe rechnet genau 300,04 € – über Netto wären es 300,03 €', async () => {
		await angenommen();
		const r = await erstelleRechnung(kA(), u.auftragA, { art: 'abschlag', abschlagBetrag: '300,04' });
		const [z] = await root`select brutto_cent, positionen from app.rechnungen where id = ${r.id}`;
		expect(Number(z.brutto_cent)).toBe(30004);
		expect(z.positionen[0]).toMatchObject({ einzelpreisBruttoCent: 30004, einzelpreisCent: 25213 });
		const paket = await rechnungLexwarePaket(kA(), r.id);
		const body = paket.beleg.body as any;
		expect(body.taxConditions.taxType).toBe('gross');
		expect(body.title).toBe('Abschlagsrechnung');
		expect(body.lineItems[0].unitPrice).toEqual({ currency: 'EUR', grossAmount: 300.04, taxRatePercentage: 19 });
		expect(paket.hinweise.join(' ')).toMatch(/BRUTTO/);
		// gegen die Attrappe (nie echtes Lexware): Brutto bleibt auf den Cent, Netto-Weg weicht um 1 ct ab
		const sende = async (b: unknown) => {
			const res = await fetch(`${a.url}/v1/invoices`, { method: 'POST', headers: { authorization: `Bearer ${a.schluessel}`, 'content-type': 'application/json' }, body: JSON.stringify(b) });
			const { id } = (await res.json()) as { id: string };
			return a.verkaufsbelege.get(id)!.totalPrice.totalGrossAmount as number;
		};
		expect(await sende(body)).toBe(300.04);
		const netto = { ...body, taxConditions: { taxType: 'net' }, lineItems: [{ ...body.lineItems[0], unitPrice: { currency: 'EUR', netAmount: 252.13, taxRatePercentage: 19 } }] };
		expect(await sende(netto)).toBe(300.03);
		// Lexware-Abschlag mit genau diesem Betrag → Abgleich ordnet zu
		const kontakt = (await root`select lexware_id from app.kunden where id = ${u.kundeA}`)[0].lexware_id;
		const t = new Date().toISOString();
		a.belege.push(beleg({ voucherType: 'downpaymentinvoice', voucherNumber: 'AR0777', contactId: kontakt, totalAmount: 300.04, openAmount: 300.04, createdDate: t, updatedDate: t }));
		await starteAbgleich(kA());
		await lauf();
		expect((await holeRechnung(kA(), r.id, true))).toMatchObject({ art: 'abschlag', nummer: 'AR0777' });
	});

	it('Sprache: Rechnung erstellen (Rückfrage), offene Rechnungen, hat bezahlt?, Mahnung pausieren; Monteur ohne Rechte → kein Vorschlag', async () => {
		setzeKiAnbieter(new FakeKi());
		const extra = ['sprache.nutzen', 'rechnungen.sehen', 'rechnungen.erstellen', 'mahnungen.verwalten'];
		const chef = { ...u.chefA, rechte: [...new Set([...u.chefA.rechte, ...extra])] };
		const sag = async (text: string, nutzer: Nutzer = chef) => (await antwort(await textPost({ locals: { nutzer }, request: jsonAnfrage('POST', { text }) } as never))).koerper;
		const ja = async (r: any) => await antwort(await ausfuehrenPost({ locals: { nutzer: chef }, request: jsonAnfrage('POST', { vorschlag: r.vorschlag }) } as never));
		try {
			await angenommen();
			const titel = (await root`select titel from app.auftraege where id = ${u.auftragA}`)[0].titel as string;
			let r = await sag(`Rechnung zu Auftrag ${titel} erstellen`);
			expect(r.karte.aktion).toBe('rechnung_erstellen');
			expect(r.karte.fehler).toBeNull();
			expect(r.karte.warnungen.join(' ')).toMatch(/Entwurf in Lexware/);
			const e = await ja(r);
			expect(e.status).toBe(201);
			expect(await root`select 1 from app.rechnungen where auftrag_id = ${u.auftragA}`).toHaveLength(1);
			await lauf();
			a.festschreiben(await rechnungsId());
			await starteAbgleich(kA());
			await lauf();
			const kunde = (await root`select nachname from app.kunden where id = ${u.kundeA}`)[0].nachname as string;
			r = await sag('Welche Rechnungen sind offen?');
			expect(r.karte.aktion).toBe('abfrage_offene_rechnungen');
			expect(r.vorschlag).toBeNull();
			expect(r.karte.antwort.vorlesen).toMatch(/^1 offene Rechnung/);
			r = await sag(`Hat Kunde ${kunde} bezahlt?`);
			expect(r.karte.antwort.vorlesen).toMatch(/^Nein, bei .* ist eine Rechnung offen/);
			r = await sag(`Keine Mahnung an ${kunde} bis Monatsende`);
			expect(r.karte.aktion).toBe('mahnung_pausieren');
			expect((await ja(r)).status).toBe(200);
			expect((await root`select mahnen_pausiert_bis from app.rechnungen where auftrag_id = ${u.auftragA}`)[0].mahnen_pausiert_bis).not.toBeNull();
			const monteur = { ...u.monteurA, rechte: [...u.monteurA.rechte, 'sprache.nutzen'] };
			const m = await sag('Welche Rechnungen sind überfällig?', monteur);
			expect(m.vorschlag).toBeNull();
			expect(m.karte.fehler).toBeTruthy();
			expect((await sag(`Rechnung zu Auftrag ${titel} erstellen`, monteur)).vorschlag).toBeNull();
		} finally {
			setzeKiAnbieter(null);
		}
	});
});
