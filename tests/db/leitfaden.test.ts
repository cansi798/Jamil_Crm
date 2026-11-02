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
	speichereFoto
} from '../../src/lib/server/leitfaden';
import { STARTVORLAGE } from '../../src/lib/leitfaden';

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
});
