import { describe, expect, it } from 'vitest';
import { summen, type MwstSatz } from '../../src/lib/geld';
import type { BelegEingabe, BelegPosition, RechnungEingabe } from '../../src/lib/server/lexware/belege';
import {
	abZuLexwareOrderConfirmation,
	angebotZuLexwareQuotation,
	erwarteteSummen,
	kontaktZuLexware,
	pruefeBeleg,
	pruefeKontakt,
	rechnungZuLexwareInvoice,
	type KundeFuerLexware
} from '../../src/lib/server/lexware/format';
import { landAusPlz, suchText } from '../../src/lib/server/lexware/land';

/**
 * Lexware-Format (docs/lexware-format.md) mit den Beispieldaten aus scripts/seed-dev.ts:
 * Angebot „Ladenumbau Trockenbau“ (freie Positionen) und „Fliesen Küche“ (Katalog-Beispielpreise Lohn + Material).
 */

const KONTAKT_ID = '5a9f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const pos = (bezeichnung: string, menge: number, einheit: string, euro: number, materialEuro: number | null = null): BelegPosition => ({
	bezeichnung,
	beschreibung: null,
	menge,
	einheit,
	einzelpreisCent: Math.round(euro * 100),
	materialCent: materialEuro === null ? null : Math.round(materialEuro * 100)
});

// Seed: Angebot „Ladenumbau Trockenbau“ (versendet) – Firmenkunde
const TROCKENBAU: BelegPosition[] = [
	pos('Ständerwand einfach beplankt', 24, 'm²', 48),
	pos('Decke abhängen', 18, 'm²', 52),
	pos('Spachteln Q2', 42, 'm²', 9.5),
	pos('Anfahrt und Baustelleneinrichtung', 1, 'psch', 85)
];
// Seed: Angebot „Fliesen Küche“ – Katalogpreise = Lohn + Material (BEISPIELPREISE)
const FLIESEN: BelegPosition[] = [
	pos('Untergrund vorbereiten und grundieren', 18, 'm²', 9 + 3.5, 3.5),
	pos('Bodenfliesen verlegen bis 60×60', 18, 'm²', 38 + 7.5, 7.5),
	pos('Wandfliesen verlegen bis 30×60', 4.5, 'm²', 42 + 7.5, 7.5),
	pos('Sockelfliesen verlegen', 17, 'lfm', 14 + 2, 2),
	pos('Silikonfugen erneuern', 6, 'lfm', 8 + 1.5, 1.5)
];

const kunde = (teil: Partial<BelegEingabe['kunde']> = {}): BelegEingabe['kunde'] => ({
	lexwareId: KONTAKT_ID,
	art: 'privat',
	name: 'Hans Müller',
	strasse: 'Weg 1',
	plz: '24103',
	ort: 'Kiel',
	bauleister13b: false,
	bescheinigung13bBis: null,
	...teil
});
const angebot = (teil: Partial<BelegEingabe> = {}): BelegEingabe => ({
	datum: '2026-11-21',
	gueltigBis: '2026-12-21',
	mwstSatz: 19,
	einleitung: 'Vielen Dank für Ihre Anfrage.',
	schluss: 'Wir freuen uns auf Ihren Auftrag.',
	positionen: FLIESEN,
	kunde: kunde(),
	kleinunternehmer: false,
	termine: [],
	...teil
});
const rechnung = (teil: Partial<RechnungEingabe> = {}): RechnungEingabe => ({
	heute: '2026-11-21',
	mwstSatz: 19,
	positionen: TROCKENBAU,
	kunde: kunde({ art: 'firma', name: 'Laden GmbH' }),
	kleinunternehmer: false,
	leistungVon: '2026-11-10',
	leistungBis: '2026-11-14',
	zahlungszielTage: 14,
	titel: 'Rechnung',
	bezug: 'Angebot AN-2026-0002',
	...teil
});

describe('Lexware-Format: Angebot → POST /v1/quotations', () => {
	it('Seed „Fliesen Küche“: Pflichtfelder erfüllt, Cent → Euro, Summen wie im CRM', () => {
		const a = angebotZuLexwareQuotation(angebot());
		expect(a.fehler).toEqual([]);
		expect(a.methode).toBe('POST');
		expect(a.pfad).toBe('/v1/quotations');
		expect(a.body.voucherDate).toBe('2026-11-21T00:00:00.000+01:00');
		expect(a.body.expirationDate).toBe('2026-12-21T00:00:00.000+01:00');
		expect(a.body.address).toEqual({ contactId: KONTAKT_ID });
		expect(a.body.taxConditions).toEqual({ taxType: 'net' });
		expect(a.body.lineItems.map((p) => p.unitPrice!.netAmount)).toEqual([12.5, 45.5, 49.5, 16, 9.5]);
		expect(a.body.lineItems.map((p) => p.unitName)).toEqual(['m²', 'm²', 'm²', 'lfm', 'lfm']);
		expect(a.body.lineItems.every((p) => p.type === 'custom' && p.unitPrice!.currency === 'EUR' && p.unitPrice!.taxRatePercentage === 19)).toBe(true);
		// 225,00 + 819,00 + 222,75 + 272,00 + 57,00 = 1.595,75 € netto; 303,19 € MwSt; 1.898,94 € brutto
		expect(a.erwartet).toMatchObject({ nettoCent: 159575, steuerCent: 30319, bruttoCent: 189894 });
		const crm = summen(FLIESEN, 19);
		expect([a.erwartet!.nettoCent, a.erwartet!.steuerCent, a.erwartet!.bruttoCent]).toEqual([crm.nettoCent, crm.mwstCent, crm.bruttoCent]);
	});

	it('festschreiben → ?finalize=true; ohne Lexware-Kontakt Einmal-Adresse mit countryCode + Hinweis Sammelkunde', () => {
		const a = angebotZuLexwareQuotation(angebot({ kunde: kunde({ lexwareId: null }) }), { festschreiben: true });
		expect(a.pfad).toBe('/v1/quotations?finalize=true');
		expect(a.body.address).toEqual({ name: 'Hans Müller', street: 'Weg 1', zip: '24103', city: 'Kiel', countryCode: 'DE' });
		expect(a.fehler).toEqual([]);
		expect(a.warnungen.join(' ')).toMatch(/Sammelkunde/);
	});

	it('Auslandskunde: Länderkürzel in der PLZ wird countryCode, PLZ ohne Kürzel', () => {
		const a = angebotZuLexwareQuotation(angebot({ kunde: kunde({ lexwareId: null, plz: 'A-1010', ort: 'Wien' }) }));
		expect(a.body.address).toMatchObject({ zip: '1010', city: 'Wien', countryCode: 'AT' });
	});

	it('§ 13b nur mit Lexware-Kontakt; mit Kontakt: constructionService13b und Satz 0', () => {
		const firma = kunde({ art: 'firma', name: 'Bau GmbH', bauleister13b: true, bescheinigung13bBis: '2027-12-31' });
		const mit = angebotZuLexwareQuotation(angebot({ kunde: firma }));
		expect(mit.body.taxConditions.taxType).toBe('constructionService13b');
		expect(mit.body.lineItems.every((p) => p.unitPrice!.taxRatePercentage === 0)).toBe(true);
		expect(mit.fehler).toEqual([]);
		expect(mit.erwartet).toMatchObject({ nettoCent: 159575, steuerCent: 0, bruttoCent: 159575 });
		const ohne = angebotZuLexwareQuotation(angebot({ kunde: { ...firma, lexwareId: null } }));
		expect(ohne.fehler).toContain('taxType constructionService13b geht nur mit einem Lexware-Kontakt (address.contactId)');
	});

	it('Kleinunternehmer → vatfree, Steuersatz 0; 7 % wird übernommen', () => {
		const ku = angebotZuLexwareQuotation(angebot({ kleinunternehmer: true }));
		expect(ku.body.taxConditions.taxType).toBe('vatfree');
		expect(ku.body.lineItems.every((p) => p.unitPrice!.taxRatePercentage === 0)).toBe(true);
		const sieben = angebotZuLexwareQuotation(angebot({ mwstSatz: 7 as MwstSatz }));
		expect(sieben.body.lineItems[0].unitPrice!.taxRatePercentage).toBe(7);
		expect(sieben.erwartet!.steuerCent).toBe(summen(FLIESEN, 7).mwstCent);
	});
});

describe('Lexware-Format: Rechnung → POST /v1/invoices', () => {
	it('Seed „Ladenumbau Trockenbau“: Leistungszeitraum, Zahlungsziel, Entwurf ohne finalize', () => {
		const r = rechnungZuLexwareInvoice(rechnung());
		expect(r.fehler).toEqual([]);
		expect(r.pfad).toBe('/v1/invoices');
		expect(r.body.shippingConditions).toEqual({ shippingType: 'serviceperiod', shippingDate: '2026-11-10T00:00:00.000+01:00', shippingEndDate: '2026-11-14T00:00:00.000+01:00' });
		expect(r.body.paymentConditions).toEqual({ paymentTermLabel: 'Zahlbar innerhalb von 14 Tagen ohne Abzug', paymentTermDuration: 14 });
		expect(r.body.lineItems.map((p) => [p.quantity, p.unitName, p.unitPrice!.netAmount])).toEqual([
			[24, 'm²', 48],
			[18, 'm²', 52],
			[42, 'm²', 9.5],
			[1, 'psch', 85]
		]);
		// 1.152 + 936 + 399 + 85 = 2.572,00 € netto; 488,68 € MwSt; 3.060,68 € brutto
		expect(r.erwartet).toMatchObject({ nettoCent: 257200, steuerCent: 48868, bruttoCent: 306068 });
	});

	it('ein Leistungstag → service; Vorgänger + festschreiben in der Abfrage', () => {
		const vorgaenger = '11111111-2222-4333-8444-555555555555';
		const r = rechnungZuLexwareInvoice(rechnung({ leistungVon: '2026-07-01', leistungBis: '2026-07-01' }), { vorgaengerLexwareId: vorgaenger, festschreiben: true });
		expect(r.body.shippingConditions).toEqual({ shippingType: 'service', shippingDate: '2026-07-01T00:00:00.000+02:00' });
		expect(r.pfad).toBe(`/v1/invoices?precedingSalesVoucherId=${vorgaenger}&finalize=true`);
	});

	it('Prüfung erkennt fehlendes Leistungsdatum, falsches Datumsformat, zu langen Titel, Steuersatz ≠ 0 bei vatfree', () => {
		const r = rechnungZuLexwareInvoice(rechnung());
		const kaputt = { ...r.body, voucherDate: '2026-11-21', title: 'x'.repeat(26), shippingConditions: { shippingType: 'service' as const } };
		const f = pruefeBeleg('invoice', kaputt);
		expect(f).toContain('voucherDate fehlt oder ist nicht im Format yyyy-MM-ddTHH:mm:ss.SSSXXX');
		expect(f).toContain('shippingConditions.shippingDate fehlt');
		expect(f).toContain('title länger als 25 Zeichen');
		const { shippingConditions: _weg, ...ohne } = r.body;
		expect(pruefeBeleg('invoice', ohne)).toContain('shippingConditions fehlt (Pflicht, Leistungsdatum)');
		const vatfree = { ...r.body, taxConditions: { taxType: 'vatfree' as const } };
		expect(pruefeBeleg('invoice', vatfree)).toContain('lineItems[0].unitPrice.taxRatePercentage muss bei vatfree 0 sein');
	});
});

describe('Lexware-Format: Auftragsbestätigung → POST /v1/order-confirmations', () => {
	it('mit gewähltem Baubeginn: shippingConditions service, Vorgänger-Angebot', () => {
		const vorgaenger = '22222222-3333-4444-8555-666666666666';
		const ab = abZuLexwareOrderConfirmation({ ...angebot(), angebotNummer: 'AG0007', heute: '2026-11-21', termin: '2027-03-01', terminWunsch: null }, { angebotLexwareId: vorgaenger, festschreiben: true });
		expect(ab.fehler).toEqual([]);
		expect(ab.pfad).toBe(`/v1/order-confirmations?precedingSalesVoucherId=${vorgaenger}&finalize=true`);
		expect(ab.body.shippingConditions).toEqual({ shippingType: 'service', shippingDate: '2027-03-01T00:00:00.000+01:00' });
	});
});

describe('Lexware-Format: Summen = CRM-Summen (Rundung, Cent)', () => {
	it('Cent → Euro ohne Gleitkommafehler: 0,07 €, 19,99 €, 0,1 × 3 × 10 €', () => {
		const r = angebotZuLexwareQuotation(angebot({ positionen: [pos('A', 1, 'Stk', 0.07), pos('B', 3, 'Stk', 19.99), pos('C', 0.1, 'h', 30)] }));
		expect(r.body.lineItems.map((p) => p.unitPrice!.netAmount)).toEqual([0.07, 19.99, 30]);
		expect(r.erwartet!.nettoCent).toBe(7 + 5997 + 300);
	});

	it('500 Zufallsangebote: Lexware-Nachrechnung = CRM-Summen (Netto, MwSt, Brutto)', () => {
		let saat = 42;
		const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
		for (let i = 0; i < 500; i++) {
			const n = 1 + Math.floor(zufall() * 8);
			const positionen = Array.from({ length: n }, (_, j) => pos(`P${j}`, Math.round(zufall() * 200000) / 1000 || 0.001, 'Stk', Math.round(zufall() * 500000) / 100));
			const satz = ([0, 7, 19] as const)[Math.floor(zufall() * 3)];
			const a = angebotZuLexwareQuotation(angebot({ positionen, mwstSatz: satz }));
			const crm = summen(positionen, satz);
			expect([a.erwartet!.nettoCent, a.erwartet!.steuerCent, a.erwartet!.bruttoCent]).toEqual([crm.nettoCent, crm.mwstCent, crm.bruttoCent]);
			expect(a.fehler).toEqual([]);
		}
	});

	it('Rabatt und Brutto-Belege werden nachgerechnet wie bei Lexware', () => {
		const s = erwarteteSummen({
			taxConditions: { taxType: 'net' },
			lineItems: [{ type: 'custom', name: 'X', quantity: 2, unitName: 'Stück', unitPrice: { currency: 'EUR', netAmount: 13.4, taxRatePercentage: 19 }, discountPercentage: 50 }]
		});
		// Beispiel der Doku (Invoices Properties): 2 × 13,40 € − 50 % = 13,40 € netto
		expect(s.nettoCent).toBe(1340);
		const g = erwarteteSummen({ taxConditions: { taxType: 'gross' }, lineItems: [{ type: 'custom', name: 'Y', quantity: 1, unitName: 'Stück', unitPrice: { currency: 'EUR', grossAmount: 119, taxRatePercentage: 19 } }] });
		expect(g).toMatchObject({ nettoCent: 10000, steuerCent: 1900, bruttoCent: 11900 });
	});
});

describe('Lexware-Format: Kunde → POST /v1/contacts', () => {
	const ID = '0d6b7a52-1c1e-4c55-9a0e-3f3a2b1c0d9e';
	const basis = (teil: Partial<KundeFuerLexware> = {}): KundeFuerLexware => ({
		id: ID,
		art: 'privat',
		firma: null,
		anrede: 'Frau',
		vorname: 'Inge',
		nachname: 'Musterfrau',
		email: 'inge@beispiel.test',
		telefon: '040 123',
		strasse: 'Lindenweg 3',
		plz: '22846',
		ort: 'Norderstedt',
		...teil
	});

	it('Privatkunde: Pflichtfelder (version 0, roles.customer, person.lastName, countryCode), Marke in note', () => {
		const k = kontaktZuLexware(basis());
		expect(k.pfad).toBe('/v1/contacts');
		expect(k.fehler).toEqual([]);
		expect(k.body).toMatchObject({ version: 0, roles: { customer: {} }, person: { salutation: 'Frau', firstName: 'Inge', lastName: 'Musterfrau' } });
		expect(k.body.addresses?.billing?.[0]).toEqual({ street: 'Lindenweg 3', zip: '22846', city: 'Norderstedt', countryCode: 'DE' });
		expect(k.body.note).toBe(`CRM-Kunde ${ID}`);
	});

	it('Firmenkunde mit USt-ID (für § 13b nötig) und Schweizer Adresse', () => {
		const k = kontaktZuLexware(basis({ art: 'firma', firma: 'Bau AG', ustId: 'CHE-123.456.789', plz: 'CH-8001', ort: 'Zürich' }));
		expect(k.body.company).toMatchObject({ name: 'Bau AG', vatRegistrationId: 'CHE-123.456.789' });
		expect(k.body.person).toBeUndefined();
		expect(k.body.addresses?.billing?.[0]).toMatchObject({ zip: '8001', countryCode: 'CH' });
		expect(k.fehler).toEqual([]);
	});

	it('Leitweg-ID nur mit Lieferantennummer (XRechnung), sonst Warnung', () => {
		expect(kontaktZuLexware(basis({ art: 'firma', firma: 'Stadt Kiel', leitwegId: '04-1234-56' })).warnungen.join(' ')).toMatch(/Lieferantennummer/);
		expect(kontaktZuLexware(basis({ art: 'firma', firma: 'Stadt Kiel', leitwegId: '04-1234-56', lieferantennummerBeimKunden: 'L-77' })).body.xRechnung).toEqual({ buyerReference: '04-1234-56', vendorNumberAtCustomer: 'L-77' });
	});

	it('Prüfung: person UND company, zwei E-Mails je Art, Anrede > 25, fehlender countryCode', () => {
		const f = pruefeKontakt({
			version: 0,
			roles: { customer: {} },
			person: { lastName: 'A', salutation: 'x'.repeat(26) },
			company: { name: 'B' },
			emailAddresses: { private: ['a@b.test', 'c@d.test'] },
			addresses: { billing: [{ city: 'Kiel' }] }
		});
		expect(f).toEqual(
			expect.arrayContaining([
				'genau eines von person oder company angeben',
				'Anrede länger als 25 Zeichen',
				'emailAddresses.private: höchstens ein Eintrag',
				'addresses.billing[].countryCode fehlt (Pflicht)'
			])
		);
	});
});

describe('Land und Suchtext', () => {
	it('PLZ mit Länderkürzel', () => {
		expect(landAusPlz('24103')).toEqual({ countryCode: 'DE', zip: '24103', warnung: null });
		expect(landAusPlz('D-24103')).toEqual({ countryCode: 'DE', zip: '24103', warnung: null });
		expect(landAusPlz('A 1010')).toMatchObject({ countryCode: 'AT', zip: '1010' });
		expect(landAusPlz('NL-1234 AB')).toMatchObject({ countryCode: 'NL', zip: '1234 AB' });
		expect(landAusPlz('8001').warnung).toMatch(/keine deutsche PLZ/);
		expect(landAusPlz(null)).toEqual({ countryCode: 'DE', zip: null, warnung: null });
	});

	it('Suchtext: & < > HTML- und URL-kodiert (Doku-Beispiel „johnson & partner“)', () => {
		expect(suchText('johnson & partner')).toBe('johnson%20%26amp%3B%20partner');
	});
});
