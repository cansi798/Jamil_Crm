import { describe, expect, it } from 'vitest';
import { STARTVORLAGEN } from '../../src/lib/protokoll-startvorlagen';
import {
	alleFelder,
	aufmassMengen,
	auswerten,
	berechne,
	bereinigeAntworten,
	expandiere,
	fehlendeFelder,
	mitWiederholung,
	ohneLetzteWiederholung,
	pruefeSchema,
	wertText,
	type Schema
} from '../../src/lib/protokoll-formular';

const KAT_FLIESE = '11111111-1111-4111-8111-111111111111';
const KAT_SOCKEL = '22222222-2222-4222-8222-222222222222';

/** Kleines Bad-Aufmaß: je Raum L, B, H, Abzug → Wand (Formel), Boden (Fläche aus L×B); außerhalb Summe aller Wände. */
const BAD = (): Schema =>
	pruefeSchema({
		seiten: [
			{
				id: 's1',
				titel: 'Räume',
				abschnitte: [
					{
						id: 'raum',
						wiederholbar: true,
						wiederholName: 'Raum',
						felder: [
							{ id: 'name', typ: 'text', label: 'Raumname' },
							{ id: 'l', typ: 'mass', label: 'Länge', kuerzel: 'L', pflicht: true },
							{ id: 'b', typ: 'mass', label: 'Breite', kuerzel: 'B', pflicht: true },
							{ id: 'h', typ: 'mass', label: 'Höhe', kuerzel: 'H' },
							{ id: 'abz', typ: 'abzug', label: 'Abzug Tür/Fenster', kuerzel: 'abzug' },
							{ id: 'wand', typ: 'formel', label: 'Wandfläche', kuerzel: 'wand', einheit: 'm²', formel: '(2*(L+B))*H - abzug' },
							{ id: 'boden', typ: 'flaeche', label: 'Bodenfläche', kuerzel: 'boden', formel: 'L*B', katalog: { positionId: KAT_FLIESE, menge: 'boden * 1,1' } },
							{ id: 'sockel', typ: 'umfang', label: 'Sockel', formel: '2*(L+B)', katalog: { positionId: KAT_SOCKEL } }
						]
					}
				]
			},
			{
				id: 's2',
				titel: 'Summe',
				abschnitte: [{ id: 'gesamt', felder: [{ id: 'wandges', typ: 'formel', label: 'Wände gesamt', einheit: 'm²', formel: 'summe(wand)', katalog: { positionId: KAT_FLIESE } }] }]
			}
		]
	});

describe('Aufmaß-Vorlagen (Jamil msg 2842) – Prüfen', () => {
	it('gültige Vorlage mit Raum-Gruppe, Kürzeln, Formeln und Katalog', () => {
		const s = BAD();
		expect(s.seiten[0].abschnitte[0]).toMatchObject({ wiederholbar: true, wiederholName: 'Raum' });
		expect(alleFelder(s).find((x) => x.feld.id === 'boden')!.feld.katalog).toEqual({ positionId: KAT_FLIESE, menge: 'boden * 1,1' });
	});

	const mit = (felder: unknown[], extra: unknown[] = []) => () =>
		pruefeSchema({ seiten: [{ id: 's', titel: 'S', abschnitte: [{ id: 'a', felder }, ...extra] }] });
	it('Fehler: unbekannter Name, kein Zahlenfeld, Kreis, doppeltes Kürzel, kaputte Formel, Formel fehlt', () => {
		expect(mit([{ id: 'x', typ: 'formel', label: 'X', formel: 'L * 2' }])).toThrow(/„L“ ist kein Feld/);
		expect(mit([{ id: 't', typ: 'text', label: 'Name', kuerzel: 'T' }, { id: 'x', typ: 'formel', label: 'X', formel: 'T * 2' }])).toThrow(/kein Zahlenfeld/);
		expect(mit([{ id: 'a1', typ: 'formel', label: 'A', kuerzel: 'A', formel: 'B + 1' }, { id: 'b1', typ: 'formel', label: 'B', kuerzel: 'B', formel: 'A * 2' }])).toThrow(/Kreis/);
		expect(mit([{ id: 'x', typ: 'mass', label: 'X', kuerzel: 'L' }, { id: 'y', typ: 'mass', label: 'Y', kuerzel: 'l' }])).toThrow(/doppelt/);
		expect(mit([{ id: 'x', typ: 'formel', label: 'X', formel: '(1 + ' }])).toThrow(/„\)“ fehlt|zu früh/);
		expect(mit([{ id: 'x', typ: 'formel', label: 'X' }])).toThrow(/Formel fehlt/);
		expect(mit([{ id: 'x', typ: 'mass', label: 'X', einheit: 'km' }])).toThrow(/m, cm oder mm/);
		expect(mit([{ id: 'x', typ: 'mass', label: 'X', kuerzel: '1L' }])).toThrow(/Kürzel/);
		expect(mit([{ id: 'x', typ: 'mass', label: 'X', katalog: { positionId: 'nein' } }])).toThrow(/Katalogposition/);
	});

	it('Reichweite: Raum-Felder von außen nur mit summe(…); summe nur für Raum-Felder', () => {
		const raum = { id: 'r', wiederholbar: true, felder: [{ id: 'l', typ: 'mass', label: 'L', kuerzel: 'L' }] };
		expect(() => pruefeSchema({ seiten: [{ id: 's', titel: 'S', abschnitte: [raum, { id: 'g', felder: [{ id: 'x', typ: 'formel', label: 'X', formel: 'L * 2' }] }] }] })).toThrow(/summe\(L\)/);
		expect(() => pruefeSchema({ seiten: [{ id: 's', titel: 'S', abschnitte: [{ id: 'g', felder: [{ id: 'm', typ: 'mass', label: 'M', kuerzel: 'M' }, { id: 'x', typ: 'formel', label: 'X', formel: 'summe(M)' }] }] }] })).toThrow(/nur für Felder in wiederholbaren/);
	});
});

describe('Aufmaß-Vorlagen – Räume und Rechnen', () => {
	const zweiRaeume = {
		_anzahl_raum: 2,
		name: 'Bad',
		l: 3,
		b: 2,
		h: 2.5,
		abz: 1.6,
		name__2: 'Gäste-WC',
		l__2: 1.5,
		b__2: 1,
		h__2: 2.5
	};

	it('expandiere: zwei Räume mit eigenen IDs, Titeln und aufgelösten Formeln; idempotent', () => {
		const e = expandiere(BAD(), zweiRaeume);
		const ab = e.seiten[0].abschnitte;
		expect(ab.map((a) => [a.id, a.titel, a.wdh?.nr])).toEqual([['raum', 'Raum 1', 1], ['raum__2', 'Raum 2', 2]]);
		const wand2 = ab[1].felder.find((f) => f.id === 'wand__2')!;
		expect(wand2.formel).toBe('(((2 * (l__2 + b__2)) * h__2) - abz__2)');
		expect(alleFelder(e).find((x) => x.feld.id === 'wandges')!.feld.formel).toBe('summe(wand, wand__2)');
		expect(expandiere(e, zweiRaeume)).toBe(e);
	});

	it('berechne: Wand, Boden, Sockel je Raum; Summe über Räume; fehlender Abzug → Wand leer (keine falsche Zahl)', () => {
		const w = berechne(BAD(), zweiRaeume);
		expect(w).toMatchObject({ wand: 23.4, boden: 6, sockel: 10, boden__2: 1.5, sockel__2: 5 });
		expect(w.wand__2).toBeUndefined(); // Abzug in Raum 2 fehlt
		expect(w.wandges).toBe(23.4); // summe zählt vorhandene Werte
		expect(berechne(BAD(), { ...zweiRaeume, abz__2: 0 }).wandges).toBe(23.4 + 12.5);
	});

	it('Katalog-Mengen: über alle Räume summiert, Mengenformel mit Verschnitt', () => {
		const m = aufmassMengen(BAD(), { ...zweiRaeume, abz__2: 0 });
		const fliese = m.find((x) => x.positionId === KAT_FLIESE)!;
		// Boden (6 + 1,5) × 1,1 = 8,25 plus Wände gesamt 35,9
		expect(fliese.menge).toBeCloseTo(8.25 + 35.9, 3);
		expect(fliese.felder).toEqual(['Raum 1: Bodenfläche', 'Raum 2: Bodenfläche', 'Wände gesamt']);
		expect(m.find((x) => x.positionId === KAT_SOCKEL)!.menge).toBe(15);
	});

	it('bereinigeAntworten: berechnete Werte kommen vom Server (Eingabe ignoriert), Anzahl begrenzt, Stück ganzzahlig', () => {
		const b = bereinigeAntworten(BAD(), { ...zweiRaeume, wand: 9999, _anzahl_raum: 2, l__3: 5, fremd: 1 });
		expect(b.wand).toBe(23.4);
		expect(b.l__3).toBeUndefined(); // Raum 3 gibt es nicht
		expect(b.fremd).toBeUndefined();
		expect(bereinigeAntworten(BAD(), { _anzahl_raum: 999 })._anzahl_raum).toBeUndefined();
		const st = pruefeSchema({ seiten: [{ id: 's', titel: 'S', abschnitte: [{ id: 'a', felder: [{ id: 'n', typ: 'stueck', label: 'Anzahl' }] }] }] });
		expect(bereinigeAntworten(st, { n: '2,6' }).n).toBe(3);
	});

	it('Pflicht und Meldungen je Raum; berechnete Felder sind nie Pflicht', () => {
		const f = fehlendeFelder(BAD(), { _anzahl_raum: 2, l: 3, b: 2 });
		expect(f.map((x) => x.label)).toEqual(['Raum 2: Länge', 'Raum 2: Breite']);
		const z = auswerten(BAD(), { _anzahl_raum: 2 });
		expect(z.get('wand__2')).toEqual({ sichtbar: true, pflicht: false });
	});

	it('+ Raum / letzten Raum entfernen (mit seinen Antworten); Anzeige mit Einheit', () => {
		expect(mitWiederholung({}, 'raum')).toEqual({ _anzahl_raum: 2 });
		const weg = ohneLetzteWiederholung(BAD(), zweiRaeume, 'raum');
		expect(weg._anzahl_raum).toBe(1);
		expect(weg.l__2).toBeUndefined();
		expect(weg.l).toBe(3);
		expect(ohneLetzteWiederholung(BAD(), { l: 1 }, 'raum')).toEqual({ l: 1 });
		const wand = alleFelder(BAD()).find((x) => x.feld.id === 'wand')!.feld;
		expect(wertText(wand, 23.4)).toBe('23,4 m²');
		expect(wertText(alleFelder(BAD()).find((x) => x.feld.id === 'l')!.feld, 3)).toBe('3 m');
	});
});

describe('Startvorlagen „Aufmaß Bad“ und „Aufmaß Boden/Fliesen“', () => {
	it('sind gültig und rechnen: Bad mit zwei Räumen und 10 % Verschnitt', () => {
		const bad = pruefeSchema(STARTVORLAGEN.find((v) => v.schluessel === 'aufmass-bad')!.schema);
		const w = berechne(bad, {
			verschnitt: 10,
			_anzahl_a_raum: 2,
			raum_l: 2, raum_b: 2, raum_h: 2.5, raum_fh: 2, raum_abzug: 1,
			raum_l__2: 1, raum_b__2: 1, raum_h__2: 2.5, raum_fh__2: 1, raum_abzug__2: 0
		});
		expect(w).toMatchObject({ raum_boden: 4, raum_wand: 15, raum_boden__2: 1, raum_wand__2: 4, summe_boden: 5, summe_wand: 19, summe_umfang: 12 });
		expect(w.summe_fliesen).toBeCloseTo(26.4, 5);
	});
	it('Boden/Fliesen: Fläche minus Abzug, Sockel minus Türen', () => {
		const boden = pruefeSchema(STARTVORLAGEN.find((v) => v.schluessel === 'aufmass-boden')!.schema);
		const w = berechne(boden, { verschnitt: 5, raum_l: 5, raum_b: 4, raum_abzug: 0.5, raum_tueren: 0.9 });
		expect(w).toMatchObject({ raum_flaeche: 19.5, raum_sockel: 17.1, summe_flaeche: 19.5 });
		expect(w.summe_belag).toBeCloseTo(20.48, 2);
	});
});
