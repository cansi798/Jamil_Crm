import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { listeKolonnen, loescheKolonne, speichereKolonne } from '../../src/lib/server/kolonnen';
import { aendereGruppenEnde, gruppenTage, ladeWoche, legeGruppeAn, loescheGruppe, verschiebeGruppe } from '../../src/lib/server/plantafel';
import { listeAuftraege } from '../../src/lib/server/auftraege';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Plantafel: Kolonnen und mehrtägige Termine (Jamil msgs 2510, 2513). */
describe('Kolonnen und mehrtägige Termine', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const tage = async (gruppeId: string) =>
		(await root`select to_char(beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as b, benutzer_id from app.einsaetze where gruppe_id = ${gruppeId} order by beginn, benutzer_id`) as any[];

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.einsaetze`;
		await root`delete from app.kolonnen`;
	});

	it('gruppenTage: ohne Wochenende', () => {
		expect(gruppenTage('2026-10-23', '2026-10-27', true)).toEqual(['2026-10-23', '2026-10-26', '2026-10-27']); // Fr, Mo, Di
		expect(gruppenTage('2026-10-24', '2026-10-25', false)).toEqual(['2026-10-24', '2026-10-25']);
	});

	it('Kolonne anlegen (Führer wird Mitglied), Name eindeutig, Betrieb B sieht nichts', async () => {
		const ko = await speichereKolonne(kA(), null, { name: 'Kolonne A', leiterId: u.ids.bueroA, mitglieder: [u.ids.monteurA], fahrzeug: 'HH-BW 123' });
		expect(ko).toMatchObject({ name: 'Kolonne A', leiterName: 'Büro A', fahrzeug: 'HH-BW 123' });
		expect(ko.mitglieder.map((m) => m.name).sort()).toEqual(['Ali Monteur', 'Büro A']);
		await expect(speichereKolonne(kA(), null, { name: ' kolonne a ' })).rejects.toMatchObject({ status: 409 });
		await expect(speichereKolonne(kA(), null, { name: 'X', mitglieder: [u.ids.chefB] })).rejects.toMatchObject({ status: 400 });
		expect(await listeKolonnen(kB())).toEqual([]);
		await expect(loescheKolonne(kB(), ko.id)).rejects.toMatchObject({ status: 404 });
	});

	it('mehrtägig: je Arbeitstag ein Einsatz mit Tageszeiten; eine Gruppe; verschieben, verlängern, kürzen, löschen', async () => {
		const g = await legeGruppeAn(kA(), {
			auftragId: u.auftragA,
			benutzerIds: [u.ids.monteurA],
			vonTag: '2026-10-23',
			bisTag: '2026-10-27',
			vonZeit: '07:30',
			bisZeit: '15:00'
		});
		expect((await tage(g.gruppeId)).map((t) => t.b)).toEqual(['2026-10-23 07:30', '2026-10-26 07:30', '2026-10-27 07:30']);
		expect(g.einsaetze[0].gruppe).toEqual({ id: g.gruppeId, vonTag: '2026-10-23', bisTag: '2026-10-27' });
		await verschiebeGruppe(kA(), g.gruppeId, 7);
		expect((await tage(g.gruppeId)).map((t) => t.b)).toEqual(['2026-10-30 07:30', '2026-11-02 07:30', '2026-11-03 07:30']);
		await aendereGruppenEnde(kA(), g.gruppeId, '2026-11-05');
		expect((await tage(g.gruppeId)).map((t) => t.b.slice(0, 10))).toEqual(['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
		await aendereGruppenEnde(kA(), g.gruppeId, '2026-11-02');
		expect((await tage(g.gruppeId)).map((t) => t.b.slice(0, 10))).toEqual(['2026-10-30', '2026-11-02']);
		await expect(aendereGruppenEnde(kA(), g.gruppeId, '2026-10-01')).rejects.toMatchObject({ status: 400 });
		await expect(verschiebeGruppe(kB(), g.gruppeId, 1)).rejects.toMatchObject({ status: 404 });
		expect(await loescheGruppe(kA(), g.gruppeId)).toBe(2);
	});

	it('Kolonne einplanen: Einsatz je Mitglied; Mitglieder sehen den Auftrag unter „Meine“; Woche zeigt Kolonne', async () => {
		const ko = await speichereKolonne(kA(), null, { name: 'Kolonne A', mitglieder: [u.ids.monteurA, u.ids.bueroA] });
		const g = await legeGruppeAn(kA(), { auftragId: u.auftragA, kolonneId: ko.id, vonTag: '2026-10-26', bisTag: '2026-10-27' });
		expect(await tage(g.gruppeId)).toHaveLength(4);
		expect(g.einsaetze.every((e) => e.kolonne?.name === 'Kolonne A')).toBe(true);
		const meine = await listeAuftraege({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, {});
		expect(meine.map((a) => a.id)).toContain(u.auftragA);
		const w = await ladeWoche(kA(), '2026-10-26');
		expect(w.einsaetze.filter((e) => e.kolonne).length).toBe(4);
		await expect(legeGruppeAn(kA(), { auftragId: u.auftragA, vonTag: '2026-10-26' })).rejects.toThrow(/Mitarbeiter oder eine Kolonne/);
		await expect(legeGruppeAn(kA(), { auftragId: u.auftragA, benutzerIds: [u.ids.monteurA], vonTag: '2026-10-24', bisTag: '2026-10-25' })).rejects.toThrow(/keine Arbeitstage/);
		await expect(legeGruppeAn(kA(), { auftragId: u.auftragA, benutzerIds: [u.ids.monteurA], vonTag: '2026-10-26', bisTag: '2026-10-20' })).rejects.toThrow(/vor dem ersten/);
	});
});
