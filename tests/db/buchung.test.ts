import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import {
	aendereDienst,
	aendereLink,
	buchungenZumAuftrag,
	buchungZugriff,
	holeDienst,
	legeAusnahmeAn,
	legeDienstAn,
	legeMitarbeiterLinkAn,
	listeDienste,
	speichereArbeitszeiten,
	speichereEinstellungen
} from '../../src/lib/server/buchung';
import { bucheTermin, freieTermine, ladeSeite, ladeVerwaltung, sageAb, termineZumVerschieben, verschiebe } from '../../src/lib/server/buchung-oeffentlich';
import { benachrichtigungen } from '../../src/lib/server/erinnerungen';
import { POST as textPost } from '../../src/routes/api/sprache/text/+server';
import { POST as ausfuehrenPost } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { berlinTag, berlinZeitpunkt, tagPlus } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, type Umgebung } from './hilfe-1c';

/** Online-Buchung (Jamil msgs 2684/2686): Dienste, freie Zeiten, öffentliche Buchung, RLS, Sprache. */
describe('Online-Buchung', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	// Feste „Jetzt“-Zeit: morgen 05:00 Berlin; gebucht wird übermorgen
	const morgen = tagPlus(berlinTag(new Date()), 1);
	const tag = tagPlus(morgen, 1);
	const JETZT = berlinZeitpunkt(morgen, 5, 0);
	const um = (h: number, m = 0) => berlinZeitpunkt(tag, h, m).toISOString();
	const ALLE_TAGE = [0, 1, 2, 3, 4, 5, 6].map((wochentag) => ({ wochentag, von: '08:00', bis: '18:00' }));
	let besichtigung: Awaited<ReturnType<typeof legeDienstAn>>;
	let beratung: Awaited<ReturnType<typeof legeDienstAn>>;
	const standardLink = (d: typeof besichtigung) => d.links.find((l) => !l.benutzerId)!.token;
	let nr = 0;
	const kontakt = (extra: Record<string, unknown> = {}) => ({
		vorname: 'Anna',
		nachname: `Bucher${++nr}`,
		email: `anna${nr}@beispiel.test`,
		telefon: `040 55500${nr}`,
		strasse: 'Lindenweg 9',
		plz: '22846',
		ort: 'Norderstedt',
		...extra
	});
	const buche = (token: string, beginn: string, extra: Partial<Parameters<typeof bucheTermin>[1]> = {}) =>
		bucheTermin(token, { beginn, kontakt: kontakt(), antworten: { art: 'Bad' }, datenschutz: true, fotos: [], ...extra }, { jetzt: JETZT });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-sprache-0123456789abcdef';
		setzeKiAnbieter(new FakeKi());
		const fragen = {
			seiten: [
				{
					id: 's1',
					titel: 'Fragen',
					abschnitte: [
						{
							id: 'a1',
							felder: [
								{ id: 'art', typ: 'auswahl', label: 'Worum geht es?', optionen: ['Bad', 'Küche'], pflicht: true },
								{ id: 'dusche', typ: 'janein', label: 'Dusche?', bedingung: { feld: 'art', op: 'gleich', wert: 'Bad', wirkung: 'zeigen' } }
							]
						}
					]
				}
			]
		};
		besichtigung = await legeDienstAn(kA(), { name: 'Besichtigung', dauerMin: 60, vorlaufMin: 0, modus: 'fest', fragen }, [u.ids.monteurA]);
		beratung = await legeDienstAn(kA(), { name: 'Beratung', dauerMin: 30, vorlaufMin: 0, pufferNachMin: 30, modus: 'beliebig', fragen }, [u.ids.monteurA, u.ids.bueroA]);
		await speichereArbeitszeiten(kA(), u.ids.monteurA, null, ALLE_TAGE);
		await speichereArbeitszeiten(kA(), u.ids.bueroA, null, ALLE_TAGE);
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Recht „buchung.verwalten“: Chef ja, Büro und Monteur nein; Standard-Link je Dienst', async () => {
		await expect(buchungZugriff({ nutzer: u.chefA })).resolves.toBeUndefined();
		await expect(buchungZugriff({ nutzer: u.bueroA })).rejects.toMatchObject({ status: 403 });
		await expect(buchungZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		expect(besichtigung.links).toHaveLength(1);
		expect(standardLink(besichtigung)).toMatch(/^[A-Za-z0-9_-]{32}$/);
		await expect(legeDienstAn(kA(), { name: 'besichtigung ' })).rejects.toMatchObject({ status: 409 });
		await expect(legeDienstAn(kA(), { name: 'Zwei feste', modus: 'fest' }, [u.ids.monteurA, u.ids.bueroA])).rejects.toMatchObject({ status: 400 });
	});

	it('RLS: Betrieb B sieht nichts von A; ohne Kontext nichts; crm_auth hat keinen Tabellenzugriff', async () => {
		expect(await listeDienste(kB())).toEqual([]);
		await expect(holeDienst(kB(), besichtigung.id)).rejects.toMatchObject({ status: 404 });
		await expect(legeMitarbeiterLinkAn(kB(), besichtigung.id, u.ids.monteurA)).rejects.toMatchObject({ status: 400 });
		const app = postgres(u.db.urlApp, { max: 1, onnotice: () => {} });
		try {
			for (const t of ['buchung_dienste', 'buchung_links', 'buchung_zeiten', 'buchungen', 'buchung_einstellungen']) {
				const [z] = await app.unsafe(`select count(*)::int as n from app.${t}`);
				expect(z.n, t).toBe(0);
			}
		} finally {
			await app.end();
		}
		await expect(systemAbfrage((sql) => sql`select * from app.buchung_dienste`)).rejects.toThrow(/permission denied/);
	});

	it('Öffentliche Seite: nur Dienst, Betrieb und Vorname bei festem Mitarbeiter; keine IDs', async () => {
		const s = await ladeSeite(standardLink(besichtigung));
		expect(s).not.toBeNull();
		expect(s!.dienst).toMatchObject({ name: 'Besichtigung', dauerMin: 60, ortArt: 'kunde' });
		expect(s!.mitarbeiterVorname).toBe('Ali');
		const json = JSON.stringify(s);
		for (const id of [u.ids.monteurA, u.betriebA, besichtigung.id]) expect(json).not.toContain(id);
		expect(json).not.toContain('Monteur'); // nur Vorname
		expect(await ladeSeite('x'.repeat(32))).toBeNull();
		expect(await ladeSeite('kurz')).toBeNull();
	});

	it('Buchen: Kunde, Objekt, Auftrag „Anfrage“ mit Auftragsquelle Online-Buchung, Einsatz, Antworten, Glocke', async () => {
		const zeiten = await freieTermine(standardLink(besichtigung), tag, JETZT);
		expect(zeiten!.tage[0].zeiten.map((z) => z.beginn)).toContain(um(9));
		expect(JSON.stringify(zeiten)).not.toContain(u.ids.monteurA);
		const r = await buche(standardLink(besichtigung), um(9), { antworten: { art: 'Bad', dusche: true, boese: 'x' } });
		expect(r.beginn).toBe(um(9));
		const [b] = await root`select * from app.buchungen where verwaltung_hash = digest(${r.verwaltungToken}, 'sha256')`.catch(async () =>
			root`select * from app.buchungen order by angelegt desc limit 1`
		);
		expect(b).toMatchObject({ status: 'aktiv', benutzer_id: u.ids.monteurA });
		expect(b.antworten).toEqual({ art: 'Bad', dusche: true });
		const [a] = await root`select a.status, a.titel, q.name as quelle from app.auftraege a join app.auftrag_quellen q on q.id = a.quelle_id where a.id = ${b.auftrag_id}`;
		expect(a).toMatchObject({ status: 'anfrage', quelle: 'Online-Buchung' });
		expect(a.titel).toMatch(/^Besichtigung – Anna Bucher/);
		const [e] = await root`select benutzer_id, art, beginn from app.einsaetze where id = ${b.einsatz_id}`;
		expect(e).toMatchObject({ benutzer_id: u.ids.monteurA, art: 'besichtigung' });
		const [k] = await root`select nachname, email from app.kunden where id = ${b.kunde_id}`;
		expect(k.email).toBe(b.email);
		const [o] = await root`select strasse from app.objekte where id = ${b.objekt_id}`;
		expect(o.strasse).toBe('Lindenweg 9');
		const [z] = await root`select 1 from app.auftrag_zustaendige where auftrag_id = ${b.auftrag_id} and benutzer_id = ${u.ids.monteurA}`;
		expect(z).toBeTruthy();
		// Glocke für Mitarbeiter und Chef
		const glockeMonteur = await benachrichtigungen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA });
		expect(glockeMonteur.liste[0].titel).toBe('Neue Online-Buchung: Besichtigung');
		expect((await benachrichtigungen(kA())).liste[0].link).toBe(`/auftraege/${b.auftrag_id}`);
		// lesbar wie ein Protokoll am Auftrag
		const am = await buchungenZumAuftrag(kA(), b.auftrag_id);
		expect(am[0].antworten).toEqual([
			{ id: 'art', label: 'Worum geht es?', text: 'Bad', fotos: [], hinweis: false },
			{ id: 'dusche', label: 'Dusche?', text: 'Ja', fotos: [], hinweis: false }
		]);
		// Änderungsprotokoll: ohne Benutzer, Quelle online-buchung, nie das Token
		const [p] = await root`select benutzer_id, quelle, nachher from app.aenderungen where tabelle = 'buchungen' and datensatz_id = ${b.id}`;
		expect(p).toMatchObject({ benutzer_id: null, quelle: 'online-buchung' });
		expect(p.nachher).not.toHaveProperty('verwaltung_hash');
	});

	it('Gleicher Termin ein zweites Mal → 409; Datenbank verbietet Überschneidung auch direkt', async () => {
		await buche(standardLink(besichtigung), um(11));
		await expect(buche(standardLink(besichtigung), um(11))).rejects.toMatchObject({ status: 409 });
		await expect(buche(standardLink(besichtigung), um(11, 30))).rejects.toMatchObject({ status: 409 });
		const [b] = await root`select * from app.buchungen where beginn = ${um(11)}`;
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
				insert into app.buchungen (betrieb_id, dienst_id, benutzer_id, beginn, ende, nachname, verwaltung_hash)
				values (${u.betriebA}, ${b.dienst_id}, ${b.benutzer_id}, ${um(11, 30)}, ${um(12, 30)}, 'X', ${Buffer.alloc(32, 7)})`)
		).rejects.toMatchObject({ code: '23P01' });
	});

	it('Gleichzeitig dieselbe Zeit: genau eine Buchung gewinnt', async () => {
		const ergebnisse = await Promise.allSettled([buche(standardLink(besichtigung), um(14)), buche(standardLink(besichtigung), um(14))]);
		expect(ergebnisse.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
		expect(ergebnisse.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason.status)).toEqual([409]);
	});

	it('Einsatz in der Plantafel, Abwesenheit und Ausnahme sperren Zeiten', async () => {
		const tok = standardLink(besichtigung);
		await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values (${u.betriebA}, ${u.auftragA}, ${u.ids.monteurA}, ${um(16)}, ${um(17)})`);
		const z = (await freieTermine(tok, tag, JETZT))!.tage.find((t) => t.tag === tag)!.zeiten.map((x) => x.beginn);
		expect(z).not.toContain(um(16));
		expect(z).not.toContain(um(15, 30));
		expect(z).toContain(um(17));
		await legeAusnahmeAn(kA(), u.ids.monteurA, { tag, art: 'frei', von: '17:00', bis: '18:00' });
		const z2 = (await freieTermine(tok, tag, JETZT))!.tage.find((t) => t.tag === tag)!.zeiten.map((x) => x.beginn);
		expect(z2).not.toContain(um(17));
		const naechster = tagPlus(tag, 1);
		await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
			insert into app.abwesenheiten (betrieb_id, benutzer_id, art, von, bis) values (${u.betriebA}, ${u.ids.monteurA}, 'urlaub', ${naechster}, ${naechster})`);
		const t3 = await freieTermine(tok, naechster, JETZT);
		expect(t3!.tage.find((t) => t.tag === naechster)).toBeUndefined();
		await expect(buche(tok, berlinZeitpunkt(naechster, 9).toISOString())).rejects.toMatchObject({ status: 409 });
	});

	it('Link für Mitarbeiter A liefert nie Mitarbeiter B; Standard-Link verteilt abwechselnd', async () => {
		const linkA = await legeMitarbeiterLinkAn(kA(), beratung.id, u.ids.bueroA);
		const seite = await ladeSeite(linkA.token);
		expect(seite!.mitarbeiterVorname).toBe('Büro');
		const tag2 = tagPlus(tag, 3);
		for (const h of [8, 9, 10]) {
			await bucheTermin(linkA.token, { beginn: berlinZeitpunkt(tag2, h).toISOString(), kontakt: kontakt(), antworten: { art: 'Küche' }, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		}
		const nurA = await root`select distinct benutzer_id from app.buchungen where link_id = ${linkA.id}`;
		expect(nurA.map((r) => r.benutzer_id)).toEqual([u.ids.bueroA]);
		// Büro ist um 8 belegt → Standard-Link (beide) gibt den Monteur
		const r = await bucheTermin(standardLink(beratung), { beginn: berlinZeitpunkt(tag2, 8).toISOString(), kontakt: kontakt(), antworten: { art: 'Bad' }, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		const [b] = await root`select benutzer_id from app.buchungen where beginn = ${r.beginn} and link_id <> ${linkA.id}`;
		expect(b.benutzer_id).toBe(u.ids.monteurA);
		// Puffer danach (30 Min.): Büro um 10:00–10:30 + Puffer → 10:30 und 11:00 nicht für Büro, aber Monteur frei
		const zeiten = (await freieTermine(linkA.token, tag2, JETZT))!.tage.find((t) => t.tag === tag2)!.zeiten.map((x) => x.beginn);
		expect(zeiten).not.toContain(berlinZeitpunkt(tag2, 10, 30).toISOString());
		expect(zeiten).toContain(berlinZeitpunkt(tag2, 11).toISOString());
		// Link aus → 404
		await aendereLink(kA(), linkA.id, { aktiv: false });
		expect(await ladeSeite(linkA.token)).toBeNull();
		await expect(bucheTermin(linkA.token, { beginn: berlinZeitpunkt(tag2, 12).toISOString(), kontakt: kontakt(), antworten: { art: 'Bad' }, datenschutz: true, fotos: [] }, { jetzt: JETZT })).rejects.toMatchObject({ status: 404 });
	});

	it('Strenge Prüfung: Datenschutz, Kontakt, Pflichtfragen, Zeit außerhalb', async () => {
		const tok = standardLink(besichtigung);
		await expect(buche(tok, um(12), { datenschutz: false })).rejects.toMatchObject({ status: 400 });
		await expect(buche(tok, um(12), { kontakt: kontakt({ email: 'kaputt' }) })).rejects.toMatchObject({ status: 400, extra: { felder: { email: expect.any(String) } } });
		await expect(buche(tok, um(12), { antworten: {} })).rejects.toMatchObject({ status: 400 });
		await expect(buche(tok, berlinZeitpunkt(tag, 3).toISOString())).rejects.toMatchObject({ status: 409 });
		await expect(buche(tok, 'morgen')).rejects.toMatchObject({ status: 400 });
	});

	it('Vorhandener Kunde wird per E-Mail erkannt (kein Duplikat)', async () => {
		const vorher = (await root`select count(*)::int as n from app.kunden where betrieb_id = ${u.betriebA}`)[0].n;
		const k = kontakt({ email: 'hans@vorhanden.test' });
		await root`update app.kunden set email = 'hans@vorhanden.test' where id = ${u.kundeA}`;
		await bucheTermin(standardLink(besichtigung), { beginn: um(12), kontakt: k, antworten: { art: 'Bad' }, datenschutz: true, fotos: [] }, { jetzt: JETZT });
		const nachher = (await root`select count(*)::int as n from app.kunden where betrieb_id = ${u.betriebA}`)[0].n;
		expect(nachher).toBe(vorher);
		const [b] = await root`select kunde_id from app.buchungen where beginn = ${um(12)}`;
		expect(b.kunde_id).toBe(u.kundeA);
	});

	it('Verwalten: verschieben (nur auf freie Zeit), absagen → Termin weg, To-do + Glocke', async () => {
		const r = await buche(standardLink(besichtigung), um(13));
		const v = await ladeVerwaltung(r.verwaltungToken, JETZT);
		expect(v).toMatchObject({ status: 'aktiv', aenderbar: true, mitarbeiterVorname: 'Ali' });
		const zum = await termineZumVerschieben(r.verwaltungToken, tag, JETZT);
		// eigene Zeit zählt beim Verschieben nicht als belegt
		expect(zum!.tage.find((t) => t.tag === tag)!.zeiten.map((z) => z.beginn)).toContain(um(15));
		await expect(verschiebe(r.verwaltungToken, um(9), JETZT)).rejects.toMatchObject({ status: 409 });
		const neu = await verschiebe(r.verwaltungToken, um(15), JETZT);
		expect(neu.beginn).toBe(um(15));
		const [b] = await root`select * from app.buchungen where beginn = ${um(15)}`;
		const [e] = await root`select beginn from app.einsaetze where id = ${b.einsatz_id}`;
		expect(new Date(e.beginn).toISOString()).toBe(um(15));
		await sageAb(r.verwaltungToken, JETZT);
		const [b2] = await root`select status, einsatz_id from app.buchungen where id = ${b.id}`;
		expect(b2).toMatchObject({ status: 'storniert', einsatz_id: null });
		const [t] = await root`select titel, zustaendig_id from app.todos where auftrag_id = ${b.auftrag_id}`;
		expect(t.titel).toMatch(/^Online-Buchung abgesagt/);
		await expect(sageAb(r.verwaltungToken, JETZT)).rejects.toMatchObject({ status: 409 });
		expect((await benachrichtigungen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA })).liste[0].titel).toBe('Online-Buchung abgesagt: Besichtigung');
		expect(await ladeVerwaltung('A'.repeat(43))).toBeNull();
	});

	it('Ausgeschalteter Dienst und gesperrter Betrieb: Link ungültig', async () => {
		await aendereDienst(kA(), besichtigung.id, { aktiv: false });
		expect(await ladeSeite(standardLink(besichtigung))).toBeNull();
		await aendereDienst(kA(), besichtigung.id, { aktiv: true });
		expect(await ladeSeite(standardLink(besichtigung))).not.toBeNull();
		await root`update app.betriebe set abo_status = 'gesperrt' where id = ${u.betriebA}`;
		try {
			expect(await ladeSeite(standardLink(besichtigung))).toBeNull();
		} finally {
			await root`update app.betriebe set abo_status = 'aktiv' where id = ${u.betriebA}`;
		}
	});

	it('Einstellungen: Domains streng geprüft; Datenbank lehnt unsaubere Einträge ab', async () => {
		const e = await speichereEinstellungen(kA(), { datenschutzUrl: 'https://bauwelt.test/datenschutz', einbettenDomains: 'www.bauwelt.test' });
		expect(e.einbettenDomains).toEqual(['https://www.bauwelt.test']);
		expect((await ladeSeite(standardLink(besichtigung)))!.einbetten).toEqual(['https://www.bauwelt.test']);
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.buchung_einstellungen set einbetten_domains = ${["https://a.de 'unsafe-inline'"]} where betrieb_id = ${u.betriebA}`)
		).rejects.toThrow(/check/);
	});

	it('Sprache: „Neuer Dienst Besichtigungstermin 60 Minuten für Ali“ und „Buchungslink für Besichtigung“', async () => {
		const k = await antwort(await textPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { text: 'Neuer Dienst Besichtigungstermin 60 Minuten für Ali' }) } as never));
		expect(k.status).toBe(200);
		expect(k.koerper.karte.fehler, JSON.stringify(k.koerper.karte)).toBeNull();
		expect(k.koerper.karte.zeilen).toContainEqual({ label: 'Mitarbeiter', wert: 'Ali Monteur' });
		const a = await antwort(await ausfuehrenPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { vorschlag: k.koerper.vorschlag }) } as never));
		expect(a.status).toBe(201);
		const d = (await listeDienste(kA())).find((x) => x.name === 'Besichtigungstermin')!;
		expect(d).toMatchObject({ dauerMin: 60, modus: 'fest' });
		expect(d.mitarbeiter.map((m) => m.id)).toEqual([u.ids.monteurA]);
		const l = await antwort(await textPost({ locals: { nutzer: u.chefA }, request: jsonAnfrage('POST', { text: 'Buchungslink für Besichtigungstermin' }) } as never));
		expect(l.koerper.vorschlag).toBeNull();
		expect(l.koerper.karte.antwort.kopieren).toContain(`/buchen/${d.links[0].token}`);
		// Monteur darf das nicht
		const m = await antwort(await textPost({ locals: { nutzer: u.monteurA }, request: jsonAnfrage('POST', { text: 'Buchungslink für Besichtigung' }) } as never));
		expect(m.koerper.karte.fehler).toMatch(/Berechtigung|Tarif/);
	});
});
