import { abAlsLexware, angebotAlsLexware, rechnungAlsLexware, type BelegEingabe, type RechnungEingabe } from './belege';
import { kontaktAusKunde, type KundeDaten } from './kontakte';
import { landAusPlz } from './land';

/**
 * Lexware-Format: reine Abbildungsschicht CRM → Lexware Office Public API (ohne Netzwerk, ohne Datenbank, ohne
 * Zugangsdaten). Jede Funktion liefert eine fertige „Anfrage“ (Methode, Pfad, JSON-Body) plus Prüfergebnis und die
 * Summen, die Lexware ausrechnen wird – so kann eine spätere Anbindung (z. B. Supabase Edge Function) den Body nur
 * noch mit dem API-Schlüssel an https://api.lexware.io schicken.
 *
 * Quelle aller Felder und Regeln: https://developers.lexware.io/docs/ (gelesen 21.11.2026) und das Kochbuch
 * https://developers.lexware.io/cookbooks/invoices/. Abschnittsnamen stehen jeweils dabei; die Feldtabelle mit
 * Belegen steht in docs/lexware-format.md.
 *
 * Die eigentlichen Belegbauer (Texte § 35a/§ 13b, Terminvorschläge, Zahlungsziel) liegen in `belege.ts` und
 * `kontakte.ts` und werden hier nur verpackt und geprüft – es gibt genau eine Abbildung.
 */

// ——— Typen nach Doku ———

/** „Tax Conditions Details“ → taxType (für Verkaufsbelege beim Anlegen erlaubte Werte). */
export type LexwareSteuerart =
	| 'net'
	| 'gross'
	| 'vatfree'
	| 'intraCommunitySupply'
	| 'constructionService13b'
	| 'externalService13b'
	| 'thirdPartyCountryService'
	| 'thirdPartyCountryDelivery';
export const STEUERARTEN: readonly LexwareSteuerart[] = [
	'net', 'gross', 'vatfree', 'intraCommunitySupply', 'constructionService13b', 'externalService13b', 'thirdPartyCountryService', 'thirdPartyCountryDelivery'
];
/** Steuerarten, die laut Doku nur mit referenziertem Kontakt (`address.contactId`) gehen („Invoices Endpoint“ → Purpose). */
export const NUR_MIT_KONTAKT: readonly LexwareSteuerart[] = ['intraCommunitySupply', 'constructionService13b', 'externalService13b', 'thirdPartyCountryService', 'thirdPartyCountryDelivery'];

/** Kochbuch Rechnungen → „Steuersatz“: 0, 5, 7, 16, 19 (5/16 nur für Daten im Corona-Zeitraum 2020, FAQ „Valid Tax Rates“). */
export const STEUERSAETZE = [0, 5, 7, 16, 19] as const;

/** FAQ „Texts in Sales Vouchers“ + „Line Items Details“ + „Contacts“. */
export const GRENZEN = {
	title: 25,
	introduction: 2000,
	remark: 2000,
	lineItemName: 255,
	lineItemDescription: 2000,
	lineItems: 300,
	quantityNachkomma: 4,
	unitPriceNachkomma: 4,
	discountNachkomma: 2,
	salutation: 25,
	note: 1000
} as const;

export type LexwareAdresse = {
	contactId?: string;
	name?: string;
	supplement?: string;
	street?: string;
	city?: string;
	zip?: string;
	countryCode?: string;
};
export type LexwarePreis = { currency: 'EUR'; netAmount?: number; grossAmount?: number; taxRatePercentage: number };
export type LexwarePosition = {
	id?: string;
	type: 'custom' | 'material' | 'service' | 'text';
	name: string;
	description?: string;
	quantity?: number;
	unitName?: string;
	unitPrice?: LexwarePreis;
	discountPercentage?: number;
};
export type LexwareVersand = {
	shippingType: 'service' | 'serviceperiod' | 'delivery' | 'deliveryperiod' | 'none';
	shippingDate?: string;
	shippingEndDate?: string;
};
export type LexwareZahlung = {
	paymentTermLabel?: string;
	paymentTermDuration?: number;
	paymentDiscountConditions?: { discountPercentage: number; discountRange: number };
};
type BelegGemeinsam = {
	voucherDate: string;
	address: LexwareAdresse;
	lineItems: LexwarePosition[];
	totalPrice: { currency: 'EUR'; totalDiscountAbsolute?: number; totalDiscountPercentage?: number };
	taxConditions: { taxType: LexwareSteuerart; taxTypeNote?: string };
	paymentConditions?: LexwareZahlung;
	language?: 'de' | 'en';
	title?: string;
	introduction?: string;
	remark?: string;
};
/** POST /v1/quotations – Pflicht: voucherDate, expirationDate, address, lineItems, totalPrice, taxConditions. */
export type LexwareQuotation = BelegGemeinsam & { expirationDate: string };
/** POST /v1/order-confirmations – Pflicht zusätzlich shippingConditions. */
export type LexwareOrderConfirmation = BelegGemeinsam & { shippingConditions: LexwareVersand; deliveryTerms?: string };
/** POST /v1/invoices – Pflicht: voucherDate, address, lineItems, totalPrice, taxConditions, shippingConditions. */
export type LexwareInvoice = BelegGemeinsam & { shippingConditions: LexwareVersand; xRechnung?: { buyerReference: string } };

/** POST /v1/contacts – Pflicht: version (0), roles, person XOR company. */
export type LexwareKontakt = {
	version: number;
	roles: { customer?: Record<string, never>; vendor?: Record<string, never> };
	person?: { salutation?: string; firstName?: string; lastName: string };
	company?: {
		name: string;
		taxNumber?: string;
		vatRegistrationId?: string;
		allowTaxFreeInvoices?: boolean;
		contactPersons?: { salutation?: string; firstName?: string; lastName: string; primary?: boolean; emailAddress?: string; phoneNumber?: string }[];
	};
	addresses?: { billing?: Omit<LexwareAdresse, 'contactId' | 'name'>[]; shipping?: Omit<LexwareAdresse, 'contactId' | 'name'>[] };
	xRechnung?: { buyerReference: string; vendorNumberAtCustomer: string };
	emailAddresses?: Partial<Record<'business' | 'office' | 'private' | 'other', string[]>>;
	phoneNumbers?: Partial<Record<'business' | 'office' | 'mobile' | 'private' | 'fax' | 'other', string[]>>;
	note?: string;
};

export type ErwarteteSummen = { nettoCent: number; steuerCent: number; bruttoCent: number; jeSatz: { satz: number; nettoCent: number; steuerCent: number }[] };

/** Eine fertige Anfrage an Lexware. `fehler` ≠ leer → Lexware würde ablehnen (406/400), nicht senden. */
export type LexwareAnfrage<T> = {
	methode: 'POST';
	pfad: string;
	body: T;
	fehler: string[];
	warnungen: string[];
	erwartet?: ErwarteteSummen;
};

/** Paket für die spätere Anbindung: erst Kontakt (falls noch nicht in Lexware), dann der Beleg. */
export type LexwarePaket<T> = {
	format: 'lexware-office-v1';
	quelle: { art: 'angebot' | 'rechnung' | 'auftragsbestaetigung'; id: string; nummer: string | null };
	kontakt: LexwareAnfrage<LexwareKontakt> | null;
	beleg: LexwareAnfrage<T>;
	hinweise: string[];
};

// ——— Prüfung nach Doku (das „Schema“) ———

const DATUM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/; // FAQ „Datetime Format“
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAND = /^[A-Z]{2}(_[A-Z0-9]{1,3})?$/; // FAQ „Country Codes“ (ISO alpha-2, erweitert z. B. ES_CN)

const nachkomma = (x: number) => {
	const t = String(x);
	if (t.includes('e')) return 99;
	const i = t.indexOf('.');
	return i < 0 ? 0 : t.length - i - 1;
};
const leer = (s: unknown) => typeof s !== 'string' || s.trim() === '';

/** Prüft einen Verkaufsbeleg gegen die Pflichtfelder und Grenzen der Doku. Rückgabe: Fehlertexte (leer = gültig). */
export function pruefeBeleg(art: 'quotation' | 'orderconfirmation' | 'invoice', b: Partial<LexwareInvoice & LexwareQuotation>): string[] {
	const f: string[] = [];
	if (!DATUM.test(String(b.voucherDate ?? ''))) f.push('voucherDate fehlt oder ist nicht im Format yyyy-MM-ddTHH:mm:ss.SSSXXX');
	if (art === 'quotation' && !DATUM.test(String(b.expirationDate ?? ''))) f.push('expirationDate fehlt (Pflicht beim Angebot)');
	// Adresse („Address Required Properties“): contactId ODER name + countryCode
	const a = b.address;
	if (!a) f.push('address fehlt');
	else if (a.contactId !== undefined) {
		if (!UUID.test(a.contactId)) f.push('address.contactId ist keine UUID');
	} else {
		if (leer(a.name)) f.push('address.name fehlt (ohne Lexware-Kontakt Pflicht)');
		if (!LAND.test(String(a.countryCode ?? ''))) f.push('address.countryCode fehlt oder ist kein ISO-3166-alpha-2-Code');
	}
	// Steuer
	const typ = b.taxConditions?.taxType;
	if (!typ || !STEUERARTEN.includes(typ)) f.push('taxConditions.taxType fehlt oder ist unbekannt');
	if (typ && NUR_MIT_KONTAKT.includes(typ) && !a?.contactId) f.push(`taxType ${typ} geht nur mit einem Lexware-Kontakt (address.contactId)`);
	if (b.totalPrice?.currency !== 'EUR') f.push('totalPrice.currency muss EUR sein');
	// Positionen („Line Items Required Properties“)
	const pos = Array.isArray(b.lineItems) ? b.lineItems : [];
	if (pos.length === 0) f.push('lineItems: mindestens eine Position nötig');
	if (pos.length > GRENZEN.lineItems) f.push(`lineItems: höchstens ${GRENZEN.lineItems} Positionen`);
	let netto = 0;
	pos.forEach((p, i) => {
		const n = `lineItems[${i}]`;
		if (!['custom', 'material', 'service', 'text'].includes(p.type)) f.push(`${n}.type ungültig`);
		if (leer(p.name)) f.push(`${n}.name fehlt`);
		else if (p.name.length > GRENZEN.lineItemName) f.push(`${n}.name länger als ${GRENZEN.lineItemName} Zeichen`);
		if (p.description && p.description.length > GRENZEN.lineItemDescription) f.push(`${n}.description länger als ${GRENZEN.lineItemDescription} Zeichen`);
		if (p.type === 'text') return;
		if ((p.type === 'service' || p.type === 'material') && !UUID.test(String(p.id ?? ''))) f.push(`${n}.id fehlt (Pflicht bei service/material)`);
		if (typeof p.quantity !== 'number' || !Number.isFinite(p.quantity)) f.push(`${n}.quantity fehlt`);
		else if (nachkomma(p.quantity) > GRENZEN.quantityNachkomma) f.push(`${n}.quantity: höchstens 4 Nachkommastellen`);
		if (leer(p.unitName)) f.push(`${n}.unitName fehlt`);
		const u = p.unitPrice;
		if (!u) {
			f.push(`${n}.unitPrice fehlt`);
			return;
		}
		if (u.currency !== 'EUR') f.push(`${n}.unitPrice.currency muss EUR sein`);
		const betrag = typ === 'gross' ? u.grossAmount : u.netAmount;
		if (typeof betrag !== 'number' || !Number.isFinite(betrag)) f.push(`${n}.unitPrice.${typ === 'gross' ? 'grossAmount' : 'netAmount'} fehlt`);
		else {
			if (nachkomma(betrag) > GRENZEN.unitPriceNachkomma) f.push(`${n}.unitPrice: höchstens 4 Nachkommastellen`);
			netto += betrag * (p.quantity ?? 0);
		}
		if (!(STEUERSAETZE as readonly number[]).includes(u.taxRatePercentage)) f.push(`${n}.unitPrice.taxRatePercentage ${u.taxRatePercentage} ist kein gültiger Steuersatz`);
		if (typ && typ !== 'net' && typ !== 'gross' && u.taxRatePercentage !== 0) f.push(`${n}.unitPrice.taxRatePercentage muss bei ${typ} 0 sein`);
		if (p.discountPercentage !== undefined && (p.discountPercentage < 0 || p.discountPercentage > 100 || nachkomma(p.discountPercentage) > GRENZEN.discountNachkomma))
			f.push(`${n}.discountPercentage ungültig (0–100, 2 Nachkommastellen)`);
	});
	// Kochbuch Rechnungen → FAQ: „Der Gesamtbetrag einer Rechnung darf nicht negativ sein.“
	if (netto < 0) f.push('Gesamtbetrag ist negativ');
	// Versand/Leistungsdatum („Shipping Condition Required Properties“)
	if (art !== 'quotation') {
		const s = b.shippingConditions;
		if (!s) f.push('shippingConditions fehlt (Pflicht, Leistungsdatum)');
		else {
			if (!['service', 'serviceperiod', 'delivery', 'deliveryperiod', 'none'].includes(s.shippingType)) f.push('shippingConditions.shippingType ungültig');
			if (s.shippingType !== 'none' && !DATUM.test(String(s.shippingDate ?? ''))) f.push('shippingConditions.shippingDate fehlt');
			if ((s.shippingType === 'serviceperiod' || s.shippingType === 'deliveryperiod') && !DATUM.test(String(s.shippingEndDate ?? '')))
				f.push('shippingConditions.shippingEndDate fehlt (Zeitraum)');
			if (s.shippingEndDate && s.shippingDate && Date.parse(s.shippingEndDate) < Date.parse(s.shippingDate)) f.push('shippingConditions.shippingEndDate liegt vor shippingDate');
		}
	}
	const z = b.paymentConditions;
	if (z?.paymentTermDuration !== undefined && (!Number.isInteger(z.paymentTermDuration) || z.paymentTermDuration < 0)) f.push('paymentConditions.paymentTermDuration muss eine ganze Zahl ≥ 0 sein');
	// Texte (FAQ „Texts in Sales Vouchers“)
	if (b.title && b.title.length > GRENZEN.title) f.push(`title länger als ${GRENZEN.title} Zeichen`);
	if (b.introduction && b.introduction.length > GRENZEN.introduction) f.push(`introduction länger als ${GRENZEN.introduction} Zeichen`);
	if (b.remark && b.remark.length > GRENZEN.remark) f.push(`remark länger als ${GRENZEN.remark} Zeichen`);
	return f;
}

/** Prüft einen Kontakt gegen „Create a Contact“ (Pflichtfelder) und die Einschränkungen „höchstens ein Eintrag“. */
export function pruefeKontakt(k: Partial<LexwareKontakt>): string[] {
	const f: string[] = [];
	if (k.version !== 0) f.push('version muss beim Anlegen 0 sein');
	if (!k.roles || (!k.roles.customer && !k.roles.vendor)) f.push('roles: mindestens eine Rolle (customer)');
	if (!!k.person === !!k.company) f.push('genau eines von person oder company angeben');
	if (k.person && leer(k.person.lastName)) f.push('person.lastName fehlt');
	if (k.company) {
		if (leer(k.company.name)) f.push('company.name fehlt');
		const cp = k.company.contactPersons ?? [];
		if (cp.length > 1) f.push('company.contactPersons: höchstens eine Ansprechperson');
		if (cp.some((p) => leer(p.lastName))) f.push('company.contactPersons[].lastName fehlt');
		if (cp.some((p) => (p.salutation ?? '').length > GRENZEN.salutation)) f.push('Anrede länger als 25 Zeichen');
	}
	if ((k.person?.salutation ?? '').length > GRENZEN.salutation) f.push('Anrede länger als 25 Zeichen');
	for (const liste of ['billing', 'shipping'] as const) {
		const l = k.addresses?.[liste] ?? [];
		if (l.length > 1) f.push(`addresses.${liste}: höchstens eine Adresse`);
		if (l.some((a) => !LAND.test(String(a.countryCode ?? '')))) f.push(`addresses.${liste}[].countryCode fehlt (Pflicht)`);
	}
	for (const [feld, obj] of [['emailAddresses', k.emailAddresses], ['phoneNumbers', k.phoneNumbers]] as const)
		for (const [art, werte] of Object.entries(obj ?? {})) if ((werte ?? []).length > 1) f.push(`${feld}.${art}: höchstens ein Eintrag`);
	if (k.xRechnung && (leer(k.xRechnung.buyerReference) || leer(k.xRechnung.vendorNumberAtCustomer))) f.push('xRechnung braucht buyerReference UND vendorNumberAtCustomer');
	if ((k.note ?? '').length > GRENZEN.note) f.push('note länger als 1000 Zeichen');
	return f;
}

// ——— Summen so, wie Lexware sie rechnet ———

/**
 * Lexware rechnet Brutto und Steuer selbst (Kochbuch Rechnungen → FAQ: „lediglich der Nettobetrag und der Steuersatz“).
 * Nachgerechnet: Position = round(Menge × Netto-Einzelpreis, 2) − Rabatt, Steuer je Satz = round(Σ Netto × Satz %, 2).
 * Ganzzahlig in 1/10 000 Cent (Menge und Preis haben höchstens 4 Nachkommastellen) – ohne Gleitkommafehler.
 */
export function erwarteteSummen(b: Pick<BelegGemeinsam, 'lineItems' | 'taxConditions'>): ErwarteteSummen {
	const skala = (x: number, stellen: number) => BigInt(Math.round(x * 10 ** stellen));
	const rund = (z: bigint, n: bigint) => {
		const neg = z < 0n;
		const q = ((neg ? -z : z) * 2n + n) / (2n * n);
		return neg ? -q : q;
	};
	const jeSatz = new Map<number, bigint>();
	for (const p of b.lineItems) {
		if (p.type === 'text' || !p.unitPrice) continue;
		const preis = b.taxConditions.taxType === 'gross' ? (p.unitPrice.grossAmount ?? 0) : (p.unitPrice.netAmount ?? 0);
		// Menge × Preis: 4 + 4 Nachkommastellen → in Cent (2) runden
		let cent = rund(skala(p.quantity ?? 0, 4) * skala(preis, 4), 1_000_000n);
		if (p.discountPercentage) cent -= rund(cent * skala(p.discountPercentage, 2), 10_000n);
		jeSatz.set(p.unitPrice.taxRatePercentage, (jeSatz.get(p.unitPrice.taxRatePercentage) ?? 0n) + cent);
	}
	const zeilen = [...jeSatz.entries()].sort((x, y) => x[0] - y[0]).map(([satz, n]) => {
		// Brutto-Belege: Steuer aus dem Bruttobetrag herausrechnen
		const st = b.taxConditions.taxType === 'gross' ? n - rund(n * 100n, BigInt(100 + satz)) : rund(n * BigInt(satz), 100n);
		return { satz, nettoCent: Number(b.taxConditions.taxType === 'gross' ? n - st : n), steuerCent: Number(st) };
	});
	const nettoCent = zeilen.reduce((s, z) => s + z.nettoCent, 0);
	const steuerCent = zeilen.reduce((s, z) => s + z.steuerCent, 0);
	return { nettoCent, steuerCent, bruttoCent: nettoCent + steuerCent, jeSatz: zeilen };
}

// ——— CRM → Lexware ———

export type KundeFuerLexware = KundeDaten & {
	/** optional, sobald das CRM diese Felder führt (offene Punkte in docs/lexware-format.md) */
	ustId?: string | null;
	steuernummer?: string | null;
	leitwegId?: string | null;
	lieferantennummerBeimKunden?: string | null;
};

/** Kunde → POST /v1/contacts (Rolle customer). Baut auf `kontaktAusKunde` auf und ergänzt Steuer-/XRechnung-Felder. */
export function kontaktZuLexware(kd: KundeFuerLexware): LexwareAnfrage<LexwareKontakt> {
	const body = kontaktAusKunde(kd) as LexwareKontakt;
	const warnungen: string[] = [];
	const land = landAusPlz(kd.plz);
	if (land.warnung && (kd.strasse || kd.plz || kd.ort)) warnungen.push(land.warnung);
	if (body.company) {
		if (kd.ustId?.trim()) body.company.vatRegistrationId = kd.ustId.trim();
		if (kd.steuernummer?.trim()) body.company.taxNumber = kd.steuernummer.trim();
	}
	if (kd.leitwegId?.trim()) {
		if (kd.lieferantennummerBeimKunden?.trim()) body.xRechnung = { buyerReference: kd.leitwegId.trim(), vendorNumberAtCustomer: kd.lieferantennummerBeimKunden.trim() };
		else warnungen.push('Leitweg-ID vorhanden, aber keine Lieferantennummer beim Kunden – Lexware verlangt beides für XRechnung; Leitweg-ID wird nicht übertragen.');
	}
	return { methode: 'POST', pfad: '/v1/contacts', body, fehler: pruefeKontakt(body), warnungen };
}

const mitQuery = (pfad: string, q: Record<string, string | boolean | null | undefined>) => {
	const teile = Object.entries(q)
		.filter(([, v]) => v !== null && v !== undefined && v !== false)
		.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
	return teile.length ? `${pfad}?${teile.join('&')}` : pfad;
};

function belegAnfrage<T extends BelegGemeinsam>(art: 'quotation' | 'orderconfirmation' | 'invoice', pfad: string, body: T, warnungen: string[]): LexwareAnfrage<T> {
	const fehler = pruefeBeleg(art, body as never);
	const w = [...warnungen];
	if (!body.address.contactId) w.push('Kein Lexware-Kontakt: Lexware bucht den Beleg auf den Sammelkunden (Einmal-Adresse). Erst den Kontakt anlegen und die ID als address.contactId setzen.');
	return { methode: 'POST', pfad, body, fehler, warnungen: w, erwartet: erwarteteSummen(body) };
}

/** Angebot → POST /v1/quotations[?finalize=true] (ohne finalize = Entwurf in Lexware). */
export function angebotZuLexwareQuotation(e: BelegEingabe, opt: { festschreiben?: boolean } = {}): LexwareAnfrage<LexwareQuotation> {
	const b = angebotAlsLexware(e);
	return belegAnfrage('quotation', mitQuery('/v1/quotations', { finalize: opt.festschreiben === true }), b.body as unknown as LexwareQuotation, b.warnungen);
}

/** Auftragsbestätigung → POST /v1/order-confirmations?precedingSalesVoucherId={Angebot}[&finalize=true]. */
export function abZuLexwareOrderConfirmation(
	e: Parameters<typeof abAlsLexware>[0],
	opt: { angebotLexwareId?: string | null; festschreiben?: boolean } = {}
): LexwareAnfrage<LexwareOrderConfirmation> {
	const b = abAlsLexware(e);
	const pfad = mitQuery('/v1/order-confirmations', { precedingSalesVoucherId: opt.angebotLexwareId ?? null, finalize: opt.festschreiben === true });
	return belegAnfrage('orderconfirmation', pfad, b.body as unknown as LexwareOrderConfirmation, b.warnungen);
}

/**
 * Rechnung bzw. Rechnungsentwurf → POST /v1/invoices[?precedingSalesVoucherId={AB|Angebot}][&finalize=true].
 * Ohne `festschreiben` legt Lexware einen Entwurf an (Doku „Create an Invoice“) – die Nummer verbraucht Lexware
 * trotzdem (Kochbuch Rechnungen → FAQ).
 */
export function rechnungZuLexwareInvoice(e: RechnungEingabe, opt: { vorgaengerLexwareId?: string | null; festschreiben?: boolean } = {}): LexwareAnfrage<LexwareInvoice> {
	const b = rechnungAlsLexware(e);
	const pfad = mitQuery('/v1/invoices', { precedingSalesVoucherId: opt.vorgaengerLexwareId ?? null, finalize: opt.festschreiben === true });
	return belegAnfrage('invoice', pfad, b.body as unknown as LexwareInvoice, b.warnungen);
}
