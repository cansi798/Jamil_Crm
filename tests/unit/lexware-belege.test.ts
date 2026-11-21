import { describe, expect, it } from 'vitest';
import {
	abAlsLexware,
	angebotAlsLexware,
	arbeitskosten35a,
	lexwareDatum,
	steuerFall,
	termineText,
	type BelegEingabe
} from '../../src/lib/server/lexware/belege';

const basis = (teil: Partial<BelegEingabe> = {}): BelegEingabe => ({
	datum: '2026-11-15',
	gueltigBis: '2026-12-15',
	mwstSatz: 19,
	einleitung: 'Vielen Dank für Ihre Anfrage.',
	schluss: 'Wir freuen uns auf Ihren Auftrag.',
	positionen: [
		{ bezeichnung: 'Fliesen verlegen', beschreibung: 'Bad, Boden', menge: 12.5, einheit: 'm²', einzelpreisCent: 6000, materialCent: 2000 },
		{ bezeichnung: 'Anfahrt', beschreibung: null, menge: 1, einheit: 'psch', einzelpreisCent: 4500, materialCent: 0 }
	],
	kunde: { lexwareId: '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', art: 'privat', name: 'Hans Müller', strasse: 'Weg 1', plz: '24103', ort: 'Kiel', bauleister13b: false, bescheinigung13bBis: null },
	kleinunternehmer: false,
	termine: [],
	...teil
});

describe('Lexware-Belege: Daten für Angebot und Auftragsbestätigung', () => {
	it('Datum im Lexware-Format mit Berliner Versatz (Winter +01:00, Sommer +02:00)', () => {
		expect(lexwareDatum('2026-11-15')).toBe('2026-11-15T00:00:00.000+01:00');
		expect(lexwareDatum('2027-07-01')).toBe('2027-07-01T00:00:00.000+02:00');
		// Umstelltage: um Mitternacht gilt noch der alte Versatz (sonst wäre es 23:00 Uhr am Vortag)
		expect(lexwareDatum('2026-03-29')).toBe('2026-03-29T00:00:00.000+01:00');
		expect(lexwareDatum('2026-10-25')).toBe('2026-10-25T00:00:00.000+02:00');
		expect(lexwareDatum('2026-03-30')).toBe('2026-03-30T00:00:00.000+02:00');
	});

	it('Steuerfall: net mit Satz; Kleinunternehmer → vatfree 0; § 13b nur Firma mit gültiger Bescheinigung', () => {
		const k = basis().kunde;
		expect(steuerFall({ kunde: k, kleinunternehmer: false, mwstSatz: 19, datum: '2026-11-15' })).toMatchObject({ taxType: 'net', satz: 19 });
		expect(steuerFall({ kunde: k, kleinunternehmer: true, mwstSatz: 19, datum: '2026-11-15' })).toMatchObject({ taxType: 'vatfree', satz: 0 });
		const firma = { ...k, art: 'firma' as const, bauleister13b: true, bescheinigung13bBis: '2027-01-31' };
		expect(steuerFall({ kunde: firma, kleinunternehmer: false, mwstSatz: 19, datum: '2026-11-15' })).toMatchObject({ taxType: 'constructionService13b', satz: 0 });
		const abgelaufen = steuerFall({ kunde: { ...firma, bescheinigung13bBis: '2026-10-31' }, kleinunternehmer: false, mwstSatz: 19, datum: '2026-11-15' });
		expect(abgelaufen).toMatchObject({ taxType: 'net', satz: 19 });
		expect(abgelaufen.warnung).toMatch(/Bescheinigung.*abgelaufen/);
	});

	it('§ 35a: Arbeitskosten = (Preis − Material) × Menge, brutto; fehlendes Material → keine Zahl, Warnung', () => {
		const r = arbeitskosten35a(basis().positionen, 19);
		// 12,5 × 40,00 € = 500,00 € + Anfahrt 45,00 € = 545,00 € netto → 648,55 € brutto, davon 103,55 € MwSt
		expect(r).toEqual({ nettoCent: 54500, mwstCent: 10355, bruttoCent: 64855, unvollstaendig: [] });
		const ohne = arbeitskosten35a([...basis().positionen, { bezeichnung: 'Sonstiges', beschreibung: null, menge: 1, einheit: 'Stk', einzelpreisCent: 1000, materialCent: null }], 19);
		expect(ohne.unvollstaendig).toEqual([3]);
	});

	it('Terminvorschläge als Text (Wochentag, Datum, Hinweis); leer → null', () => {
		expect(termineText([])).toBeNull();
		expect(termineText([{ pos: 1, beginn: '2027-03-01', hinweis: null }, { pos: 2, beginn: '2027-03-08', hinweis: 'vormittags' }])).toBe(
			'Mögliche Termine für den Baubeginn: 1) Mo 01.03.2027 2) Mo 08.03.2027 (vormittags). Bitte wählen Sie bei der Annahme einen Termin; bis dahin unverbindlich.'
		);
	});

	it('Angebot (Privatkunde): Kontakt-ID, freie Positionen, Netto in Euro, Termine + § 35a im Text, Titel ≤ 25', () => {
		const { body, warnungen } = angebotAlsLexware(basis({ termine: [{ pos: 1, beginn: '2027-03-01', hinweis: null }] }));
		expect(warnungen).toEqual([]);
		expect(body).toMatchObject({
			voucherDate: '2026-11-15T00:00:00.000+01:00',
			expirationDate: '2026-12-15T00:00:00.000+01:00',
			address: { contactId: '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b' },
			totalPrice: { currency: 'EUR' },
			taxConditions: { taxType: 'net' },
			title: 'Angebot'
		});
		expect(body.lineItems).toEqual([
			{ type: 'custom', name: 'Fliesen verlegen', description: 'Bad, Boden', quantity: 12.5, unitName: 'm²', unitPrice: { currency: 'EUR', netAmount: 60, taxRatePercentage: 19 }, discountPercentage: 0 },
			{ type: 'custom', name: 'Anfahrt', quantity: 1, unitName: 'psch', unitPrice: { currency: 'EUR', netAmount: 45, taxRatePercentage: 19 }, discountPercentage: 0 }
		]);
		expect(body.introduction).toBe('Vielen Dank für Ihre Anfrage.');
		expect(body.remark).toContain('Mögliche Termine für den Baubeginn: 1) Mo 01.03.2027');
		expect(body.remark).toContain('Arbeitskosten nach § 35a EStG: 648,55 € (darin 103,55 € MwSt)');
		expect(body.remark).toContain('Wir freuen uns auf Ihren Auftrag.');
		expect((body.title as string).length).toBeLessThanOrEqual(25);
	});

	it('Firma mit § 13b: constructionService13b, Satz 0 in jeder Position, kein § 35a; Einmal-Kunde ohne Kontakt → Adresse', () => {
		const kunde = { ...basis().kunde, art: 'firma' as const, name: 'Bau-Meier GmbH', bauleister13b: true, bescheinigung13bBis: '2028-01-01' };
		const { body } = angebotAlsLexware(basis({ kunde }));
		expect(body.taxConditions).toEqual({ taxType: 'constructionService13b' });
		expect((body.lineItems as any[]).every((p) => p.unitPrice.taxRatePercentage === 0)).toBe(true);
		expect(body.remark).not.toContain('35a');
		const einmal = angebotAlsLexware(basis({ kunde: { ...basis().kunde, lexwareId: null } })).body;
		expect(einmal.address).toEqual({ name: 'Hans Müller', street: 'Weg 1', zip: '24103', city: 'Kiel', countryCode: 'DE' });
	});

	it('§ 35a mit fehlendem Material: Hinweis statt Betrag und Warnung; Texte auf 2000 Zeichen gekürzt', () => {
		const pos = [{ bezeichnung: 'Frei', beschreibung: 'x'.repeat(3000), menge: 1, einheit: 'Stk', einzelpreisCent: 1000, materialCent: null }];
		const { body, warnungen } = angebotAlsLexware(basis({ positionen: pos, einleitung: 'e'.repeat(2500) }));
		expect(warnungen.join(' ')).toMatch(/§ 35a.*Position 1/);
		expect(body.remark).not.toMatch(/Arbeitskosten nach § 35a EStG: \d/);
		expect((body.introduction as string).length).toBeLessThanOrEqual(2000);
		expect(((body.lineItems as any[])[0].description as string).length).toBeLessThanOrEqual(2000);
	});

	it('Auftragsbestätigung: Bezug aufs Angebot, gewählter Termin in der Einleitung, Leistungsdatum, Titel', () => {
		const { body } = abAlsLexware({ ...basis(), angebotNummer: 'AG0007', heute: '2026-11-20', termin: '2027-03-08', terminWunsch: null });
		expect(body.title).toBe('Auftragsbestätigung');
		expect(body.voucherDate).toBe('2026-11-20T00:00:00.000+01:00');
		expect(body.introduction).toContain('Angebots AG0007');
		expect(body.introduction).toContain('Baubeginn: Mo 08.03.2027');
		expect(body.shippingConditions).toEqual({ shippingType: 'service', shippingDate: '2027-03-08T00:00:00.000+01:00' });
		const ohne = abAlsLexware({ ...basis(), angebotNummer: 'AG0007', heute: '2026-11-20', termin: null, terminWunsch: 'lieber im April' }).body;
		expect(ohne.introduction).toContain('Ihr Terminwunsch: „lieber im April“');
		expect(ohne.shippingConditions).toEqual({ shippingType: 'none' });
		expect(ohne).not.toHaveProperty('expirationDate');
	});
});
