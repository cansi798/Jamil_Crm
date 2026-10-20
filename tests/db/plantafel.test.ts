import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import {
	ladeWoche,
	meineEinsaetzeHeute,
	aendereAbwesenheit,
	aendereEinsatz,
	legeAbwesenheitAn,
	legeEinsatzAn,
	listeAbwesenheiten,
	loescheAbwesenheit,
	loescheEinsatz
} from '../../src/lib/server/plantafel';
import { berlinTag, berlinZeitpunkt } from '../../src/lib/zeit';
import { holeAuftrag, listeAuftraege } from '../../src/lib/server/auftraege';
import { GET as plantafelGet } from '../../src/routes/api/plantafel/+server';
import { GET as heuteGet } from '../../src/routes/api/heute/+server';
import { POST as einsatzPost } from '../../src/routes/api/einsaetze/+server';
import {
	DELETE as einsatzDelete,
	GET as einsatzGet,
	PATCH as einsatzPatch
} from '../../src/routes/api/einsaetze/[id]/+server';
import { GET as abwesenheitenGet, POST as abwesenheitPost } from '../../src/routes/api/abwesenheiten/+server';
import {
	DELETE as abwesenheitDelete,
	PATCH as abwesenheitPatch
} from '../../src/routes/api/abwesenheiten/[id]/+server';
import { load as auftragLoad } from '../../src/routes/(app)/auftraege/[id]/+page.server';
import { load as plantafelLoad } from '../../src/routes/(app)/plantafel/+page.server';
import {
	actions as abwAktionen,
	load as abwLoad
} from '../../src/routes/(app)/plantafel/abwesenheiten/+page.server';

type Ant = { status: number; koerper: any };
async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}
const jsonAnfrage = (methode: string, koerper?: unknown) =>
	new Request('http://localhost/api/x', {
		method: methode,
		headers: { 'content-type': 'application/json' },
		body: koerper === undefined ? undefined : JSON.stringify(koerper)
	});

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
	let betriebA: string, betriebB: string, betriebC: string;
	let chefCId: string;
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
		const [ohne] = await root`
			insert into app.tarife (schluessel, name, module, grenzen)
			values ('ohne-plantafel', 'Ohne Plantafel', ${['kunden', 'auftraege']}, '{}') returning id`;
		[{ id: betriebC }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb C', ${ohne.id}, 'aktiv') returning id`;
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
		chefCId = await benutzer(betriebC, await rolle(betriebC, 'Chef', VORLAGEN.chef), 'chef-c@beispiel.test', 'Chef C');
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

	describe('Wochenansicht, heute, API', () => {
		const ali = () => nutzerVon(aliId, betriebA, VORLAGEN.monteur);
		const buero = () => nutzerVon(chefAId, betriebA, VORLAGEN.buero);
		const chefC = () => nutzerVon(chefCId, betriebC, VORLAGEN.chef);
		const plantafel = async (nutzer: Nutzer | null, tag?: string) => {
			const url = new URL('http://localhost/api/plantafel');
			if (tag) url.searchParams.set('tag', tag);
			return antwort(await plantafelGet({ locals: { nutzer }, url } as never));
		};
		const heute = async (nutzer: Nutzer | null) => antwort(await heuteGet({ locals: { nutzer } } as never));
		const einsatz = (benutzerId: string, tag: string, von: [number, number], bis: [number, number], bisTag = tag) =>
			legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId,
				beginn: um(tag, von[0], von[1]),
				ende: um(bisTag, bis[0], bis[1])
			});

		it('ladeWoche: 7 Tage 19.–25.10., Einsatz So 25.10. 22:00–23:30 am 25.10.; Folgewoche ohne ihn', async () => {
			const spaet = await einsatz(aliId, '2026-10-25', [22, 0], [23, 30]);
			await einsatz(aliId, '2026-10-19', [0, 0], [2, 0]);
			const w = await ladeWoche(kA(), '2026-10-21');
			expect(w.tage).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
			const gefunden = w.einsaetze.find((e) => e.id === spaet.id)!;
			expect(gefunden).toBeDefined();
			expect(berlinTag(new Date(gefunden.beginn))).toBe('2026-10-25');
			expect(w.einsaetze.map((e) => berlinTag(new Date(e.beginn)))).toEqual(['2026-10-19', '2026-10-25']);
			const folge = await ladeWoche(kA(), '2026-10-26');
			expect(folge.tage[0]).toBe('2026-10-26');
			expect(folge.tage[6]).toBe('2026-11-01');
			expect(folge.einsaetze.map((e) => e.id)).not.toContain(spaet.id);
			// Vorwoche enthält den Montag-0-Uhr-Einsatz nicht
			expect((await ladeWoche(kA(), '2026-10-18')).einsaetze).toEqual([]);
		});

		it('ladeWoche: Mitarbeiter aktiv nach Name; Deaktivierter nur mit Einsatz in der Woche (aktiv:false); Warnungen und Abwesenheiten', async () => {
			await root`
				insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
				values (${betriebA}, ${auftragA}, ${inaktivId}, ${um('2026-10-20', 8)}, ${um('2026-10-20', 10)})`;
			await einsatz(aliId, '2026-10-21', [8, 0], [12, 0]);
			await einsatz(aliId, '2026-10-21', [11, 0], [13, 0]);
			const u = await legeAbwesenheitAn(kA(), { benutzerId: mehmetId, art: 'urlaub', von: '2026-10-16', bis: '2026-10-20' });
			await einsatz(mehmetId, '2026-10-20', [8, 0], [9, 0]);
			const w = await ladeWoche(kA(), '2026-10-21');
			expect(w.mitarbeiter).toEqual([
				{ id: aliId, name: 'Ali', aktiv: true },
				{ id: chefAId, name: 'Chef A', aktiv: true },
				{ id: inaktivId, name: 'Ehemalig', aktiv: false },
				{ id: mehmetId, name: 'Mehmet', aktiv: true }
			]);
			expect(w.abwesenheiten.map((a) => a.id)).toEqual([u.id]);
			const warn = Object.fromEntries(w.einsaetze.map((e) => [`${e.benutzerName} ${berlinTag(new Date(e.beginn))} ${e.beginn.slice(11, 16)}`, e.warnungen.map((x) => x.art)]));
			expect(warn['Ali 2026-10-21 06:00']).toEqual(['doppelt']);
			expect(warn['Ali 2026-10-21 09:00']).toEqual(['doppelt']);
			expect(warn['Mehmet 2026-10-20 06:00']).toEqual(['urlaub']);
			expect(warn['Ehemalig 2026-10-20 06:00']).toEqual([]);
			// Folgewoche: Deaktivierter ohne Einsatz fehlt
			expect((await ladeWoche(kA(), '2026-10-28')).mitarbeiter.map((m) => m.name)).toEqual(['Ali', 'Chef A', 'Mehmet']);
		});

		it('meineEinsaetzeHeute (jetzt = 25.10. 23:30 Berlin): nur Einsätze dieses Tages, nach Beginn, nur eigene', async () => {
			const frueh = await einsatz(aliId, '2026-10-25', [8, 0], [10, 0]);
			const spaet = await einsatz(aliId, '2026-10-25', [22, 0], [23, 30]);
			await einsatz(aliId, '2026-10-24', [23, 0], [23, 59]);
			await einsatz(aliId, '2026-10-26', [0, 30], [2, 0]);
			await einsatz(mehmetId, '2026-10-25', [9, 0], [10, 0]);
			const jetzt = berlinZeitpunkt('2026-10-25', 23, 30);
			const liste = await meineEinsaetzeHeute({ betriebId: betriebA, benutzerId: aliId }, aliId, jetzt);
			expect(liste.map((e) => e.id)).toEqual([frueh.id, spaet.id]);
			expect(liste[0]).toMatchObject({ kundeName: 'Müller', ort: 'Kundenweg 1, 20095 Hamburg', auftragTitel: 'Badsanierung' });
		});

		it('Monteur: GET /api/plantafel 403, GET /api/heute nur eigene; Büro (alle_lesen) liest die Plantafel', async () => {
			const jetzt = new Date();
			const tag = berlinTag(jetzt);
			const meins = await legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId: aliId,
				beginn: berlinZeitpunkt(tag, 7).toISOString(),
				ende: berlinZeitpunkt(tag, 9).toISOString()
			});
			await legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId: mehmetId,
				beginn: berlinZeitpunkt(tag, 7).toISOString(),
				ende: berlinZeitpunkt(tag, 9).toISOString()
			});
			expect((await plantafel(ali())).status).toBe(403);
			const h = await heute(ali());
			expect(h.status).toBe(200);
			expect(h.koerper.map((e: any) => e.id)).toEqual([meins.id]);
			const nurAlle = nutzerVon(chefAId, betriebA, ['auftraege.alle_lesen']);
			const p = await plantafel(nurAlle, tag);
			expect(p.status).toBe(200);
			expect(p.koerper.einsaetze).toHaveLength(2);
			expect((await plantafel(buero(), 'kaputt')).status).toBe(400);
			expect((await plantafel(buero())).koerper.tage).toContain(tag);
			expect((await plantafel(null)).status).toBe(401);
			expect((await plantafel(chefC())).status).toBe(402);
			expect((await heute(chefC())).status).toBe(402);
			expect((await heute(nutzerVon(aliId, betriebA, ['kunden.lesen']))).status).toBe(403);
		});

		it('Monteur sieht Auftrag mit eigenem Einsatz in listeAuftraege; fremder bleibt 404; Auftragsseite zeigt Einsätze', async () => {
			const [{ id: zweiter }] = await root`
				insert into app.auftraege (betrieb_id, titel, kunde_id) values (${betriebA}, 'Fremder Auftrag', ${kundeA}) returning id`;
			const k = { betriebId: betriebA, benutzerId: aliId };
			const sicht = { alle: false, benutzerId: aliId };
			expect(await listeAuftraege(k, sicht, {})).toEqual([]);
			await einsatz(aliId, '2026-10-21', [8, 0], [12, 0]);
			expect((await listeAuftraege(k, sicht, {})).map((a) => a.titel)).toEqual(['Badsanierung']);
			expect((await holeAuftrag(k, sicht, auftragA)).id).toBe(auftragA);
			await expect(holeAuftrag(k, sicht, zweiter)).rejects.toMatchObject({ status: 404 });
			const d = (await auftragLoad({ locals: { nutzer: ali() }, params: { id: auftragA } } as never)) as any;
			expect(d.einsaetze.map((e: any) => e.benutzerName)).toEqual(['Ali']);
			await root`delete from app.auftraege where id = ${zweiter}`;
		});

		it('Einsätze-API: Chef legt an (201, Warnungen), verschiebt (PATCH), löscht (204); Monteur 403; ohne Modul 402', async () => {
			const basis = { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) };
			const r1 = await antwort(await einsatzPost({ locals: { nutzer: chefA }, request: jsonAnfrage('POST', basis) } as never));
			expect(r1.status).toBe(201);
			const r2 = await antwort(
				await einsatzPost({ locals: { nutzer: chefA }, request: jsonAnfrage('POST', { ...basis, beginn: um('2026-10-21', 11) }) } as never)
			);
			expect(r2.koerper.warnungen).toEqual([{ art: 'doppelt', einsatzId: r1.koerper.id }]);
			const p = await antwort(
				await einsatzPatch({
					locals: { nutzer: chefA },
					params: { id: r2.koerper.id },
					request: jsonAnfrage('PATCH', { beginn: um('2026-10-22', 11), ende: um('2026-10-22', 12), benutzerId: mehmetId })
				} as never)
			);
			expect(p.status).toBe(200);
			expect(p.koerper).toMatchObject({ benutzerId: mehmetId, warnungen: [] });
			const g = await antwort(await einsatzGet({ locals: { nutzer: chefA }, params: { id: r1.koerper.id } } as never));
			expect(g.koerper.id).toBe(r1.koerper.id);
			expect((await antwort(await einsatzGet({ locals: { nutzer: ali() }, params: { id: r1.koerper.id } } as never))).status).toBe(403);
			expect(
				(await antwort(await einsatzPost({ locals: { nutzer: ali() }, request: jsonAnfrage('POST', basis) } as never))).status
			).toBe(403);
			expect(
				(await antwort(await einsatzPatch({ locals: { nutzer: ali() }, params: { id: r1.koerper.id }, request: jsonAnfrage('PATCH', { notiz: 'x' }) } as never))).status
			).toBe(403);
			expect((await antwort(await einsatzDelete({ locals: { nutzer: ali() }, params: { id: r1.koerper.id } } as never))).status).toBe(403);
			expect(
				(await antwort(await einsatzPost({ locals: { nutzer: chefC() }, request: jsonAnfrage('POST', basis) } as never))).status
			).toBe(402);
			expect((await antwort(await einsatzDelete({ locals: { nutzer: chefA }, params: { id: r1.koerper.id } } as never))).status).toBe(204);
			const fehler = await antwort(
				await einsatzPost({ locals: { nutzer: chefA }, request: jsonAnfrage('POST', { ...basis, ende: basis.beginn }) } as never)
			);
			expect(fehler).toMatchObject({ status: 400, koerper: { fehler: 'Ende muss nach dem Beginn liegen' } });
		});

		it('Abwesenheiten-API: anlegen, auflisten (Zeitraum), ändern, löschen; Monteur 403', async () => {
			const r = await antwort(
				await abwesenheitPost({
					locals: { nutzer: chefA },
					request: jsonAnfrage('POST', { benutzerId: aliId, art: 'krank', von: '2026-10-21', bis: '2026-10-22' })
				} as never)
			);
			expect(r.status).toBe(201);
			const url = new URL('http://localhost/api/abwesenheiten?von=2026-10-19&bis=2026-10-25');
			const l = await antwort(await abwesenheitenGet({ locals: { nutzer: chefA }, url } as never));
			expect(l.koerper.map((a: any) => a.art)).toEqual(['krank']);
			expect((await antwort(await abwesenheitenGet({ locals: { nutzer: chefA }, url: new URL('http://localhost/api/abwesenheiten?von=x') } as never))).status).toBe(400);
			const p = await antwort(
				await abwesenheitPatch({ locals: { nutzer: chefA }, params: { id: r.koerper.id }, request: jsonAnfrage('PATCH', { bis: '2026-10-23' }) } as never)
			);
			expect(p.koerper.bis).toBe('2026-10-23');
			expect(
				(await antwort(await abwesenheitPost({ locals: { nutzer: ali() }, request: jsonAnfrage('POST', { benutzerId: aliId, art: 'krank', von: '2026-10-21', bis: '2026-10-21' }) } as never))).status
			).toBe(403);
			expect((await antwort(await abwesenheitenGet({ locals: { nutzer: ali() }, url } as never))).status).toBe(403);
			expect((await antwort(await abwesenheitDelete({ locals: { nutzer: ali() }, params: { id: r.koerper.id } } as never))).status).toBe(403);
			expect((await antwort(await abwesenheitDelete({ locals: { nutzer: chefA }, params: { id: r.koerper.id } } as never))).status).toBe(204);
		});
	});

	describe('Seiten', () => {
		const ort = (nutzer: Nutzer | null) => ({ locals: { nutzer } });
		const formAnfrage = (felder: Record<string, string>) => {
			const body = new URLSearchParams();
			for (const [k, v] of Object.entries(felder)) body.append(k, v);
			return new Request('http://localhost/plantafel/abwesenheiten', { method: 'POST', body });
		};

		it('Plantafel: Woche aus ?tag=, Aufträge für den Dialog nur zum Planen; Monteur 403; ohne Modul 402', async () => {
			await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) });
			const d = (await plantafelLoad({ ...ort(chefA), url: new URL('http://localhost/plantafel?ansicht=team&tag=2026-10-21') } as never)) as any;
			expect(d.tag).toBe('2026-10-21');
			expect(d.woche.tage[0]).toBe('2026-10-19');
			expect(d.woche.einsaetze).toHaveLength(1);
			expect(d.darfPlanen).toBe(true);
			expect(d.auftraege.map((a: any) => a.titel)).toEqual(['Badsanierung']);
			const nurSehen = nutzerVon(chefAId, betriebA, ['auftraege.alle_lesen']);
			const s2 = (await plantafelLoad({ ...ort(nurSehen), url: new URL('http://localhost/plantafel?tag=quatsch') } as never)) as any;
			expect(s2.darfPlanen).toBe(false);
			expect(s2.auftraege).toEqual([]);
			expect(s2.tag).toBe(berlinTag(new Date()));
			const monteur = nutzerVon(aliId, betriebA, VORLAGEN.monteur);
			await expect(plantafelLoad({ ...ort(monteur), url: new URL('http://localhost/plantafel') } as never)).rejects.toMatchObject({ status: 403 });
			const chefC = nutzerVon(chefCId, betriebC, VORLAGEN.chef);
			await expect(plantafelLoad({ ...ort(chefC), url: new URL('http://localhost/plantafel') } as never)).rejects.toMatchObject({ status: 402 });
		});

		it('Abwesenheiten-Seite: anlegen, Fehler mit Eingaben, löschen; nur mit plantafel.bearbeiten', async () => {
			const r = (await abwAktionen.anlegen({
				...ort(chefA),
				request: formAnfrage({ benutzerId: aliId, art: 'urlaub', von: '2026-12-21', bis: '2026-12-31', notiz: '' })
			} as never)) as any;
			expect(r).toEqual({ angelegt: true });
			const f = (await abwAktionen.anlegen({
				...ort(chefA),
				request: formAnfrage({ benutzerId: aliId, art: 'urlaub', von: '2026-12-21', bis: '2026-12-01' })
			} as never)) as any;
			expect(f.status).toBe(400);
			expect(f.data.werte).toMatchObject({ von: '2026-12-21' });
			const [z] = await root`select id from app.abwesenheiten`;
			const monteur = nutzerVon(aliId, betriebA, VORLAGEN.monteur);
			await expect(abwLoad(ort(monteur) as never)).rejects.toMatchObject({ status: 403 });
			expect(((await abwAktionen.loeschen({ ...ort(monteur), request: formAnfrage({ id: z.id }) } as never)) as any).status).toBe(403);
			const buero = nutzerVon(chefAId, betriebA, VORLAGEN.buero);
			const l = (await abwLoad(ort(buero) as never)) as any;
			expect(l.abwesenheiten.map((a: any) => a.von)).toEqual(['2026-12-21']);
			expect(await abwAktionen.loeschen({ ...ort(chefA), request: formAnfrage({ id: z.id }) } as never)).toBeUndefined();
			expect(await root`select 1 from app.abwesenheiten`).toHaveLength(0);
		});
	});

	describe('Gesamtprüfung', () => {
		it('PATCH auf Mitarbeiter oder Auftrag eines anderen Betriebs → 400, Einsatz unverändert', async () => {
			const e = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-21', 8), ende: um('2026-10-21', 12) });
			expect((await fehlerVon(aendereEinsatz(kA(), e.id, { benutzerId: chefBId })))?.status).toBe(400);
			expect((await fehlerVon(aendereEinsatz(kA(), e.id, { auftragId: auftragB })))?.status).toBe(400);
			const [z] = await root`select benutzer_id, auftrag_id from app.einsaetze where id = ${e.id}`;
			expect(z).toEqual({ benutzer_id: aliId, auftrag_id: auftragA });
		});

		it('ladeWoche: Warnungen berücksichtigen Einsätze und Abwesenheiten nach dem Sonntag', async () => {
			const nacht = await legeEinsatzAn(kA(), {
				auftragId: auftragA,
				benutzerId: aliId,
				beginn: um('2026-10-25', 22),
				ende: um('2026-10-26', 6)
			});
			const montag = await legeEinsatzAn(kA(), { auftragId: auftragA, benutzerId: aliId, beginn: um('2026-10-26', 1), ende: um('2026-10-26', 3) });
			const krank = await legeAbwesenheitAn(kA(), { benutzerId: aliId, art: 'krank', von: '2026-10-26', bis: '2026-10-26' });
			const w = await ladeWoche(kA(), '2026-10-21');
			const e = w.einsaetze.find((x) => x.id === nacht.id)!;
			expect(e.warnungen).toEqual(
				expect.arrayContaining([
					{ art: 'doppelt', einsatzId: montag.id },
					{ art: 'krank', abwesenheitId: krank.id }
				])
			);
			// die Abwesenheit der Folgewoche wird nicht als Abwesenheit dieser Woche angezeigt
			expect(w.abwesenheiten.map((a) => a.id)).not.toContain(krank.id);
			expect(w.einsaetze.map((x) => x.id)).not.toContain(montag.id);
		});
	});
});
