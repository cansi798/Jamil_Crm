import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import {
	ladeEinstellung,
	leitfadenZumTermin,
	leitfaedenFuerTermine,
	leitfaedenZumAuftrag,
	schliesseAb,
	speichereEingaben,
	speichereEinstellung,
	speichereFoto,
	speichereUnterschrift,
	meldeVerpassteLeitfaeden
} from '../../src/lib/server/leitfaden';
import { STARTVORLAGE } from '../../src/lib/leitfaden';
import { POST as sprachText } from '../../src/routes/api/sprache/text/+server';
import { POST as sprachAusfuehren } from '../../src/routes/api/sprache/ausfuehren/+server';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/**
 * Leitfaden beim Termin (Jamil msgs 4302/4304; Entscheidungen 4340: 1c je Terminart, 2b Begründung + Hinweis ans Büro,
 * 3a einer je Firma, 4b offline nachsenden, idempotent). EINE Fläche schreibt in Kundenakte, Dokumente, Aufgaben, Notizen.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const nutzerVon = (id: string, betriebId: string, rechte: readonly string[]): Nutzer => ({ id, betriebId, istAdmin: false, rechte: [...rechte], betriebStatus: 'aktiv' });
const uuid = () => crypto.randomUUID();
const Z = (min: number) => new Date(Date.now() - 60 * 60_000 + min * 60_000).toISOString();

describe('Leitfaden beim Termin', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chef: Nutzer, buero: Nutzer, monteur: Nutzer, monteur2: Nutzer, chefB: Nutzer;
	let kundeId: string, auftragId: string, terminId: string, montageId: string;
	const kA = () => ({ betriebId: betriebA, benutzerId: chef.id });
	const k = (n: Nutzer) => ({ betriebId: n.betriebId!, benutzerId: n.id });

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('B', ${premium.id}, 'aktiv') returning id`;
		const benutzer = async (betrieb: string, vorlage: keyof typeof VORLAGEN, email: string) => {
			const [r] = await root`insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${vorlage}, ${[...VORLAGEN[vorlage]]}) returning id`;
			const [b] = await root`insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id) values (${betrieb}, ${email}, ${email.split('@')[0]}, 'x', ${r.id}) returning id`;
			return nutzerVon(b.id, betrieb, VORLAGEN[vorlage]);
		};
		chef = await benutzer(betriebA, 'chef', 'chef@lf.test');
		buero = await benutzer(betriebA, 'buero', 'buero@lf.test');
		monteur = await benutzer(betriebA, 'monteur', 'monteur@lf.test');
		monteur2 = await benutzer(betriebA, 'monteur', 'monteur2@lf.test');
		chefB = await benutzer(betriebB, 'chef', 'chef@lfb.test');
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.benachrichtigungen`;
		await root`delete from app.leitfaden_vorlagen`;
		await root`delete from app.auftraege`;
		await root`delete from app.kunden`;
		await root`delete from app.buchung_dienste`;
		[{ id: kundeId }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Becker') returning id`;
		[{ id: auftragId }] = await root`insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Bad', ${kundeId}) returning id`;
		[{ id: terminId }] = await root`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, art)
			values (${betriebA}, ${auftragId}, ${monteur.id}, now(), now() + interval '1 hour', 'besichtigung') returning id`;
		[{ id: montageId }] = await root`
			insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, art)
			values (${betriebA}, ${auftragId}, ${monteur.id}, now() + interval '2 hours', now() + interval '3 hours', 'montage') returning id`;
	});

	const einschalten = (extra: Record<string, unknown> = {}) =>
		speichereEinstellung(kA(), { aktiv: true, name: 'Leitfaden Besichtigung', arten: ['besichtigung'], terminarten: [], schritte: STARTVORLAGE, ...extra });

	describe('Einstellungen (3a, 1c)', () => {
		it('ohne Zeile: aus, Startvorlage, Besichtigung angehakt', async () => {
			const e = await ladeEinstellung(kA());
			expect(e).toMatchObject({ aktiv: false, arten: ['besichtigung'], gespeichert: false, version: 0 });
			expect(e.schritte).toEqual(STARTVORLAGE);
		});
		it('speichern prüft Schritte, Name und Arten; Version steigt nur bei geänderten Schritten; fremde Terminarten fallen weg', async () => {
			await expect(speichereEinstellung(kA(), { aktiv: true, name: '', arten: ['besichtigung'], schritte: STARTVORLAGE })).rejects.toMatchObject({ status: 400 });
			await expect(speichereEinstellung(kA(), { aktiv: true, name: 'X', arten: [], terminarten: [], schritte: STARTVORLAGE })).rejects.toMatchObject({ status: 400 });
			await expect(speichereEinstellung(kA(), { aktiv: true, name: 'X', arten: ['besichtigung'], schritte: [] })).rejects.toMatchObject({ status: 400 });
			const [fremd] = await root`insert into app.buchung_dienste (betrieb_id, name) values (${betriebB}, 'Fremd') returning id`;
			const [eigen] = await root`insert into app.buchung_dienste (betrieb_id, name) values (${betriebA}, 'Aufmaß') returning id`;
			const e1 = await einschalten({ terminarten: [fremd.id, eigen.id], arten: ['besichtigung', 'zauber'] });
			expect(e1).toMatchObject({ aktiv: true, version: 1, arten: ['besichtigung'], terminarten: [eigen.id] });
			expect((await einschalten({ name: 'Neu' })).version).toBe(1);
			expect((await einschalten({ schritte: STARTVORLAGE.slice(0, 3) })).version).toBe(2);
			const [p] = await root`select count(*)::int as n from app.aenderungen where tabelle = 'leitfaden_vorlagen'`;
			expect(p.n).toBeGreaterThanOrEqual(3);
		});
	});

	describe('Wann erscheint er (1c) und wer darf (Zugriff)', () => {
		it('aus → kein Leitfaden; an → bei Besichtigung, nicht bei Montage; Terminart angehakt → auch dort', async () => {
			expect(await leitfadenZumTermin(k(monteur), monteur, terminId)).toBeNull();
			await einschalten();
			const s = await leitfadenZumTermin(k(monteur), monteur, terminId);
			expect(s).toMatchObject({ status: 'offen', auftragId, kundeId, name: 'Leitfaden Besichtigung' });
			expect(s!.schritte).toEqual(STARTVORLAGE);
			expect(s!.fehlend).toEqual(['email', 'kontaktweg', 'vorhaben', 'fotos']);
			expect(await leitfadenZumTermin(k(monteur), monteur, montageId)).toBeNull();
			const [ta] = await root`insert into app.buchung_dienste (betrieb_id, name) values (${betriebA}, 'Aufmaß') returning id`;
			await root`update app.einsaetze set terminart_id = ${ta.id} where id = ${montageId}`;
			await einschalten({ terminarten: [ta.id] });
			expect(await leitfadenZumTermin(k(monteur), monteur, montageId)).not.toBeNull();
		});
		it('eingeteilte Person und Plantafel-Bearbeiter ja; anderer Monteur und fremder Betrieb → 404', async () => {
			await einschalten();
			expect(await leitfadenZumTermin(k(chef), chef, terminId)).not.toBeNull();
			await expect(leitfadenZumTermin(k(monteur2), monteur2, terminId)).rejects.toMatchObject({ status: 404 });
			await expect(leitfadenZumTermin(k(chefB), chefB, terminId)).rejects.toMatchObject({ status: 404 });
			await expect(leitfadenZumTermin(k(monteur), monteur, 'kaputt')).rejects.toMatchObject({ status: 404 });
		});
		it('spätere Änderungen der Vorlage ändern einen laufenden Durchlauf nicht; „Meine Einsätze heute“ liefert ihn mit', async () => {
			await einschalten();
			await leitfadenZumTermin(k(monteur), monteur, terminId);
			await einschalten({ schritte: STARTVORLAGE.slice(0, 2) });
			expect((await leitfadenZumTermin(k(monteur), monteur, terminId))!.schritte).toHaveLength(STARTVORLAGE.length);
			const heute = await leitfaedenFuerTermine(k(monteur), monteur, [terminId, montageId]);
			expect([...heute.keys()]).toEqual([terminId]);
		});
	});

	describe('Eingaben: EINE Fläche schreibt in die Bereiche; offline idempotent (4b)', () => {
		it('Kundendaten landen in der Kundenakte (Quelle „leitfaden“), auch für den Monteur ohne Recht „Kunden bearbeiten“', async () => {
			await einschalten();
			const s = await speichereEingaben(k(monteur), monteur, terminId, [
				{ opId: uuid(), schrittId: 'email', wert: 'becker@example.org', zeit: Z(1) },
				{ opId: uuid(), schrittId: 'kontaktweg', wert: 'chat', zeit: Z(2) },
				{ opId: uuid(), schrittId: 'vorhaben', wert: 'Bad komplett neu', zeit: Z(3) }
			]);
			const [kd] = await root`select email::text as email, bevorzugter_kontakt from app.kunden where id = ${kundeId}`;
			expect(kd).toEqual({ email: 'becker@example.org', bevorzugter_kontakt: 'chat' });
			const [p] = await root`select quelle, benutzer_id from app.aenderungen where tabelle = 'kunden' and datensatz_id = ${kundeId} and aktion = 'geaendert' order by id desc limit 1`;
			expect(p).toEqual({ quelle: 'leitfaden', benutzer_id: monteur.id });
			expect(s.fehlend).toEqual(['fotos']);
			expect(s.antworten.vorhaben.wert).toBe('Bad komplett neu');
		});
		it('ungültige E-Mail → 400, nichts gespeichert (alles oder nichts)', async () => {
			await einschalten();
			await expect(
				speichereEingaben(k(monteur), monteur, terminId, [
					{ opId: uuid(), schrittId: 'vorhaben', wert: 'X', zeit: Z(1) },
					{ opId: uuid(), schrittId: 'email', wert: 'kaputt', zeit: Z(2) }
				])
			).rejects.toMatchObject({ status: 400 });
			expect((await root`select antworten from app.leitfaden_durchlaeufe`)[0]?.antworten ?? {}).toEqual({});
			expect(await root`select 1 from app.leitfaden_eingaben`).toHaveLength(0);
		});
		it('dieselbe Eingabe zweimal (Nachsenden) wirkt einmal; eine ältere, spät ankommende Eingabe überschreibt nicht', async () => {
			await einschalten();
			const op = uuid();
			await speichereEingaben(k(monteur), monteur, terminId, [{ opId: op, schrittId: 'vorhaben', wert: 'neu', zeit: Z(10) }]);
			await speichereEingaben(k(monteur), monteur, terminId, [{ opId: op, schrittId: 'vorhaben', wert: 'neu', zeit: Z(10) }]);
			const s = await speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'vorhaben', wert: 'alt (offline)', zeit: Z(5) }]);
			expect(s.antworten.vorhaben.wert).toBe('neu');
			const [n] = await root`select count(*)::int as n from app.leitfaden_eingaben`;
			expect(n.n).toBe(2);
		});
		it('unbekannter Schritt, Hinweis, falsche Kennung → 400; anderer Monteur → 404', async () => {
			await einschalten();
			await expect(speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'gibtsnicht', wert: 'x', zeit: Z(1) }])).rejects.toMatchObject({ status: 400 });
			await expect(speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'begruessung', wert: 'x', zeit: Z(1) }])).rejects.toMatchObject({ status: 400 });
			await expect(speichereEingaben(k(monteur), monteur, terminId, [{ opId: 'nein', schrittId: 'vorhaben', wert: 'x', zeit: Z(1) }])).rejects.toMatchObject({ status: 400 });
			await expect(speichereEingaben(k(monteur2), monteur2, terminId, [{ opId: uuid(), schrittId: 'vorhaben', wert: 'x', zeit: Z(1) }])).rejects.toMatchObject({ status: 404 });
		});
		it('Fotos landen in den Dokumenten des Auftrags; doppelt gesendet zählt einmal; falscher Inhalt → 400', async () => {
			await einschalten();
			const op = uuid();
			const foto = () => new File([PNG], 'bild.png', { type: 'image/png' });
			await speichereFoto(k(monteur), monteur, terminId, { opId: op, schrittId: 'fotos', zeit: Z(1), datei: foto() });
			const s = await speichereFoto(k(monteur), monteur, terminId, { opId: op, schrittId: 'fotos', zeit: Z(1), datei: foto() });
			expect(s.antworten.fotos.wert).toHaveLength(1);
			await speichereFoto(k(monteur), monteur, terminId, { opId: uuid(), schrittId: 'fotos', zeit: Z(2), datei: foto() });
			const dateien = await root`select name, beschreibung, von_benutzer_id from app.dateien where auftrag_id = ${auftragId}`;
			expect(dateien).toHaveLength(2);
			expect(dateien[0]).toMatchObject({ von_benutzer_id: monteur.id, beschreibung: 'Leitfaden: Fotos vom Bereich (mindestens 2)' });
			await expect(
				speichereFoto(k(monteur), monteur, terminId, { opId: uuid(), schrittId: 'fotos', zeit: Z(3), datei: new File([Buffer.from('<html>')], 'x.png', { type: 'image/png' }) })
			).rejects.toMatchObject({ status: 400 });
			await expect(speichereFoto(k(monteur), monteur, terminId, { opId: uuid(), schrittId: 'vorhaben', zeit: Z(3), datei: foto() })).rejects.toMatchObject({ status: 400 });
		});
	});

	describe('Abschluss (2b)', () => {
		it('fehlende Pflicht ohne Begründung → 400; mit Begründung → Hinweis an Büro und Chef (nicht an den Monteur), Notiz am Auftrag', async () => {
			await einschalten();
			await leitfadenZumTermin(k(monteur), monteur, terminId);
			await expect(schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: '' })).rejects.toMatchObject({ status: 400 });
			const op = uuid();
			const s = await schliesseAb(k(monteur), monteur, terminId, { opId: op, begruendung: 'Kunde hatte keine Zeit' });
			expect(s).toMatchObject({ status: 'mit_begruendung', begruendung: 'Kunde hatte keine Zeit', abgeschlossenVon: 'monteur' });
			const n = await root`select benutzer_id, kategorie, link, titel from app.benachrichtigungen where schluessel like 'leitfaden:%' order by benutzer_id`;
			expect(n.map((x) => x.benutzer_id).sort()).toEqual([chef.id, buero.id].sort());
			expect(n[0]).toMatchObject({ kategorie: 'termin', link: `/auftraege/${auftragId}#leitfaden` });
			const [notiz] = await root`select text, von_benutzer_id from app.notizen where auftrag_id = ${auftragId}`;
			expect(notiz.text).toContain('Begründung für fehlende Pflichtschritte: Kunde hatte keine Zeit');
			// nochmal abschließen (nachgeschickt) → nichts doppelt; Eingaben danach → 409
			await schliesseAb(k(monteur), monteur, terminId, { opId: op, begruendung: 'Kunde hatte keine Zeit' });
			await schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: 'egal' });
			expect(await root`select 1 from app.notizen where auftrag_id = ${auftragId}`).toHaveLength(1);
			await expect(speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'vorhaben', wert: 'x', zeit: Z(9) }])).rejects.toMatchObject({ status: 409 });
			// Auftrag gelöscht → Leitfaden und seine Hinweise sind weg
			await root`delete from app.auftraege where id = ${auftragId}`;
			expect(await root`select 1 from app.benachrichtigungen where schluessel like 'leitfaden:%'`).toHaveLength(0);
		});
		it('alles erledigt → „abgeschlossen“, gewählte Aufgabe entsteht am Auftrag, kein Hinweis ans Büro', async () => {
			await einschalten();
			await root`update app.kunden set email = 'b@example.org', bevorzugter_kontakt = 'telefon' where id = ${kundeId}`;
			await speichereEingaben(k(monteur), monteur, terminId, [
				{ opId: uuid(), schrittId: 'vorhaben', wert: 'Dusche', zeit: Z(1) },
				{ opId: uuid(), schrittId: 'angebot', wert: { anlegen: true, titel: 'Angebot Dusche' }, zeit: Z(2) }
			]);
			for (let i = 0; i < 2; i++) await speichereFoto(k(monteur), monteur, terminId, { opId: uuid(), schrittId: 'fotos', zeit: Z(3 + i), datei: new File([PNG], 'b.png', { type: 'image/png' }) });
			const s = await schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: 'wird ignoriert' });
			expect(s).toMatchObject({ status: 'abgeschlossen', begruendung: null, fehlend: [] });
			expect((await root`select titel from app.todos where auftrag_id = ${auftragId}`).map((t) => t.titel)).toEqual(['Angebot Dusche']);
			expect(await root`select 1 from app.benachrichtigungen where schluessel like 'leitfaden:%'`).toHaveLength(0);
		});
	});

	it('Auftrag: Karte zeigt alle Leitfäden; Termin gelöscht → Leitfaden bleibt beim Auftrag', async () => {
		await einschalten();
		await leitfadenZumTermin(k(monteur), monteur, terminId);
		await root`delete from app.einsaetze where id = ${terminId}`;
		const liste = await leitfaedenZumAuftrag(kA(), auftragId);
		expect(liste).toHaveLength(1);
		expect(liste[0]).toMatchObject({ einsatzId: null, auftragId, status: 'offen' });
		expect(await leitfaedenZumAuftrag({ betriebId: betriebB, benutzerId: chefB.id }, auftragId)).toEqual([]);
	});

	describe('Stufe 2 (msg 4353): Protokoll im Leitfaden, Hinweis bei verpasstem Leitfaden', () => {
		const SCHEMA = {
			seiten: [{ id: 's', titel: 'Besichtigung', abschnitte: [{ id: 'a', felder: [
				{ id: 'bereich', typ: 'text', label: 'Bereich', pflicht: true },
				{ id: 'fotos', typ: 'foto', label: 'Fotos' },
				{ id: 'unterschrift', typ: 'unterschrift', label: 'Unterschrift Kunde', wer: 'kunde' }
			] }] }]
		};
		let gruppe: string;
		const mitProtokoll = async () => {
			[{ gruppe_id: gruppe }] = await root`
				insert into app.protokoll_vorlagen (betrieb_id, gruppe_id, version, name, schema, art)
				values (${betriebA}, gen_random_uuid(), 1, 'Besichtigungsprotokoll', ${root.json(SCHEMA as never)}, 'protokoll') returning gruppe_id`;
			return einschalten({ schritte: [
				{ id: 'prot', typ: 'protokoll', titel: 'Besichtigungsprotokoll', pflicht: true, vorlageGruppe: gruppe, vorlageName: 'Besichtigungsprotokoll' },
				{ id: 'notiz', typ: 'notiz', titel: 'Notiz', pflicht: false }
			] });
		};
		beforeEach(async () => {
			await root`delete from app.protokoll_vorlagen`;
		});

		it('beim Start entsteht das Protokoll aus der aktuellen Vorlage am Auftrag; Felder über die eine Fläche, spätere gewinnt, idempotent', async () => {
			await mitProtokoll();
			const s = await leitfadenZumTermin(k(monteur), monteur, terminId);
			const p = s!.protokolle.prot!;
			expect(p).toMatchObject({ titel: 'Besichtigungsprotokoll', status: 'entwurf' });
			expect((await root`select auftrag_id from app.protokolle where id = ${p.id}`)[0].auftrag_id).toBe(auftragId);
			expect(s!.fehlend).toEqual(['prot']);
			const op = uuid();
			await speichereEingaben(k(monteur), monteur, terminId, [{ opId: op, schrittId: 'prot', wert: { feld: 'bereich', wert: 'Bad 1. OG' }, zeit: Z(10) }]);
			await speichereEingaben(k(monteur), monteur, terminId, [{ opId: op, schrittId: 'prot', wert: { feld: 'bereich', wert: 'Bad 1. OG' }, zeit: Z(10) }]);
			const s2 = await speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'prot', wert: { feld: 'bereich', wert: 'alt (offline)' }, zeit: Z(5) }]);
			expect(s2.protokolle.prot!.antworten.bereich).toBe('Bad 1. OG');
			expect(s2.fehlend).toEqual([]);
		});

		it('Foto und Unterschrift landen im Protokoll (idempotent); Abschluss schließt es ab, PDF in den Dokumenten', async () => {
			await mitProtokoll();
			await leitfadenZumTermin(k(monteur), monteur, terminId);
			const op = uuid();
			const foto = () => new File([PNG], 'f.png', { type: 'image/png' });
			await speichereFoto(k(monteur), monteur, terminId, { opId: op, schrittId: 'prot', feld: 'fotos', zeit: Z(1), datei: foto() });
			await speichereFoto(k(monteur), monteur, terminId, { opId: op, schrittId: 'prot', feld: 'fotos', zeit: Z(1), datei: foto() });
			await speichereUnterschrift(k(monteur), monteur, terminId, { opId: uuid(), schrittId: 'prot', feld: 'unterschrift', name: 'Herr Becker', datei: new Blob([PNG], { type: 'image/png' }) });
			const dateien = await root`select art from app.protokoll_dateien order by art`;
			expect(dateien.map((d) => d.art)).toEqual(['foto', 'unterschrift']);
			await speichereEingaben(k(monteur), monteur, terminId, [{ opId: uuid(), schrittId: 'prot', wert: { feld: 'bereich', wert: 'Bad' }, zeit: Z(2) }]);
			const s = await schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: '' });
			expect(s.status).toBe('abgeschlossen');
			expect(s.protokolle.prot).toMatchObject({ status: 'abgeschlossen' });
			const [p] = await root`select status, pdf_datei_id, unterschrieben_von from app.protokolle`;
			expect(p).toMatchObject({ status: 'abgeschlossen', unterschrieben_von: 'Herr Becker' });
			const [pdf] = await root`select typ, auftrag_id from app.dateien where id = ${p.pdf_datei_id}`;
			expect(pdf).toEqual({ typ: 'application/pdf', auftrag_id: auftragId });
			const [n] = await root`select text from app.notizen where auftrag_id = ${auftragId}`;
			expect(n.text).toContain('„Besichtigungsprotokoll“ abgeschlossen');
		});

		it('unvollständiges Protokoll: nur mit Begründung, Protokoll bleibt Entwurf; archivierte Vorlage → kein Protokoll, Eingabe 400', async () => {
			await mitProtokoll();
			await leitfadenZumTermin(k(monteur), monteur, terminId);
			await expect(schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: '' })).rejects.toMatchObject({ status: 400 });
			const s = await schliesseAb(k(monteur), monteur, terminId, { opId: uuid(), begruendung: 'Kunde nicht da' });
			expect(s.status).toBe('mit_begruendung');
			expect((await root`select status from app.protokolle`)[0].status).toBe('entwurf');
			// zweiter Termin, Vorlage inzwischen archiviert
			await root`update app.protokoll_vorlagen set archiviert = true`;
			await root`update app.einsaetze set art = 'besichtigung' where id = ${montageId}`;
			const s2 = await leitfadenZumTermin(k(monteur), monteur, montageId);
			expect(s2!.protokolle.prot).toBeNull();
			await expect(speichereEingaben(k(monteur), monteur, montageId, [{ opId: uuid(), schrittId: 'prot', wert: { feld: 'bereich', wert: 'x' }, zeit: Z(1) }])).rejects.toMatchObject({ status: 400 });
		});

		it('Termin vorbei, Leitfaden nicht abgeschlossen → einmal Hinweis an Büro und Chef; abgeschlossene, alte und andere Termine nicht', async () => {
			await einschalten();
			await root`update app.leitfaden_vorlagen set angelegt = now() - interval '5 days'`;
			await root`update app.einsaetze set beginn = now() - interval '3 hours', ende = now() - interval '2 hours' where id = ${terminId}`;
			// Montage (nicht angehakt), alte Besichtigung (vor 3 Tagen) und eine abgeschlossene
			await root`update app.einsaetze set beginn = now() - interval '3 hours', ende = now() - interval '2 hours' where id = ${montageId}`;
			const [alt] = await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, art) values (${betriebA}, ${auftragId}, ${monteur.id}, now() - interval '3 days 1 hour', now() - interval '3 days', 'besichtigung') returning id`;
			const [fertig] = await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, art) values (${betriebA}, ${auftragId}, ${monteur.id}, now() - interval '5 hours', now() - interval '4 hours', 'besichtigung') returning id`;
			await leitfadenZumTermin(k(monteur), monteur, fertig.id);
			await schliesseAb(k(monteur), monteur, fertig.id, { opId: uuid(), begruendung: 'egal' });
			await root`delete from app.benachrichtigungen`;
			expect(await meldeVerpassteLeitfaeden()).toBe(1);
			expect(await meldeVerpassteLeitfaeden()).toBe(0);
			const n = await root`select benutzer_id, link from app.benachrichtigungen where schluessel like 'leitfaden-verpasst:%'`;
			expect(n.map((x) => x.benutzer_id).sort()).toEqual([chef.id, buero.id].sort());
			expect(n[0].link).toBe(`/auftraege/${auftragId}#leitfaden`);
			expect((await root`select einsatz_id from app.leitfaden_verpasst`).map((x) => x.einsatz_id)).toEqual([terminId]);
			void alt;
		});
	});

	describe('Sprachbefehle (msg 4353, ständige Regel)', () => {
		const sag = async (n: Nutzer, text: string) => {
			const r = await sprachText({ locals: { nutzer: n }, request: new Request('http://localhost/api/sprache/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }) } as never);
			return (await r.json()) as any;
		};
		beforeAll(() => {
			process.env.CRM_VORSCHLAG_GEHEIMNIS = 'test-geheimnis-leitfaden-0123456789abcdef';
			setzeKiAnbieter(new FakeKi());
		});

		it('„Leitfaden fortsetzen für Becker“ öffnet den Leitfaden; „Wie weit …“ nennt den Stand – beides ohne Bestätigung', async () => {
			await einschalten();
			const r = await sag(chef, 'Leitfaden fortsetzen für Becker');
			expect(r.vorschlag).toBeNull();
			expect(r.karte.antwort.oeffnen).toBe(`/leitfaden/${terminId}`);
			const st = await sag(chef, 'Wie weit ist der Leitfaden bei Becker?');
			expect(st.karte.fehler).toBeNull();
			expect(st.karte.antwort.vorlesen).toMatch(/von \d+ erledigt/);
			expect(st.karte.antwort.oeffnen).toBe(`/auftraege/${auftragId}#leitfaden`);
			expect((await sag(chef, 'Leitfaden fortsetzen für Niemand')).karte.fehler).toMatch(/Keinen Termin/);
		});

		it('„Im Leitfaden bei Becker: E-Mail ist …, bevorzugt per WhatsApp“ → Karte, erst nach Bestätigung gespeichert (Kundenakte)', async () => {
			await einschalten();
			const r = await sag(chef, 'Im Leitfaden bei Becker: E-Mail ist becker@example.org, bevorzugt per WhatsApp');
			expect(r.karte.fehler).toBeNull();
			expect(r.karte.zeilen.map((z: { label: string }) => z.label)).toEqual(['Leitfaden', 'E-Mail-Adresse', 'Bevorzugter Kontaktweg']);
			expect((await root`select email from app.kunden where id = ${kundeId}`)[0].email).toBeNull();
			const a = await sprachAusfuehren({ locals: { nutzer: chef }, request: new Request('http://localhost/api/sprache/ausfuehren', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vorschlag: r.vorschlag }) }) } as never);
			expect(a.status).toBeLessThan(300);
			const [kd] = await root`select email::text as email, bevorzugter_kontakt from app.kunden where id = ${kundeId}`;
			expect(kd).toEqual({ email: 'becker@example.org', bevorzugter_kontakt: 'chat' });
			const [p] = await root`select quelle from app.aenderungen where tabelle = 'kunden' and datensatz_id = ${kundeId} and aktion = 'geaendert' order by id desc limit 1`;
			expect(p.quelle).toBe('leitfaden');
		});
	});
});
