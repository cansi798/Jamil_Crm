import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { listeAlleAuftragsbestaetigungen } from '../../src/lib/server/auftragsbestaetigung';
import { listeAngebote } from '../../src/lib/server/angebote';
import { abKennzahlen, speichereKennzahlEinstellungen } from '../../src/lib/server/kennzahlen';
import { speichereAnsicht } from '../../src/lib/server/ansichten';
import { zeitraum } from '../../src/lib/kennzahlen';
import { load as abLoad } from '../../src/routes/(app)/ausgangsbelege/auftragsbestaetigungen/+page.server';
import { load as reLoad } from '../../src/routes/(app)/ausgangsbelege/rechnungen/+page.server';
import { load as angLoad } from '../../src/routes/(app)/ausgangsbelege/angebote/+page.server';
import { load as bereichLoad } from '../../src/routes/(app)/ausgangsbelege/+page.server';
import { GET as altGet } from '../../src/routes/(app)/angebote/+server';

/** Ausgangsbelege (Jamil msg 2948): Reiter Angebote / Auftragsbestätigungen / Rechnungen, Umleitung von /angebote. */
describe('Ausgangsbelege', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let anOhne: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const GESAMT = zeitraum('alle', '2026-10-21');

	async function angebot(nummer: string, auftragId: string | null, kundeId: string | null, betrieb = u.betriebA): Promise<string> {
		const [z] = await root`insert into app.angebote (betrieb_id, nummer, status, gueltig_bis, auftrag_id, kunde_id)
			values (${betrieb}, ${nummer}, 'angenommen', current_date + 30, ${auftragId}, ${kundeId}) returning id`;
		return z.id;
	}
	async function ab(nummer: string, angebotId: string, auftragId: string | null, gesendet: boolean, angelegt: string, betrieb = u.betriebA) {
		await root`insert into app.auftragsbestaetigungen (betrieb_id, angebot_id, auftrag_id, nummer, pdf, versand_status, versendet_am, angelegt)
			values (${betrieb}, ${angebotId}, ${auftragId}, ${nummer}, ${Buffer.from('%PDF-1.4 test')}, ${gesendet ? 'gesendet' : 'bereit'},
				${gesendet ? angelegt : null}, ${angelegt})`;
	}
	const fehler = async (fn: () => unknown) => {
		try {
			await fn();
		} catch (e) {
			return e as { status: number; location?: string };
		}
		throw new Error('kein Fehler/Redirect');
	};

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		const auftragC = await u.neuerAuftrag('beauftragt', 'Bad Meier');
		await ab('AB-2026-0001', await angebot('AN-T-1', u.auftragA, null), u.auftragA, false, '2026-10-05T10:00:00+02:00');
		await ab('AB-2026-0002', await angebot('AN-T-2', auftragC, null), auftragC, true, '2026-09-10T10:00:00+02:00');
		anOhne = await angebot('AN-T-3', null, u.kundeA);
		await ab('AB-2026-0003', anOhne, null, false, '2026-10-06T10:00:00+02:00');
		// anderer Betrieb – nie sichtbar
		await ab('AB-2026-0009', await angebot('AN-T-9', u.auftragB, null, u.betriebB), u.auftragB, false, '2026-10-06T10:00:00+02:00', u.betriebB);
		// Monteur ist nur für auftragC zuständig
		await root`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${u.betriebA}, ${auftragC}, ${u.ids.monteurA})`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Liste: alle ABs des Betriebs, neueste zuerst, mit Kunde, Auftrag, Status; nie aus anderem Betrieb', async () => {
		const l = await listeAlleAuftragsbestaetigungen(kA(), { alle: true, benutzerId: u.ids.chefA });
		expect(l.map((x) => x.nummer)).toEqual(['AB-2026-0003', 'AB-2026-0001', 'AB-2026-0002']);
		expect(l[0]).toMatchObject({ auftrag: null, angebotId: anOhne, versandStatus: 'bereit', versendetAm: null });
		expect(l[0].kundeName).not.toBe('Ohne Kunde');
		expect(l[2]).toMatchObject({ versandStatus: 'gesendet', auftrag: expect.objectContaining({ titel: 'Bad Meier' }) });
		expect(l[2].versendetAm).not.toBeNull();
	});

	it('Filter Status und Suche (Nummer, Auftrag); Sonderzeichen in der Suche sind harmlos', async () => {
		const alle = { alle: true, benutzerId: u.ids.chefA };
		expect((await listeAlleAuftragsbestaetigungen(kA(), alle, { status: 'gesendet' })).map((x) => x.nummer)).toEqual(['AB-2026-0002']);
		expect((await listeAlleAuftragsbestaetigungen(kA(), alle, { status: 'bereit' })).map((x) => x.nummer)).toEqual(['AB-2026-0003', 'AB-2026-0001']);
		expect((await listeAlleAuftragsbestaetigungen(kA(), alle, { suche: 'meier' })).map((x) => x.nummer)).toEqual(['AB-2026-0002']);
		expect((await listeAlleAuftragsbestaetigungen(kA(), alle, { suche: '0001' })).map((x) => x.nummer)).toEqual(['AB-2026-0001']);
		expect(await listeAlleAuftragsbestaetigungen(kA(), alle, { suche: "%_'\\" })).toEqual([]);
	});

	it('Sicht: eigene Aufträge nur deren ABs; ABs ohne Auftrag nur mit „Alle Aufträge ansehen“', async () => {
		const l = await listeAlleAuftragsbestaetigungen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA });
		expect(l.map((x) => x.nummer)).toEqual(['AB-2026-0002']);
		const kz = await abKennzahlen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, GESAMT);
		expect(kz).toMatchObject({ bereit: 0, versendet: 1, erstellt: 1 });
	});

	it('RLS: im Kontext von Betrieb B nur dessen AB', async () => {
		const l = await listeAlleAuftragsbestaetigungen({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, { alle: true, benutzerId: u.ids.chefB });
		expect(l.map((x) => x.nummer)).toEqual(['AB-2026-0009']);
	});

	it('Kacheln: bereit/versendet/erstellt, Einstellungen (aus, „Erfassen ab“) wirken', async () => {
		const alle = { alle: true, benutzerId: u.ids.chefA };
		expect(await abKennzahlen(kA(), alle, GESAMT)).toMatchObject({ bereit: 2, versendet: 1, erstellt: 3, aus: [] });
		await speichereKennzahlEinstellungen(kA(), { ab_bereit: { aktiv: false }, ab_erstellt: { aktiv: true, ab: '2026-10-01' } }, '2026-10-21');
		const kz = await abKennzahlen(kA(), alle, GESAMT);
		expect(kz).toMatchObject({ bereit: 0, erstellt: 2, aus: ['ab_bereit'] });
		expect(kz.seit.ab_erstellt).toBe('erfasst seit 01.10.2026');
		await root`delete from app.kennzahl_einstellungen where betrieb_id = ${u.betriebA}`;
	});

	it('Seiten: Rechte wie Angebote (Preise sehen); Monteur und ohne Preise → 403', async () => {
		const url = new URL('http://t/ausgangsbelege/auftragsbestaetigungen?status=bereit&suche=AB');
		const d = (await abLoad({ locals: { nutzer: u.chefA }, url } as never)) as { abs: { nummer: string }[]; status: string; kennzahlen: unknown };
		expect(d.status).toBe('bereit');
		expect(d.abs.map((x) => x.nummer)).toEqual(['AB-2026-0003', 'AB-2026-0001']);
		expect(d.kennzahlen).not.toBeNull();
		for (const n of [u.monteurA, u.ohnePreiseA]) {
			expect(await fehler(() => abLoad({ locals: { nutzer: n }, url } as never))).toMatchObject({ status: 403 });
			expect(await fehler(() => reLoad({ locals: { nutzer: n }, url: new URL('http://t/ausgangsbelege/rechnungen') } as never))).toMatchObject({ status: 403 });
		}
		// Rechnungen: gleicher Rahmen wie die anderen Reiter (Zeitraum, Kacheln an/aus), aber keine Daten
		expect(await reLoad({ locals: { nutzer: u.chefA }, url: new URL('http://t/ausgangsbelege/rechnungen?zeitraum=jahr') } as never)).toEqual({ zeitraum: 'jahr', kennzahlenAn: expect.any(Boolean) });
		const a = (await angLoad({ locals: { nutzer: u.chefA }, url: new URL('http://t/ausgangsbelege/angebote') } as never)) as { angebote: unknown[] };
		expect(a.angebote.length).toBe(3);
		// Suche auch bei Angeboten (Jamil msg 3056) – gleicher Parameter wie bei den ABs
		const g = (await angLoad({ locals: { nutzer: u.chefA }, url: new URL('http://t/ausgangsbelege/angebote?suche=meier') } as never)) as { angebote: { nummer: string }[]; suche: string };
		expect(g.suche).toBe('meier');
		expect(g.angebote.map((x) => x.nummer)).toEqual(['AN-T-2']);
	});

	it('Angebote: Suche nach Nummer, Auftrag (Titel) und Kunde; Sonderzeichen harmlos', async () => {
		expect((await listeAngebote(kA(), { suche: 'meier' })).map((x) => x.nummer)).toEqual(['AN-T-2']);
		expect((await listeAngebote(kA(), { suche: 'an-t-3' })).map((x) => x.nummer)).toEqual(['AN-T-3']);
		expect(await listeAngebote(kA(), { suche: "%_'\\" })).toEqual([]);
		expect((await listeAngebote(kA(), { suche: '   ' })).length).toBe(3);
	});

	it('Umleitungen: /angebote (mit Filtern) → /ausgangsbelege/angebote; /ausgangsbelege → erster Reiter', async () => {
		expect(await fehler(() => altGet({ url: new URL('http://t/angebote?status=versendet&zeitraum=jahr') } as never))).toMatchObject({
			status: 308,
			location: '/ausgangsbelege/angebote?status=versendet&zeitraum=jahr'
		});
		expect(await fehler(() => altGet({ url: new URL('http://t/angebote') } as never))).toMatchObject({ status: 308, location: '/ausgangsbelege/angebote' });
		expect(await fehler(() => bereichLoad({ url: new URL('http://t/ausgangsbelege') } as never))).toMatchObject({ status: 307, location: '/ausgangsbelege/angebote' });
	});

	it('Gespeicherte Ansichten auch für die neuen Reiter (Migration 097)', async () => {
		const v = await speichereAnsicht(kA(), u.chefA, { seite: 'auftragsbestaetigungen', name: 'Offen', query: '?status=bereit' });
		expect(v).toMatchObject({ seite: 'auftragsbestaetigungen', query: 'status=bereit' });
		await expect(root`insert into app.gespeicherte_ansichten (betrieb_id, benutzer_id, seite, name, query) values (${u.betriebA}, ${u.ids.chefA}, 'quatsch', 'x', '')`).rejects.toThrow(/seite_check/);
		await root`delete from app.gespeicherte_ansichten where betrieb_id = ${u.betriebA}`;
	});
});
