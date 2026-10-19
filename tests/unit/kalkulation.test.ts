import { describe, expect, it } from 'vitest';
import {
	berechneMitarbeiter,
	berechneUebersicht,
	tageImJahr,
	wochenendTage,
	type BetriebsWerte,
	type MitarbeiterWerte
} from '../../src/lib/kalkulation';

const BETRIEB: BetriebsWerte = {
	jahr: 2026,
	gemeinkostenCent: 6_000_000, // 60.000 €
	anzahlProduktiv: 4,
	feiertage: 10,
	pufferArt: 'prozent',
	pufferWert: 15,
	gewinnProzent: 10,
	risikoProzent: 5,
	aktuellerSatzCent: null
};

const MA: MitarbeiterWerte = {
	bruttoCent: 4_200_000, // 42.000 €
	agArt: 'prozent',
	agProzent: 21,
	agEuroCent: null,
	wochenstunden: 40,
	urlaubstage: 30,
	krankheitstage: 10
};

describe('Kalender', () => {
	it('Wochenenden des tatsächlichen Jahres und Tage im Jahr (Schaltjahre)', () => {
		expect(wochenendTage(2026)).toBe(104);
		expect(wochenendTage(2028)).toBe(106); // Schaltjahr, beginnt Samstag: 53 Samstage + 53 Sonntage
		expect(wochenendTage(2033)).toBe(105); // beginnt Samstag
		expect(tageImJahr(2026)).toBe(365);
		expect(tageImJahr(2028)).toBe(366);
	});
});

describe('berechneMitarbeiter – Beispiel aus der Anforderung', () => {
	const e = berechneMitarbeiter(BETRIEB, MA);

	it('Schritt 2: produktive Stunden', () => {
		// 365 − 104 Wochenende − 10 Feiertage − 30 Urlaub − 10 Krankheit = 211 Tage
		expect(e.arbeitstage).toBe(211);
		expect(e.stundenProTag).toBe(8);
		expect(e.anwesenheitsStunden).toBe(1688);
		// 15 % Puffer: 253,2 h → 1.434,8 fakturierbare Stunden
		expect(e.pufferStunden).toBe(253.2);
		expect(e.fakturierbareStunden).toBe(1434.8);
	});

	it('Schritt 1: Gesamtkosten = Brutto + AG-Anteil + Gemeinkosten/Anzahl', () => {
		expect(e.agAnteilCent).toBe(882_000); // 21 % von 42.000 € = 8.820 €
		expect(e.personalkostenCent).toBe(5_082_000);
		expect(e.gemeinkostenAnteilCent).toBe(1_500_000); // 60.000 € / 4
		expect(e.gesamtkostenCent).toBe(6_582_000); // 65.820 €
	});

	it('Schritt 3: kostendeckend und empfohlen (kaufmännisch auf Cent gerundet)', () => {
		// 65.820 € / 1.434,8 h = 45,8740…  → 45,87 €
		expect(e.kostendeckendCent).toBe(4587);
		// × (1 + 10 % + 5 %) = 52,7551 € → 52,76 € (aus dem ungerundeten Wert)
		expect(e.aufschlagProzent).toBe(15);
		expect(e.empfohlenCent).toBe(5276);
		expect(e.warnungen).toEqual([]);
	});
});

describe('Varianten und Randfälle', () => {
	it('AG-Anteil in Euro statt Prozent; Puffer in Stunden/Jahr', () => {
		const e = berechneMitarbeiter(
			{ ...BETRIEB, pufferArt: 'stunden', pufferWert: 200 },
			{ ...MA, agArt: 'euro', agProzent: null, agEuroCent: 900_000 }
		);
		expect(e.agAnteilCent).toBe(900_000);
		expect(e.pufferStunden).toBe(200);
		expect(e.fakturierbareStunden).toBe(1488);
	});

	it('Teilzeit (20 h/Woche) → 4 h pro Tag', () => {
		const e = berechneMitarbeiter(BETRIEB, { ...MA, wochenstunden: 20 });
		expect(e.stundenProTag).toBe(4);
		expect(e.anwesenheitsStunden).toBe(844);
	});

	it('100 % Puffer → keine fakturierbaren Stunden, kein Satz, Warnung', () => {
		const e = berechneMitarbeiter({ ...BETRIEB, pufferWert: 100 }, MA);
		expect(e.fakturierbareStunden).toBe(0);
		expect(e.kostendeckendCent).toBeNull();
		expect(e.empfohlenCent).toBeNull();
		expect(e.warnungen.join(' ')).toMatch(/keine fakturierbaren Stunden/);
	});

	it('Puffer in Stunden größer als die Arbeitszeit → 0 Stunden (nicht negativ)', () => {
		const e = berechneMitarbeiter({ ...BETRIEB, pufferArt: 'stunden', pufferWert: 5000 }, MA);
		expect(e.fakturierbareStunden).toBe(0);
		expect(e.kostendeckendCent).toBeNull();
	});

	it('mehr Abwesenheit als Arbeitstage → 0 Arbeitstage, kein Satz', () => {
		const e = berechneMitarbeiter(BETRIEB, { ...MA, urlaubstage: 200, krankheitstage: 100 });
		expect(e.arbeitstage).toBe(0);
		expect(e.kostendeckendCent).toBeNull();
	});

	it('0 produktive Mitarbeiter: mit Gemeinkosten kein Satz (Warnung), ohne Gemeinkosten rechnet er', () => {
		const ohne = berechneMitarbeiter({ ...BETRIEB, anzahlProduktiv: 0 }, MA);
		expect(ohne.gemeinkostenAnteilCent).toBeNull();
		expect(ohne.kostendeckendCent).toBeNull();
		expect(ohne.warnungen.join(' ')).toMatch(/produktiven Mitarbeiter/);
		const keineGemeinkosten = berechneMitarbeiter({ ...BETRIEB, anzahlProduktiv: 0, gemeinkostenCent: 0 }, MA);
		expect(keineGemeinkosten.gemeinkostenAnteilCent).toBe(0);
		expect(keineGemeinkosten.kostendeckendCent).toBe(Math.round(5_082_000 / 1434.8));
	});

	it('aktueller Verrechnungssatz: unter Kosten / Kosten gedeckt / mit Gewinn', () => {
		const mit = (cent: number) => berechneMitarbeiter({ ...BETRIEB, aktuellerSatzCent: cent }, MA).vergleich;
		expect(mit(4000)).toBe('unter_kosten');
		expect(mit(5000)).toBe('kosten_gedeckt');
		expect(mit(5276)).toBe('mit_gewinn');
		expect(berechneMitarbeiter(BETRIEB, MA).vergleich).toBeNull();
	});
});

describe('berechneUebersicht', () => {
	it('Firmenschnitt gewichtet nach Stunden; über/unter Durchschnitt; Hinweis bei abweichender Anzahl', () => {
		const a = { id: 'a', name: 'Ali', werte: MA };
		const b = { id: 'b', name: 'Bea', werte: { ...MA, bruttoCent: 3_000_000 } };
		const c = { id: 'c', name: 'Cem', werte: { ...MA, urlaubstage: 400 } }; // ohne Satz
		const u = berechneUebersicht(BETRIEB, [a, b, c]);
		expect(u.mitarbeiter.map((m) => m.name)).toEqual(['Ali', 'Bea', 'Cem']);
		const ea = u.mitarbeiter[0].ergebnis;
		const eb = u.mitarbeiter[1].ergebnis;
		const summeKosten = ea.gesamtkostenCent! + eb.gesamtkostenCent!;
		const summeStunden = ea.fakturierbareStunden + eb.fakturierbareStunden;
		expect(u.fakturierbareStunden).toBe(summeStunden);
		expect(u.kostendeckendCent).toBe(Math.round(summeKosten / summeStunden));
		expect(u.empfohlenCent).toBe(Math.round((summeKosten / summeStunden) * 1.15));
		expect(u.mitarbeiter.map((m) => m.lage)).toEqual(['ueber', 'unter', null]);
		expect(u.hinweise.join(' ')).toMatch(/4 produktive Mitarbeiter.*erfasst sind 3/);
	});

	it('leer → keine Sätze, kein Fehler', () => {
		const u = berechneUebersicht(BETRIEB, []);
		expect(u).toMatchObject({ kostendeckendCent: null, empfohlenCent: null, fakturierbareStunden: 0, mitarbeiter: [] });
	});
});
