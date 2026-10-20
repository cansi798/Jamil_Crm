import { describe, expect, it } from 'vitest';
import { ampel, aufgabenZeiten, baueKennzahl, kennzahlText, quote, trend, zeitraum } from '../../src/lib/kennzahlen';
import {
	grenzenVon,
	rechneAbschlussquote,
	rechneAngebote,
	rechneAuftraege,
	rechneDurchlaufzeit,
	rechneKunden,
	rechneNacharbeit,
	rechneProduktivitaet,
	rechneTermintreue,
	rechneUmsatzProMitarbeiter,
	type AngebotFakt,
	type AuftragFakt
} from '../../src/lib/server/kennzahlen';

const d = (s: string) => new Date(s);
const OKT = zeitraum('monat', '2026-10-21');
const G = grenzenVon(OKT.spanne);

let n = 0;
const angebot = (x: Partial<AngebotFakt>): AngebotFakt => ({
	id: `an${++n}`,
	status: 'versendet',
	kundeId: 'k1',
	auftragId: 'a1',
	angelegt: d('2026-10-01T08:00:00Z'),
	abgegebenAm: d('2026-10-02T08:00:00Z'),
	gueltigBis: '2026-11-30',
	angenommenAm: null,
	abgelehntAm: null,
	ersetzt: false,
	nettoCent: 100_000,
	...x
});
const auftrag = (x: Partial<AuftragFakt>): AuftragFakt => ({
	id: `a${++n}`,
	status: 'anfrage',
	kundeId: 'k1',
	quelleId: null,
	angelegt: d('2026-10-01T08:00:00Z'),
	abgenommenAm: null,
	geplantesEnde: null,
	ersterAngebotsVersand: null,
	nachfassenFaellig: false,
	...x
});

describe('Zeiträume', () => {
	it('Monat, Quartal, Jahr mit Vorzeitraum; Jahreswechsel; 12 Monate; Gesamt ohne Grenzen', () => {
		expect(OKT).toMatchObject({ spanne: { von: '2026-10-01', bis: '2026-11-01' }, vorher: { von: '2026-09-01', bis: '2026-10-01' } });
		expect(zeitraum('monat', '2026-01-15').vorher).toEqual({ von: '2025-12-01', bis: '2026-01-01' });
		expect(zeitraum('monat', '2026-12-31').spanne).toEqual({ von: '2026-12-01', bis: '2027-01-01' });
		expect(zeitraum('quartal', '2026-10-21')).toMatchObject({ spanne: { von: '2026-10-01', bis: '2027-01-01' }, vorher: { von: '2026-07-01', bis: '2026-10-01' } });
		expect(zeitraum('quartal', '2026-02-01').vorher).toEqual({ von: '2025-10-01', bis: '2026-01-01' });
		expect(zeitraum('jahr', '2026-10-21').spanne).toEqual({ von: '2026-01-01', bis: '2027-01-01' });
		expect(zeitraum('12monate', '2026-10-21').spanne).toEqual({ von: '2025-10-22', bis: '2026-10-22' });
		expect(zeitraum('alle', '2026-10-21')).toMatchObject({ spanne: null, vorher: null });
	});
});

describe('Ampeln nach Jamils Richtwerten (msg 2858)', () => {
	it('Abschlussquote: < 25 % rot, 25–30 % gelb, 30–50 % grün, über 50 % gelb', () => {
		expect([0.2, 0.25, 0.3, 0.45, 0.5, 0.51].map((w) => ampel('abschlussquote', w))).toEqual(['rot', 'gelb', 'gruen', 'gruen', 'gruen', 'gelb']);
	});
	it('Nacharbeit < 3 % grün, bis 5 % gelb, darüber rot; Zahlungsdauer ≤ 21 grün, < 30 gelb, ab 30 rot; Durchlauf ≤ 5 grün', () => {
		expect([0.02, 0.03, 0.05, 0.06].map((w) => ampel('nacharbeit', w))).toEqual(['gruen', 'gelb', 'gelb', 'rot']);
		expect([14, 21, 25, 30].map((w) => ampel('zahlungsdauer', w))).toEqual(['gruen', 'gruen', 'gelb', 'rot']);
		expect([3, 5, 7, 11].map((w) => ampel('durchlaufzeit', w))).toEqual(['gruen', 'gruen', 'gelb', 'rot']);
	});
	it('ohne Richtwert oder ohne Wert keine Ampel', () => {
		expect(ampel('termintreue', 0.5)).toBeNull();
		expect(ampel('produktivitaet', 1.4)).toBeNull();
		expect(ampel('abschlussquote', null)).toBeNull();
	});
});

describe('Trend, Anzeige, fehlende Daten', () => {
	it('Trend gut/schlecht je nach Richtung; Quote ohne Wertung', () => {
		expect(trend('durchlaufzeit', 4, 6)).toMatchObject({ richtung: 'runter', gut: true });
		expect(trend('nacharbeit', 0.06, 0.02)).toMatchObject({ richtung: 'hoch', gut: false });
		expect(trend('abschlussquote', 0.4, 0.3)).toMatchObject({ richtung: 'hoch', gut: null });
		expect(trend('termintreue', 0.8, 0.8)).toMatchObject({ richtung: 'gleich' });
		expect(trend('termintreue', 0.8, null)).toBeNull();
	});
	it('fehlende Grundlage: kein Wert, keine Ampel, kein Trend', () => {
		const k = baueKennzahl('abschlussquote', { wert: 0, fehlt: 'Daten fehlen: x' }, { wert: 0.3, fehlt: null });
		expect(k).toMatchObject({ wert: null, ampel: null, trend: null, fehlt: 'Daten fehlen: x', vorher: 0.3 });
		expect(quote(1, 0)).toBeNull();
	});
	it('Texte', () => {
		expect(kennzahlText('prozent', 0.375)).toBe('38 %');
		expect(kennzahlText('prozent', 0.025)).toBe('2,5 %');
		expect(kennzahlText('tage', 3.25)).toBe('3,3 Tage');
		expect(kennzahlText('faktor', 1.2)).toBe('120 %');
		expect(kennzahlText('euro', 12_345_678)).toBe('123.457 €');
		expect(kennzahlText('euro', null)).toBe('–');
	});
});

describe('Cockpit-Formeln', () => {
	it('Abschlussquote: angenommene / abgegebene im Zeitraum; Entwürfe, ersetzte und andere Monate zählen nicht', () => {
		const l = [
			angebot({ status: 'angenommen', angenommenAm: d('2026-11-03T08:00:00Z') }), // abgegeben im Oktober, angenommen im November
			angebot({ status: 'abgelehnt' }),
			angebot({}), // noch offen
			angebot({ status: 'angenommen', ersetzt: true }),
			angebot({ status: 'entwurf', abgegebenAm: null }),
			angebot({ status: 'angenommen', abgegebenAm: d('2026-09-30T08:00:00Z') })
		];
		expect(rechneAbschlussquote(l, G)).toMatchObject({ wert: 1 / 3, zaehler: 1, nenner: 3, fehlt: null, hinweis: '1 davon noch ohne Entscheidung' });
		expect(rechneAbschlussquote([], G).fehlt).toMatch(/Daten fehlen/);
	});

	it('Durchlaufzeit: Ø Tage Anlegen → erster Versand (Versand im Zeitraum)', () => {
		const l = [
			auftrag({ angelegt: d('2026-10-01T08:00:00Z'), ersterAngebotsVersand: d('2026-10-03T08:00:00Z') }),
			auftrag({ angelegt: d('2026-10-01T08:00:00Z'), ersterAngebotsVersand: d('2026-10-06T08:00:00Z') }),
			auftrag({ angelegt: d('2026-08-01T08:00:00Z'), ersterAngebotsVersand: d('2026-09-06T08:00:00Z') })
		];
		expect(rechneDurchlaufzeit(l, G)).toMatchObject({ wert: 3.5, nenner: 2 });
		expect(rechneDurchlaufzeit([], G).fehlt).toMatch(/kein Angebot versendet/);
	});

	it('Termintreue: abgenommen bis zum letzten geplanten Einsatz; ohne Einsätze nicht gezählt (Hinweis)', () => {
		const l = [
			auftrag({ abgenommenAm: d('2026-10-10T10:00:00Z'), geplantesEnde: '2026-10-10' }),
			auftrag({ abgenommenAm: d('2026-10-12T10:00:00Z'), geplantesEnde: '2026-10-10' }),
			auftrag({ abgenommenAm: d('2026-10-12T10:00:00Z'), geplantesEnde: null })
		];
		expect(rechneTermintreue(l, G)).toMatchObject({ wert: 0.5, zaehler: 1, nenner: 2, hinweis: expect.stringMatching(/^1 abgenommene/) });
	});

	it('Produktivität: Summe Ist / Summe Plan (nur Aufträge mit beidem)', () => {
		const a1 = auftrag({ abgenommenAm: d('2026-10-10T10:00:00Z') });
		const a2 = auftrag({ abgenommenAm: d('2026-10-11T10:00:00Z') });
		const a3 = auftrag({ abgenommenAm: d('2026-10-11T10:00:00Z') });
		const m = new Map([
			[a1.id, { planMin: 600, istMin: 900 }],
			[a2.id, { planMin: 600, istMin: 300 }],
			[a3.id, { planMin: 0, istMin: 500 }]
		]);
		expect(rechneProduktivitaet([a1, a2, a3], m, G)).toMatchObject({ wert: 1, zaehler: 20, nenner: 20 });
	});

	it('Nacharbeit und Umsatz pro Mitarbeiter (nur mit Preisen, nie durch 0)', () => {
		expect(rechneNacharbeit(6000, 120, true)).toMatchObject({ wert: 0.02, hinweis: null });
		expect(rechneNacharbeit(0, 0, false).fehlt).toMatch(/keine erfasste Arbeitszeit/);
		expect(rechneNacharbeit(600, 0, false).hinweis).toMatch(/Nacharbeit/);
		const l = [angebot({ status: 'angenommen', angenommenAm: d('2026-10-05T08:00:00Z'), nettoCent: 300_000 }), angebot({ status: 'angenommen', angenommenAm: d('2026-09-05T08:00:00Z') })];
		expect(rechneUmsatzProMitarbeiter(l, 3, G, true)).toMatchObject({ wert: 100_000, fehlt: null });
		expect(rechneUmsatzProMitarbeiter(l, 0, G, true).fehlt).toMatch(/keine Mitarbeiter/);
		expect(rechneUmsatzProMitarbeiter(l, 3, G, false)).toMatchObject({ wert: null, fehlt: expect.stringMatching(/Preise sehen/) });
	});
});

describe('Kacheln Kunden / Aufträge / Angebote', () => {
	const heute = '2026-10-21';
	const auftraege = [
		auftrag({ id: 'a1', kundeId: 'k1', status: 'in_arbeit', quelleId: 'q1', nachfassenFaellig: true }),
		auftrag({ id: 'a2', kundeId: 'k2', status: 'abgerechnet', quelleId: 'q1' }),
		auftrag({ id: 'a3', kundeId: 'k3', status: 'anfrage', angelegt: d('2026-09-01T08:00:00Z') })
	];
	const angebote = [
		angebot({ kundeId: 'k1', auftragId: 'a1', status: 'angenommen', angenommenAm: d('2026-10-05T08:00:00Z'), nettoCent: 500_000 }),
		angebot({ kundeId: 'k2', auftragId: 'a2', status: 'angenommen', angenommenAm: d('2026-10-06T08:00:00Z'), nettoCent: 200_000 }),
		angebot({ kundeId: 'k3', auftragId: 'a3', status: 'abgelehnt', abgelehntAm: d('2026-10-07T08:00:00Z') }),
		angebot({ kundeId: 'k3', auftragId: 'a3', status: 'versendet', gueltigBis: '2026-10-15', nettoCent: 50_000 }),
		angebot({ kundeId: 'k3', auftragId: 'a3', status: 'versendet', gueltigBis: '2026-12-01', nettoCent: 70_000 }),
		angebot({ status: 'entwurf', abgegebenAm: null })
	];

	it('Kunden: aktiv = offene Aufträge; angenommen/abgelehnt/abgelaufen je Kunde; ohne Angebotsrechte null', () => {
		expect(rechneKunden(auftraege, angebote, OKT, heute)).toEqual({ kundenAktiv: 2, kundenMitAngenommen: 2, kundenMitAbgelehnt: 1, kundenMitAbgelaufen: 1 });
		expect(rechneKunden(auftraege, null, OKT, heute).kundenMitAngenommen).toBeNull();
	});

	it('Aufträge: je Status (im Zeitraum angelegt), Nachfassen, offener Wert (ohne abgerechnete), je Quelle', () => {
		const r = rechneAuftraege(auftraege, angebote, OKT);
		expect(r.jeStatus).toMatchObject({ in_arbeit: 1, abgerechnet: 1, anfrage: 0 });
		expect(r.nachfassenFaellig).toBe(1);
		expect(r.wertOffenCent).toBe(500_000);
		expect(r.neuJeQuelle).toEqual([{ quelleId: 'q1', anzahl: 2 }]);
		expect(rechneAuftraege(auftraege, null, zeitraum('alle', heute)).wertOffenCent).toBeNull();
		expect(rechneAuftraege(auftraege, null, zeitraum('alle', heute)).jeStatus.anfrage).toBe(1);
	});

	it('Angebote: Stand, Entscheidungen, Summen nur mit Preisen', () => {
		const r = rechneAngebote(angebote, auftraege, OKT, heute, true);
		expect(r).toMatchObject({ entwurf: 1, offen: 1, angenommen: 2, abgelehnt: 1, abgelaufen: 1, summeOffenCent: 70_000, summeAngenommenCent: 700_000, nachfassenFaellig: 1 });
		expect(r.quote).toMatchObject({ zaehler: 2, nenner: 5 });
		expect(r.durchschnittCent).toBe(Math.round((500_000 + 200_000 + 100_000 + 50_000 + 70_000) / 5));
		expect(rechneAngebote(angebote, auftraege, OKT, heute, false)).toMatchObject({ summeOffenCent: null, summeAngenommenCent: null, durchschnittCent: null });
	});
});

describe('Zeitmessung je Vorlagen-Aufgabe', () => {
	it('Ø Durchlauf, Warten, Bearbeitung in Tagen – nur erledigte', () => {
		const z = aufgabenZeiten([
			{ angelegt: '2026-10-01T08:00:00Z', begonnen: '2026-10-02T08:00:00Z', erledigt: '2026-10-04T08:00:00Z' },
			{ angelegt: '2026-10-01T08:00:00Z', begonnen: null, erledigt: '2026-10-02T08:00:00Z' },
			{ angelegt: '2026-10-01T08:00:00Z', begonnen: '2026-10-02T08:00:00Z', erledigt: null }
		]);
		expect(z).toEqual({ anzahl: 3, erledigt: 2, durchlaufTage: 2, warteTage: 0.5, bearbeitungTage: 1.5 });
		expect(aufgabenZeiten([])).toMatchObject({ anzahl: 0, durchlaufTage: null });
	});
});
