import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import {
	aendereAbwesenheit,
	aendereEinsatz,
	legeAbwesenheitAn,
	legeEinsatzAn,
	listeAbwesenheiten,
	loescheAbwesenheit,
	loescheEinsatz
} from '../../src/lib/server/plantafel';
import { berlinZeitpunkt } from '../../src/lib/zeit';

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

const UNBEKANNT = '11111111-1111-4111-8111-111111111111';
/** ISO-Zeitpunkt zu einer Berliner Uhrzeit. */
const um = (tag: string, h: number, m = 0) => berlinZeitpunkt(tag, h, m).toISOString();
const fehlerVon = (p: Promise<unknown>) => p.then(() => null, (e) => ({ status: e.status, meldung: e.message, code: e.code }));

describe('Plantafel: Einsätze und Abwesenheiten', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefAId: string, aliId: string, mehmetId: string, inaktivId: string, chefBId: string;
	let kundeA: string, kundeB: string, auftragA: string, auftragB: string;
	let chefA: Nutzer;

	const kA = () => ({ betriebId: betriebA, benutzerId: chefAId });
	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]}) returning id`)[0]
				.id as string;
		const benutzer = async (betrieb: string, rolleId: string, email: string, name: string, aktiv = true) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id, aktiv)
				values (${betrieb}, ${email}, ${name}, 'x', ${rolleId}, ${aktiv}) returning id`)[0].id as string;
		const monteur = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		chefAId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test', 'Chef A');
		aliId = await benutzer(betriebA, monteur, 'ali@beispiel.test', 'Ali');
		mehmetId = await benutzer(betriebA, monteur, 'mehmet@beispiel.test', 'Mehmet');
		inaktivId = await benutzer(betriebA, monteur, 'weg@beispiel.test', 'Ehemalig', false);
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test', 'Chef B');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		[{ id: kundeA }] = await root`
			insert into app.kunden (betrieb_id, art, nachname, strasse, plz, ort)
			values (${betriebA}, 'privat', 'Müller', 'Kundenweg 1', '20095', 'Hamburg') returning id`;
		[{ id: kundeB }] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebB}, 'privat', 'Fremd') returning id`;
		[{ id: auftragA }] = await root`
			insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Badsanierung', ${kundeA}) returning id`;
		[{ id: auftragB }] = await root`
			insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebB}, 'Fremd', ${kundeB}) returning id`;
		expect(chefA.id).toBe(chefAId);
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.einsaetze`;
		await root`delete from app.abwesenheiten`;
	});

	describe('Einsätze', () => {
		it('legt an und liefert Auftrag, Kunde, Ort (Kundenadresse ohne Objekt), Mitarbeiter, keine Warnungen', async () => {
			const e = await legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId: aliId,
				beginn: um('2026-10-21', 8),
				ende: um('2026-10-21', 12),
				notiz: '  Schlüssel beim Nachbarn '
			});
			expect(e).toMatchObject({
				auftragId: auftragA,
				auftragTitel: 'Badsanierung',
				auftragNummer: expect.stringMatching(/^A-\d{4}-0001$/),
				kundeName: 'Müller',
				ort: 'Kundenweg 1, 20095 Hamburg',
				benutzerId: aliId,
				benutzerName: 'Ali',
				beginn: um('2026-10-21', 8),
				ende: um('2026-10-21', 12),
				notiz: 'Schlüssel beim Nachbarn',
				warnungen: []
			});
		});

		it('ende <= beginn → 400 „Ende muss nach dem Beginn liegen“', async () => {
			for (const ende of [um('2026-10-21', 8), um('2026-10-21', 7)]) {
				expect(
					await fehlerVon(legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende }))
				).toMatchObject({ status: 400, meldung: 'Ende muss nach dem Beginn liegen' });
			}
		});

		it('14 h 1 min → 400 „höchstens 14 Stunden“; genau 14 h ist erlaubt', async () => {
			expect(
				await fehlerVon(
					legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 6), ende: um('2026-10-21', 20, 1) })
				)
			).toMatchObject({ status: 400, meldung: 'Ein Einsatz darf höchstens 14 Stunden dauern' });
			const ok = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 6), ende: um('2026-10-21', 20) });
			expect(ok.id).toEqual(expect.any(String));
			// auch in der Datenbank begrenzt
			await expect(
				root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
					values (${betriebA}, ${auftragA}, ${aliId}, ${um('2026-10-22', 6)}, ${um('2026-10-22', 20, 1)})`
			).rejects.toMatchObject({ code: '23514' });
			await expect(
				root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
					values (${betriebA}, ${auftragA}, ${aliId}, ${um('2026-10-22', 6)}, ${um('2026-10-22', 6)})`
			).rejects.toMatchObject({ code: '23514' });
		});

		it('ungültige Eingaben → 400 (Zeit, Auftrag, Notiz)', async () => {
			const basis = { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 10) };
			for (const [name, eingabe] of [
				['Beginn fehlt', { ...basis, beginn: undefined }],
				['Beginn kein Datum', { ...basis, beginn: 'morgen' }],
				['Ende Zahl', { ...basis, ende: 5 }],
				['Auftrag fehlt', { ...basis, auftragId: undefined }],
				['Auftrag fremd', { ...basis, auftragId: auftragB }],
				['Auftrag unbekannt', { ...basis, auftragId: UNBEKANNT }],
				['Notiz 501', { ...basis, notiz: 'x'.repeat(501) }]
			] as const) {
				expect((await fehlerVon(legeEinsatzAn(kA(), eingabe as never)))?.status, name).toBe(400);
			}
			expect(await root`select 1 from app.einsaetze`).toHaveLength(0);
		});

		it('Mitarbeiter aus Betrieb B oder deaktiviert → 400; DB lehnt fremden Mitarbeiter ab (23503)', async () => {
			const basis = { auftragId: auftragA, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 10) };
			for (const benutzerId of [chefBId, inaktivId, UNBEKANNT, 'kaputt']) {
				const f = await fehlerVon(legeEinsatzAn(kA(), { ...basis, benutzerId }));
				expect(f?.status, benutzerId).toBe(400);
			}
			await expect(
				alsApp(betriebA, chefAId, (tx) =>
					tx`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
						values (${betriebA}, ${auftragA}, ${chefBId}, ${um('2026-10-21', 8)}, ${um('2026-10-21', 10)})`
				)
			).rejects.toMatchObject({ code: '23503' });
			await expect(
				alsApp(betriebA, chefAId, (tx) =>
					tx`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
						values (${betriebA}, ${auftragB}, ${aliId}, ${um('2026-10-21', 8)}, ${um('2026-10-21', 10)})`
				)
			).rejects.toMatchObject({ code: '23503' });
		});

		it('Überlappung: speichert trotzdem und liefert genau eine Doppelbelegungs-Warnung; angrenzend keine', async () => {
			const a = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 10), ende: um('2026-10-21', 12) });
			const angrenzend = await legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId: aliId,
				beginn: um('2026-10-21', 12),
				ende: um('2026-10-21', 14)
			});
			expect(angrenzend.warnungen).toEqual([]);
			const b = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 11, 59), ende: um('2026-10-21', 13) });
			expect(b.warnungen).toHaveLength(2); // überlappt den ersten (bis 12:00) und den angrenzenden (ab 12:00)
			expect(b.warnungen).toEqual(
				expect.arrayContaining([
					{ art: 'doppelt', einsatzId: a.id },
					{ art: 'doppelt', einsatzId: angrenzend.id }
				])
			);
			const c = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 7), ende: um('2026-10-21', 10, 30) });
			expect(c.warnungen).toEqual([{ art: 'doppelt', einsatzId: a.id }]);
			expect(c.warnungen.length).toBe(1);
			expect(await root`select 1 from app.einsaetze`).toHaveLength(4);
			// anderer Mitarbeiter zur selben Zeit: keine Warnung
			const m = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: mehmetId, beginn: um('2026-10-21', 10), ende: um('2026-10-21', 12) });
			expect(m.warnungen).toEqual([]);
		});

		it('Urlaub: Warnung beim Anlegen am 24.10. 15–17 Uhr, nicht am 25.10.', async () => {
			const u = await legeAbwesenheitAn(kA(), { benutzerId: aliId, art: 'urlaub', von: '2026-10-20', bis: '2026-10-24' });
			const am24 = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-24', 15), ende: um('2026-10-24', 17) });
			expect(am24.warnungen).toEqual([{ art: 'urlaub', abwesenheitId: u.id }]);
			const am25 = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-25', 8), ende: um('2026-10-25', 10) });
			expect(am25.warnungen).toEqual([]);
		});

		it('ändern: verschieben liefert neue Warnungen; sich selbst überlappt man nicht; löschen', async () => {
			const a = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) });
			const b = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: mehmetId, beginn: um('2026-10-22', 8), ende: um('2026-10-22', 12) });
			const selbst = await aendereEinsatz(kA(), a.id, { beginn: um('2026-10-21', 9), ende: um('2026-10-21', 13) });
			expect(selbst.warnungen).toEqual([]);
			const verschoben = await aendereEinsatz(kA(), a.id, {
				benutzerId: mehmetId,
				beginn: um('2026-10-22', 11),
				ende: um('2026-10-22', 14)
			});
			expect(verschoben).toMatchObject({ benutzerId: mehmetId, benutzerName: 'Mehmet', warnungen: [{ art: 'doppelt', einsatzId: b.id }] });
			expect((await fehlerVon(aendereEinsatz(kA(), a.id, { ende: um('2026-10-22', 10) })))?.status).toBe(400);
			expect((await fehlerVon(aendereEinsatz(kA(), a.id, { benutzerId: inaktivId })))?.status).toBe(400);
			expect((await fehlerVon(aendereEinsatz(kA(), a.id, {})))?.status).toBe(400);
			expect((await fehlerVon(aendereEinsatz(kA(), UNBEKANNT, { notiz: 'x' })))?.status).toBe(404);
			await loescheEinsatz(kA(), a.id);
			expect((await fehlerVon(loescheEinsatz(kA(), a.id)))?.status).toBe(404);
		});

		it('RLS: Betrieb B sieht, ändert und löscht nichts von A; aendereEinsatz aus B → 404', async () => {
			const a = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) });
			await legeAbwesenheitAn(kA(), { benutzerId: aliId, art: 'krank', von: '2026-10-21', bis: '2026-10-21' });
			const sicht = await alsApp(betriebB, chefBId, async (tx) => ({
				e: await tx`select 1 from app.einsaetze`,
				a: await tx`select 1 from app.abwesenheiten`,
				u: await tx`update app.einsaetze set notiz = 'x' returning id`,
				d: await tx`delete from app.abwesenheiten returning id`
			}));
			expect(sicht).toEqual({ e: [], a: [], u: [], d: [] });
			const kB = { betriebId: betriebB, benutzerId: chefBId };
			expect((await fehlerVon(aendereEinsatz(kB, a.id, { notiz: 'Gehackt' })))?.status).toBe(404);
			expect((await fehlerVon(loescheEinsatz(kB, a.id)))?.status).toBe(404);
			expect(await listeAbwesenheiten(kB, '2026-10-01', '2026-10-31')).toEqual([]);
			const z = await root`
				select relname, relrowsecurity, relforcerowsecurity from pg_class
				where relnamespace = 'app'::regnamespace and relname in ('einsaetze', 'abwesenheiten') order by relname`;
			expect(z).toMatchObject([
				{ relname: 'abwesenheiten', relrowsecurity: true, relforcerowsecurity: true },
				{ relname: 'einsaetze', relrowsecurity: true, relforcerowsecurity: true }
			]);
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				expect(await app`select 1 from app.einsaetze`).toHaveLength(0);
			} finally {
				await app.end();
			}
			for (const url of [db.urlAdmin, db.urlAuth]) {
				const s = postgres(url, { max: 1, onnotice: () => {} });
				try {
					await expect(s`select 1 from app.einsaetze`).rejects.toMatchObject({ code: '42501' });
					await expect(s`select 1 from app.abwesenheiten`).rejects.toMatchObject({ code: '42501' });
				} finally {
					await s.end();
				}
			}
		});

		it('Änderungsprotokoll: Einsätze und Abwesenheiten, jede Spalte außer "geaendert"', async () => {
			const e = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) });
			const a = await legeAbwesenheitAn(kA(), { benutzerId: aliId, art: 'urlaub', von: '2026-10-26', bis: '2026-10-30' });
			for (const [tabelle, id] of [
				['einsaetze', e.id],
				['abwesenheiten', a.id]
			] as const) {
				const spalten = (
					await root`select column_name from information_schema.columns where table_schema = 'app' and table_name = ${tabelle}`
				).map((s) => s.column_name as string);
				const [p] = await root`
					select nachher, benutzer_id from app.aenderungen where tabelle = ${tabelle} and datensatz_id = ${id} and aktion = 'angelegt'`;
				expect(p.benutzer_id).toBe(chefAId);
				for (const s of spalten) {
					expect(Object.keys(p.nachher).includes(s) !== (s === 'geaendert'), `${tabelle}.${s}`).toBe(true);
				}
			}
		});
	});

	describe('Abwesenheiten', () => {
		it('anlegen, ändern, löschen; Prüfungen (Art, Datum, bis ≥ von, aktiver Mitarbeiter)', async () => {
			const a = await legeAbwesenheitAn(kA(), { benutzerId: aliId, art: 'urlaub', von: '2026-10-20', bis: '2026-10-24', notiz: 'Türkei' });
			expect(a).toMatchObject({ benutzerId: aliId, benutzerName: 'Ali', art: 'urlaub', von: '2026-10-20', bis: '2026-10-24', notiz: 'Türkei' });
			for (const [name, e] of [
				['Art', { benutzerId: aliId, art: 'ferien', von: '2026-10-20', bis: '2026-10-20' }],
				['Von', { benutzerId: aliId, art: 'krank', von: '2026-02-30', bis: '2026-03-01' }],
				['bis<von', { benutzerId: aliId, art: 'krank', von: '2026-10-21', bis: '2026-10-20' }],
				['fremd', { benutzerId: chefBId, art: 'krank', von: '2026-10-21', bis: '2026-10-21' }],
				['inaktiv', { benutzerId: inaktivId, art: 'krank', von: '2026-10-21', bis: '2026-10-21' }],
				['Notiz', { benutzerId: aliId, art: 'krank', von: '2026-10-21', bis: '2026-10-21', notiz: 'x'.repeat(201) }]
			] as const) {
				expect((await fehlerVon(legeAbwesenheitAn(kA(), e)))?.status, name).toBe(400);
			}
			const g = await aendereAbwesenheit(kA(), a.id, { bis: '2026-10-23', art: 'sonstiges' });
			expect(g).toMatchObject({ von: '2026-10-20', bis: '2026-10-23', art: 'sonstiges' });
			expect((await fehlerVon(aendereAbwesenheit(kA(), a.id, { von: '2026-10-25' })))?.status).toBe(400);
			expect(await listeAbwesenheiten(kA(), '2026-10-23', '2026-10-30')).toHaveLength(1);
			expect(await listeAbwesenheiten(kA(), '2026-10-24', '2026-10-30')).toHaveLength(0);
			await loescheAbwesenheit(kA(), a.id);
			expect((await fehlerVon(loescheAbwesenheit(kA(), a.id)))?.status).toBe(404);
			await expect(
				root`insert into app.abwesenheiten (betrieb_id, benutzer_id, art, von, bis) values (${betriebA}, ${aliId}, 'urlaub', '2026-10-21', '2026-10-20')`
			).rejects.toMatchObject({ code: '23514' });
		});
	});
});
