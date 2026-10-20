import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';
import { zeitraum } from '../../src/lib/kennzahlen';
import {
	angebotsKennzahlen,
	auftragsKennzahlen,
	cockpit,
	kennzahlenZugriff,
	kundenKennzahlen,
	vorlagenAufgabenZeiten
} from '../../src/lib/server/kennzahlen';

/** Kennzahlen (Jamil msgs 2799, 2801, 2803, 2858): Fakten aus der Datenbank, Sicht, Rechte, Zeitmessung. */
describe('Kennzahlen', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const ALLE = () => ({ alle: true, benutzerId: u.ids.chefA });
	const GESAMT = zeitraum('alle', '2026-10-21');
	let fertig: string;
	let offen: string;

	async function angebot(auftrag: string, status: 'entwurf' | 'versendet' | 'angenommen' | 'abgelehnt', netto: { menge: number; preis: number }, extra: { vorgaenger?: string; gueltig?: string } = {}) {
		const [a] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, datum, gueltig_bis, vorgaenger_id)
			values (${u.betriebA}, ${auftrag}, 'entwurf', '2026-10-01', ${extra.gueltig ?? '2027-12-31'}, ${extra.vorgaenger ?? null}) returning id`;
		await root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
			values (${u.betriebA}, ${a.id}, 1, 'Leistung', ${netto.menge}, 'Stk', ${netto.preis})`;
		if (status !== 'entwurf') await root`update app.angebote set status = 'versendet', versendet_am = '2026-10-03T08:00:00+02:00' where id = ${a.id}`;
		if (status === 'angenommen' || status === 'abgelehnt') await root`update app.angebote set status = ${status} where id = ${a.id}`;
		return a.id as string;
	}

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		fertig = await u.neuerAuftrag('in_arbeit', 'Bad fertig');
		offen = await u.neuerAuftrag('beauftragt', 'Küche offen');
		await root`update app.auftraege set angelegt = '2026-10-01T08:00:00+02:00' where id in (${fertig}, ${offen})`;
		// 2,5 × 1.000,01 € = 2.500,025 € → kaufmännisch 2.500,03 €
		await angebot(fertig, 'angenommen', { menge: 2.5, preis: 100_001 });
		const v1 = await angebot(offen, 'versendet', { menge: 1, preis: 50_000 });
		await angebot(offen, 'abgelehnt', { menge: 1, preis: 40_000 }, { vorgaenger: v1 });
		await angebot(u.auftragA, 'entwurf', { menge: 1, preis: 1 });
		// Einsatz des Monteurs nur beim fertigen Auftrag (Sicht), letzter Einsatz am 10.10.
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende)
			values (${u.betriebA}, ${fertig}, ${u.ids.monteurA}, '2026-10-10T07:00:00+02:00', '2026-10-10T16:00:00+02:00')`;
		await root`update app.auftraege set status = 'abgenommen' where id = ${fertig}`;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: Cockpit nur mit „Alle Aufträge ansehen“; Beträge nur mit „Preise sehen“', async () => {
		await expect(kennzahlenZugriff({ nutzer: u.monteurA })).rejects.toMatchObject({ status: 403 });
		expect((await kennzahlenZugriff({ nutzer: u.chefA })).preise).toBe(true);
		expect((await kennzahlenZugriff({ nutzer: u.ohnePreiseA })).preise).toBe(false);
	});

	it('Angebote: Netto kaufmännisch gerundet, Entscheidung aus dem Verlauf, ersetzte Fassung zählt nicht', async () => {
		const r = await angebotsKennzahlen(kA(), ALLE(), GESAMT, true, '2026-10-21');
		expect(r).toMatchObject({ entwurf: 1, offen: 0, angenommen: 1, abgelehnt: 1, summeAngenommenCent: 250_003 });
		// abgegeben: angenommen + abgelehnt (v1 ist ersetzt) → 1 von 2
		expect(r.quote).toMatchObject({ zaehler: 1, nenner: 2 });
		const ohne = await angebotsKennzahlen(kA(), ALLE(), GESAMT, false, '2026-10-21');
		expect(ohne.summeAngenommenCent).toBeNull();
	});

	it('Kunden und Aufträge in der Sicht: der Monteur sieht nur seinen Auftrag', async () => {
		const chef = await auftragsKennzahlen(kA(), ALLE(), GESAMT, true);
		expect(chef.jeStatus).toMatchObject({ abgenommen: 1, beauftragt: 1 });
		expect(chef.wertOffenCent).toBe(250_003);
		const monteur = { alle: false, benutzerId: u.ids.monteurA };
		const m = await auftragsKennzahlen({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, monteur, GESAMT, false);
		expect(Object.values(m.jeStatus).reduce((s, n) => s + n, 0)).toBe(1);
		expect(m.wertOffenCent).toBeNull();
		const k = await kundenKennzahlen(kA(), ALLE(), GESAMT, { angebote: true }, '2026-10-21');
		expect(k).toMatchObject({ kundenAktiv: 1, kundenMitAngenommen: 1, kundenMitAbgelehnt: 1 });
		expect((await kundenKennzahlen(kA(), ALLE(), GESAMT, { angebote: false })).kundenMitAngenommen).toBeNull();
	});

	it('Cockpit: alle sieben Kennzahlen; Zahlungsdauer „Daten fehlen“; Umsatz ohne Preise gesperrt; Nacharbeit je Person', async () => {
		await root`insert into app.zeit_eintraege (betrieb_id, benutzer_id, auftrag_id, art, beginn, ende, manuell, korrektur_grund, nacharbeit) values
			(${u.betriebA}, ${u.ids.monteurA}, ${fertig}, 'arbeit', '2026-10-09T07:00:00+02:00', '2026-10-09T15:00:00+02:00', true, 'Test', false),
			(${u.betriebA}, ${u.ids.chefA}, ${fertig}, 'arbeit', '2026-10-09T07:00:00+02:00', '2026-10-09T09:00:00+02:00', true, 'Test', true)`;
		const l = await cockpit(kA(), GESAMT, true);
		const by = Object.fromEntries(l.map((x) => [x.id, x]));
		expect(l).toHaveLength(7);
		expect(by.zahlungsdauer).toMatchObject({ wert: null, fehlt: expect.stringMatching(/Lexware/) });
		// 2 h Nacharbeit von 10 h (gleichzeitig, aber zwei Personen)
		expect(by.nacharbeit.wert).toBeCloseTo(0.2, 5);
		expect(by.nacharbeit.ampel).toBe('rot');
		expect(by.umsatz_mitarbeiter.fehlt).toMatch(/keine Mitarbeiter/);
		// Abgenommen heute, letzter Einsatz am 10.10. → nicht termingerecht
		expect(by.termintreue).toMatchObject({ zaehler: 0, nenner: 1 });
		expect(by.durchlaufzeit.wert).toBeGreaterThan(0);
		const ohne = Object.fromEntries((await cockpit(kA(), GESAMT, false)).map((x) => [x.id, x]));
		expect(ohne.umsatz_mitarbeiter).toMatchObject({ wert: null, fehlt: expect.stringMatching(/Preise sehen/) });
	});

	it('Aufgaben: „begonnen“ per Trigger beim ersten „In Arbeit“; Ø Zeiten je Vorlagen-Aufgabe', async () => {
		const [v] = await root`insert into app.auftrag_vorlagen (betrieb_id, name) values (${u.betriebA}, 'Bad') returning id`;
		const [t] = await root`insert into app.todos (betrieb_id, auftrag_id, titel, vorlage_id, vorlage_aufgabe, angelegt)
			values (${u.betriebA}, ${fertig}, 'Fliesen', ${v.id}, 'Fliesen', '2026-10-01T08:00:00Z') returning id, begonnen_am`;
		expect(t.begonnen_am).toBeNull();
		await root`update app.todos set faellig = '2026-10-05' where id = ${t.id}`;
		const [b] = await root`select begonnen_am from app.todos where id = ${t.id}`;
		expect(b.begonnen_am).not.toBeNull();
		await root`update app.todos set begonnen_am = '2026-10-02T08:00:00Z', erledigt_am = '2026-10-04T08:00:00Z' where id = ${t.id}`;
		// direkt erledigt, nie „In Arbeit“: Beginn = Anlegen
		await root`insert into app.todos (betrieb_id, auftrag_id, titel, vorlage_id, vorlage_aufgabe, angelegt, erledigt_am)
			values (${u.betriebA}, ${fertig}, 'fliesen (umbenannt)', ${v.id}, 'FLIESEN', '2026-10-01T08:00:00Z', '2026-10-02T08:00:00Z')`;
		const z = await vorlagenAufgabenZeiten(kA(), v.id);
		expect(z.get('fliesen')).toEqual({ anzahl: 2, erledigt: 2, durchlaufTage: 2, warteTage: 0.5, bearbeitungTage: 1.5 });
		// fremder Betrieb sieht nichts
		expect((await vorlagenAufgabenZeiten({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, v.id)).size).toBe(0);
	});
});
