import { describe, expect, it } from 'vitest';
import {
	agAnteil,
	BEISPIEL_KOSTEN,
	BEISPIEL_MITARBEITER,
	BEISPIEL_STUNDEN_TAG,
	BEISPIEL_TAGE,
	berechneUebersicht,
	bewerteAngebot,
	jahresbetrag,
	lohnAusMinuten,
	minutenJeEinheit,
	unterKostendeckend,
	type BetriebsWerte,
	type KostenZeile,
	type MitarbeiterWerte
} from '../../src/lib/kalkulation';

const BETRIEB: BetriebsWerte = { standardTage: 210, standardStundenTag: 7, risikoProzent: 5, gewinnProzent: 15, aktuellerSatzCent: null };
const zeile = (betragCent: number, intervall: KostenZeile['intervall'] = 'monatlich', extra: Partial<KostenZeile> = {}): KostenZeile => ({
	id: `z${betragCent}`,
	name: 'x',
	kategorie: 'sonstiges',
	betragCent,
	intervall,
	abschreibungMonate: intervall === 'einmalig' ? 36 : null,
	aktiv: true,
	...extra
});
const ma = (id: string, w: Partial<MitarbeiterWerte> = {}) => ({
	id,
	name: id,
	werte: { bruttoCent: 0, agArt: 'euro' as const, agProzent: null, agEuroCent: 0, tageJahr: null, stundenTag: null, ...w }
});

describe('Kalkulation v2: Kostenzeilen', () => {
	it('Jahresbetrag: monatlich × 12, jährlich, einmalig anteilig abgeschrieben', () => {
		expect(jahresbetrag(zeile(5450))).toBe(65400);
		expect(jahresbetrag(zeile(120000, 'jaehrlich'))).toBe(120000);
		expect(jahresbetrag(zeile(360000, 'einmalig', { abschreibungMonate: 36 }))).toBe(120000); // 3.600 € über 3 Jahre
		expect(jahresbetrag(zeile(60000, 'einmalig', { abschreibungMonate: 6 }))).toBe(60000); // ganz in diesem Jahr
	});

	it('Arbeitgeber-Anteil in % oder €', () => {
		expect(agAnteil({ bruttoCent: 4000000, agArt: 'prozent', agProzent: 21, agEuroCent: null })).toBe(840000);
		expect(agAnteil({ bruttoCent: 4000000, agArt: 'euro', agProzent: null, agEuroCent: 500000 })).toBe(500000);
	});
});

describe('Kalkulation v2: Stundensätze', () => {
	it('Jamils Excel: 3 × 210 Tage × 7 h = 4.410 h; sichtbare Zeilen 3–15 = 7.544,12 €/Monat → 20,53 €/h', () => {
		const zeilen = BEISPIEL_KOSTEN.map((b, i) => ({ ...zeile(b.betragCent), id: `b${i}`, name: b.name, kategorie: b.kategorie }));
		const leute = Array.from({ length: BEISPIEL_MITARBEITER }, (_, i) => ma(`m${i}`));
		const u = berechneUebersicht({ ...BETRIEB, standardTage: BEISPIEL_TAGE, standardStundenTag: BEISPIEL_STUNDEN_TAG }, zeilen, leute);
		expect(u.produktiveStunden).toBe(4410);
		expect(u.monatskostenCent).toBe(754412);
		expect(u.gesamtkostenCent).toBe(9052944);
		expect(u.kostendeckendCent).toBe(2053); // 90.529,44 € / 4.410 h
		expect(u.empfohlenCent).toBe(2463); // + 20 % Wagnis und Gewinn
		// Gegenprobe zur Excel: 48,01 €/h entsprächen 211.724 €/Jahr bei 4.410 h
		expect(Math.round((4801 * 4410) / 100)).toBe(211724);
	});

	it('Personalkosten je Mitarbeiter, Tage/Stunden überschreibbar; inaktive Zeilen zählen nicht', () => {
		const u = berechneUebersicht(
			BETRIEB,
			[zeile(100000), zeile(999999, 'monatlich', { aktiv: false, id: 'aus' })],
			[ma('a', { bruttoCent: 3600000, agArt: 'prozent', agProzent: 20 }), ma('b', { tageJahr: 100, stundenTag: 4 })]
		);
		expect(u.mitarbeiter.map((m) => [m.id, m.stunden, m.personalkostenCent])).toEqual([
			['a', 1470, 4320000],
			['b', 400, 0]
		]);
		expect(u.produktiveStunden).toBe(1870);
		expect(u.kostenzeilenCent).toBe(1200000);
		expect(u.gesamtkostenCent).toBe(5520000);
		expect(u.kostendeckendCent).toBe(Math.round(5520000 / 1870));
		expect(u.kategorien).toEqual([{ kategorie: 'sonstiges', jahresCent: 1200000 }]);
	});

	it('ohne Mitarbeiter oder ohne Stunden: kein Satz, Warnung; Vergleich mit dem aktuellen Satz', () => {
		expect(berechneUebersicht(BETRIEB, [zeile(1000)], [])).toMatchObject({ kostendeckendCent: null, empfohlenCent: null });
		expect(berechneUebersicht(BETRIEB, [zeile(1000)], [ma('a', { tageJahr: 0 })]).warnungen[0]).toMatch(/keine produktiven Stunden/);
		const v = (satz: number) =>
			berechneUebersicht({ ...BETRIEB, aktuellerSatzCent: satz }, [zeile(735000)], [ma('a', { tageJahr: 210, stundenTag: 7 })]).vergleich;
		// 88.200 € / 1.470 h = 60 €/h kostendeckend, 72 € empfohlen
		expect(v(5000)).toBe('unter_kosten');
		expect(v(6500)).toBe('kosten_gedeckt');
		expect(v(7200)).toBe('mit_gewinn');
	});
});

describe('Katalog: Minuten × Stundensatz', () => {
	it('Minuten je Einheit: angegeben, sonst 60 bei „h“, sonst unbekannt', () => {
		expect(minutenJeEinheit('m²', 45)).toBe(45);
		expect(minutenJeEinheit('h', null)).toBe(60);
		expect(minutenJeEinheit('Stk', null)).toBeNull();
		expect(minutenJeEinheit('h', 30)).toBe(30);
	});

	it('Lohn aus Minuten (kaufmännisch gerundet)', () => {
		expect(lohnAusMinuten(45, 5276)).toBe(3957); // 0,75 h × 52,76 €
		expect(lohnAusMinuten(0, 5276)).toBe(0);
		expect(lohnAusMinuten(10, 4587)).toBe(765); // 764,5 → 765
	});

	it('unter kostendeckend: Lohn < Minuten × kostendeckender Satz; ohne Arbeitszeit unbekannt', () => {
		expect(unterKostendeckend({ einheit: 'h', arbeitMinuten: null, lohnCent: 4500 }, 4587)).toBe(true);
		expect(unterKostendeckend({ einheit: 'h', arbeitMinuten: null, lohnCent: 4587 }, 4587)).toBe(false);
		expect(unterKostendeckend({ einheit: 'm²', arbeitMinuten: 30, lohnCent: 2000 }, 4587)).toBe(true); // 22,94 € nötig
		expect(unterKostendeckend({ einheit: 'm²', arbeitMinuten: 30, lohnCent: 2500 }, 4587)).toBe(false);
		expect(unterKostendeckend({ einheit: 'Stk', arbeitMinuten: null, lohnCent: 0 }, 4587)).toBeNull();
	});
});

describe('Angebot bewerten: Ampel und erwarteter Gewinn', () => {
	const SATZ = { kostendeckendCent: 4587, empfohlenCent: 5276 };
	const pos = (menge: number, einzelpreisCent: number, einheit: string, arbeitMinuten: number | null, materialCent: number | null = null) => ({
		menge,
		einzelpreisCent,
		einheit,
		arbeitMinuten,
		materialCent
	});

	it('Stunden, Material, Gewinn und Ampel grün (effektiver Satz ≥ empfohlen)', () => {
		// 10 h à 60 € + 20 m² Fliesen (je 30 min, 40 € Preis davon 15 € Material)
		const b = bewerteAngebot([pos(10, 6000, 'h', null), pos(20, 4000, 'm²', 30, 1500)], SATZ);
		expect(b.arbeitsstunden).toBe(20);
		expect(b.nettoCent).toBe(140000);
		expect(b.materialCent).toBe(30000);
		// Kosten = 20 h × 45,87 € + 300 € Material = 1.217,40 €; Gewinn = 1.400 − 1.217,40 = 182,60 €
		expect(b.kostenCent).toBe(121740);
		expect(b.gewinnCent).toBe(18260);
		// (1.400 − 300) / 20 h = 55,00 €/h ≥ 52,76 → grün
		expect(b.effektiverSatzCent).toBe(5500);
		expect(b.ampel).toBe('gruen');
		expect(b.ohneArbeitszeit).toBe(0);
	});

	it('gelb: deckt Kosten, aber unter dem empfohlenen Satz; rot: unter kostendeckend (Verlust)', () => {
		expect(bewerteAngebot([pos(10, 5000, 'h', null)], SATZ).ampel).toBe('gelb');
		const rot = bewerteAngebot([pos(10, 4000, 'h', null)], SATZ);
		expect(rot.ampel).toBe('rot');
		expect(rot.gewinnCent).toBe(-5870);
	});

	it('ohne Arbeitszeit: keine Ampel; Positionen ohne Zeit werden gezählt; ohne Firmensatz keine Bewertung', () => {
		const b = bewerteAngebot([pos(3, 10000, 'Stk', null)], SATZ);
		expect(b).toMatchObject({ arbeitsstunden: 0, ampel: null, ohneArbeitszeit: 1, effektiverSatzCent: null });
		expect(bewerteAngebot([pos(10, 6000, 'h', null)], null)).toMatchObject({ ampel: null, gewinnCent: null, arbeitsstunden: 10 });
	});
});
