import { describe, expect, it } from 'vitest';
import { abschlagBetrag, passtFilter, schlussBetrag, verzugszinsenCent, zahlStatus, type ZahlEingabe } from '../../src/lib/rechnungen';
import { mahnungAlsLexware, rechnungAlsLexware, TEXT_286, TEXT_AUFBEWAHRUNG, type RechnungEingabe } from '../../src/lib/server/lexware/belege';

const r = (t: Partial<ZahlEingabe> = {}): ZahlEingabe => ({ phase: 'angelegt', status: 'open', bruttoCent: 11900, offenCent: 11900, faellig: '2026-11-30', ...t });

describe('Zahlstatus (Lexware Phase 3)', () => {
	const heute = '2026-11-20';
	it('offen, teilweise bezahlt, bezahlt, überfällig, storniert, Entwurf, Phasen ohne Lexware', () => {
		expect(zahlStatus(r(), heute)).toBe('offen');
		expect(zahlStatus(r({ offenCent: 5000 }), heute)).toBe('teilbezahlt');
		expect(zahlStatus(r({ status: 'paid', offenCent: 0 }), heute)).toBe('bezahlt');
		expect(zahlStatus(r({ status: 'paidoff' }), heute)).toBe('bezahlt');
		expect(zahlStatus(r({ offenCent: 0 }), heute)).toBe('bezahlt');
		expect(zahlStatus(r({ status: 'overdue' }), heute)).toBe('ueberfaellig');
		expect(zahlStatus(r({ faellig: '2026-11-19', offenCent: 100 }), heute)).toBe('ueberfaellig');
		expect(zahlStatus(r({ status: 'voided' }), heute)).toBe('storniert');
		expect(zahlStatus(r({ status: 'draft' }), heute)).toBe('entwurf');
		expect(zahlStatus(r({ phase: 'wartet', status: null }), heute)).toBe('wartet');
		expect(zahlStatus(r({ phase: 'vorbereitet', status: null }), heute)).toBe('vorbereitet');
		expect(zahlStatus(r({ status: null }), heute)).toBe('wartet');
	});
	it('Filter „offen“ umfasst teilweise bezahlt und überfällig', () => {
		expect(passtFilter('ueberfaellig', 'offen')).toBe(true);
		expect(passtFilter('teilbezahlt', 'offen')).toBe(true);
		expect(passtFilter('bezahlt', 'offen')).toBe(false);
		expect(passtFilter('bezahlt', 'alle')).toBe(true);
	});
});

describe('Verzugszinsen, Abschlag, Schluss', () => {
	it('§ 288 BGB: Verbraucher Basiszins + 5, Firma + 9, Tage/365, nie vor Fälligkeit', () => {
		// 1.000 € offen, 1,27 % + 5 = 6,27 %, 73 Tage → 1000 * 0,0627 * 73/365 = 12,54 €
		expect(verzugszinsenCent({ offenCent: 100000, faellig: '2026-01-01', heute: '2026-03-15', basiszinsHundertstel: 127, firma: false })).toEqual({ cent: 1254, tage: 73, prozent: 6.27 });
		expect(verzugszinsenCent({ offenCent: 100000, faellig: '2026-01-01', heute: '2026-03-15', basiszinsHundertstel: 127, firma: true }).cent).toBe(2054);
		expect(verzugszinsenCent({ offenCent: 100000, faellig: '2026-03-20', heute: '2026-03-15', basiszinsHundertstel: 127, firma: false })).toMatchObject({ cent: 0, tage: 0 });
	});
	it('Abschlag in € oder %, Schluss = Gesamt − nicht stornierte Abschläge', () => {
		expect(abschlagBetrag(119000, { prozent: 30 })).toBe(35700);
		expect(abschlagBetrag(119000, { cent: 50000 })).toBe(50000);
		expect(abschlagBetrag(119000, { prozent: 150 })).toBe(119000);
		expect(schlussBetrag(119000, [{ bruttoCent: 35700 }, { bruttoCent: 20000, storniert: true }])).toEqual({ restCent: 83300, abschlaegeCent: 35700 });
		expect(schlussBetrag(1000, [{ bruttoCent: 5000 }]).restCent).toBe(0);
	});
});

const eingabe = (t: Partial<RechnungEingabe> = {}): RechnungEingabe => ({
	heute: '2026-11-20',
	mwstSatz: 19,
	positionen: [
		{ bezeichnung: 'Fliesen verlegen', beschreibung: null, menge: 11, einheit: 'm²', einzelpreisCent: 6000, materialCent: 2000 },
		{ bezeichnung: 'Anfahrt', beschreibung: null, menge: 1, einheit: 'psch', einzelpreisCent: 4500, materialCent: 0 }
	],
	kunde: { lexwareId: '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', art: 'privat', name: 'Hans Müller', strasse: null, plz: null, ort: null, bauleister13b: false, bescheinigung13bBis: null },
	kleinunternehmer: false,
	leistungVon: '2026-11-02',
	leistungBis: '2026-11-13',
	zahlungszielTage: 14,
	titel: 'Rechnung',
	bezug: 'Auftragsbestätigung AB0001',
	...t
});

describe('Rechnung für Lexware', () => {
	it('Privatkunde: § 35a mit Betrag, § 286 und Aufbewahrung, Zeitraum, Zahlungsziel, net 19 %', () => {
		const b = rechnungAlsLexware(eingabe());
		expect(b.body).toMatchObject({
			voucherDate: '2026-11-20T00:00:00.000+01:00',
			address: { contactId: '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b' },
			taxConditions: { taxType: 'net' },
			paymentConditions: { paymentTermDuration: 14, paymentTermLabel: 'Zahlbar innerhalb von 14 Tagen ohne Abzug' },
			shippingConditions: { shippingType: 'serviceperiod', shippingDate: '2026-11-02T00:00:00.000+01:00', shippingEndDate: '2026-11-13T00:00:00.000+01:00' },
			title: 'Rechnung'
		});
		expect((b.body.lineItems as any[])[0]).toMatchObject({ quantity: 11, unitPrice: { netAmount: 60, taxRatePercentage: 19 } });
		const remark = b.body.remark as string;
		// Lohn 11 × 40 € + 45 € = 485 € netto → 577,15 € brutto, 92,15 € MwSt
		expect(remark).toContain('Arbeitskosten nach § 35a EStG: 577,15 €');
		expect(remark).toContain(TEXT_286);
		expect(remark).toContain(TEXT_AUFBEWAHRUNG);
		expect(b.warnungen).toEqual([]);
	});
	it('Firmenkunde: keine Privatkunden-Pflichttexte; § 13b mit gültiger Bescheinigung; ein Tag → service', () => {
		const firma = { ...eingabe().kunde, art: 'firma' as const, bauleister13b: true, bescheinigung13bBis: '2027-12-31' };
		const b = rechnungAlsLexware(eingabe({ kunde: firma, leistungVon: '2026-11-13', leistungBis: '2026-11-13', zahlungszielTage: 0 }));
		expect(b.body.taxConditions).toEqual({ taxType: 'constructionService13b' });
		expect((b.body.lineItems as any[])[0].unitPrice.taxRatePercentage).toBe(0);
		expect(b.body.shippingConditions).toEqual({ shippingType: 'service', shippingDate: '2026-11-13T00:00:00.000+01:00' });
		expect(b.body.paymentConditions).toMatchObject({ paymentTermLabel: 'Zahlbar sofort ohne Abzug', paymentTermDuration: 0 });
		expect(b.body.remark).toBe('Vielen Dank für Ihren Auftrag.');
	});
	it('Kleinunternehmer → vatfree; fehlender Materialanteil → kein geratener § 35a-Betrag, Warnung', () => {
		const pos = [{ bezeichnung: 'Frei', beschreibung: null, menge: 1, einheit: 'Std', einzelpreisCent: 5000, materialCent: null }];
		const b = rechnungAlsLexware(eingabe({ kleinunternehmer: true, positionen: pos }));
		expect(b.body.taxConditions).toEqual({ taxType: 'vatfree' });
		expect(b.body.remark).not.toMatch(/Arbeitskosten nach § 35a EStG: \d/);
		expect(b.warnungen.join(' ')).toMatch(/Position 1 fehlt der Materialanteil/);
	});
});

describe('Mahnung für Lexware', () => {
	const kunde = eingabe().kunde;
	it('Gebühr und Pauschale als 0-%-Positionen, Zinsen nur als Text, Steuerart wie Rechnung', () => {
		const m = mahnungAlsLexware({ heute: '2026-12-20', kunde, taxType: 'net', stufe: 2, rechnungNummer: 'RE0001', gebuehrCent: 500, pauschaleCent: 4000, zinsHinweis: 'Verzugszinsen: 3,10 €' });
		expect(m.lineItems).toEqual([
			{ type: 'custom', name: 'Mahngebühr', quantity: 1, unitName: 'pauschal', unitPrice: { currency: 'EUR', netAmount: 5, taxRatePercentage: 0 }, discountPercentage: 0 },
			{ type: 'custom', name: 'Verzugspauschale (§ 288 Abs. 5 BGB)', quantity: 1, unitName: 'pauschal', unitPrice: { currency: 'EUR', netAmount: 40, taxRatePercentage: 0 }, discountPercentage: 0 }
		]);
		expect(m).toMatchObject({ title: '2. Mahnung', taxConditions: { taxType: 'net' }, address: { contactId: kunde.lexwareId } });
		expect(m.remark).toContain('Verzugszinsen: 3,10 €');
	});
	it('ohne Gebühr: eine Textposition', () => {
		const m = mahnungAlsLexware({ heute: '2026-12-20', kunde, taxType: 'net', stufe: 1, rechnungNummer: 'RE0001', gebuehrCent: 0, pauschaleCent: 0, zinsHinweis: null });
		expect(m.lineItems).toEqual([{ type: 'text', name: '1. Mahnung', description: 'Zur Rechnung RE0001' }]);
	});
});
