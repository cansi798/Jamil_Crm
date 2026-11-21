import { positionsSumme, summen, type MwstSatz } from '../../geld';
import { tagDeutsch, wochentag } from '../../zeit';
import { adresseLand } from './land';

/**
 * Verkaufsbelege für Lexware bauen (rein, ohne Datenbank) – Angebot und Auftragsbestätigung (Plan Phase 2, Tasks T5,
 * T6, T10). Felder nach https://developers.lexware.io/docs/ („Quotations“, „Order Confirmations“, gelesen 15.11.2026):
 * Pflicht beim Angebot `voucherDate`, `expirationDate`, `address`, `lineItems`, `totalPrice`, `taxConditions`; bei der
 * Auftragsbestätigung zusätzlich `shippingConditions` (ohne `expirationDate`). `address.contactId` für bestehende
 * Kontakte, sonst `name` + `countryCode`. Positionen `type: custom` mit `name`, `quantity`, `unitName`,
 * `unitPrice {currency, netAmount, taxRatePercentage}` (Satz 0 bei vatfree/§ 13b). Längen: title 25, introduction
 * und remark 2000, Positionsbeschreibung 2000. Alternativ-/Bedarfspositionen schickt das CRM nie (sonst 406 beim
 * Weiterführen zur AB/Rechnung).
 *
 * Pflichttexte (Plan Abschnitt 2, Jamil #6093 „§ 35a + § 13b berücksichtigen“):
 * - § 13b UStG (Firmenkunde ist Bauleister, Bescheinigung gültig am Belegdatum) → `taxType: constructionService13b`;
 *   Lexware druckt den Hinweis „Steuerschuldnerschaft des Leistungsempfängers“ selbst.
 * - § 35a EStG (nur Privatkunden): Arbeitskosten = (Einzelpreis − Materialanteil) × Menge, brutto, als Satz in `remark`
 *   (Lexware hat dafür kein Feld). Fehlt bei einer Position der Materialanteil, rät das CRM nicht: kein Betrag, Warnung.
 */

export type BelegPosition = {
	bezeichnung: string;
	beschreibung: string | null;
	menge: number;
	einheit: string;
	einzelpreisCent: number;
	/** Materialanteil je Einheit (null = unbekannt, z. B. freie Position) */
	materialCent: number | null;
};
export type BelegKunde = {
	lexwareId: string | null;
	art: 'privat' | 'firma';
	name: string;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
	bauleister13b: boolean;
	bescheinigung13bBis: string | null;
	/** Migration 125: Land (ISO alpha-2; null = aus PLZ-Kürzel bzw. DE) und USt-IdNr. (für § 13b Pflicht) */
	land?: string | null;
	ustId?: string | null;
};
export type Terminvorschlag = { pos: number; beginn: string; hinweis: string | null };
export type BelegEingabe = {
	datum: string;
	gueltigBis: string;
	mwstSatz: MwstSatz;
	einleitung: string | null;
	schluss: string | null;
	positionen: BelegPosition[];
	kunde: BelegKunde;
	kleinunternehmer: boolean;
	termine: Terminvorschlag[];
};
export type LexwareBeleg = { body: Record<string, unknown>; warnungen: string[]; steuer: SteuerFall };

const TEXT_MAX = 2000;
const kuerze = (s: string, n = TEXT_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Berliner Versatz eines Tages (+01:00 bzw. +02:00). */
function versatz(tag: string): string {
	const d = new Date(`${tag}T12:00:00Z`);
	const teil = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
		.formatToParts(d)
		.find((p) => p.type === 'timeZoneName')?.value;
	const m = /GMT([+-]\d{2}:\d{2})/.exec(teil ?? '');
	return m ? m[1] : '+01:00';
}

/** „2026-11-15“ → „2026-11-15T00:00:00.000+01:00“ (Format der Lexware-Doku). */
export function lexwareDatum(tag: string): string {
	return `${tag}T00:00:00.000${versatz(tag)}`;
}

const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const tagMitWochentag = (tag: string) => `${WT[wochentag(tag)]} ${tagDeutsch(tag)}`;
export const euro = (cent: number) => `${(cent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** `fehler`: Lexware würde den Beleg ablehnen – nicht senden (z. B. § 13b ohne USt-IdNr.). */
export type SteuerFall = { taxType: 'net' | 'vatfree' | 'constructionService13b'; satz: number; warnung: string | null; fehler?: string | null };

/** Kochbuch Rechnungen → „FAQ und Hinweise“: § 13b nur mit Firmenkontakt mit gültiger USt-ID. */
export const FEHLER_13B_OHNE_UST = '§ 13b: Beim Kunden fehlt die USt-IdNr. – Lexware nimmt Belege nach § 13b nur mit USt-IdNr. an. Bitte beim Kunden eintragen.';

export function steuerFall(e: { kunde: BelegKunde; kleinunternehmer: boolean; mwstSatz: MwstSatz; datum: string }): SteuerFall {
	if (e.kleinunternehmer) return { taxType: 'vatfree', satz: 0, warnung: null };
	if (e.kunde.art === 'firma' && e.kunde.bauleister13b) {
		if (e.kunde.bescheinigung13bBis && e.kunde.bescheinigung13bBis >= e.datum)
			return e.kunde.ustId?.trim()
				? { taxType: 'constructionService13b', satz: 0, warnung: null }
				: { taxType: 'constructionService13b', satz: 0, warnung: FEHLER_13B_OHNE_UST, fehler: FEHLER_13B_OHNE_UST };
		return {
			taxType: 'net',
			satz: e.mwstSatz,
			warnung: `§ 13b: Die Bescheinigung des Kunden ist abgelaufen (${e.kunde.bescheinigung13bBis ? tagDeutsch(e.kunde.bescheinigung13bBis) : 'ohne Datum'}) – Beleg mit Umsatzsteuer. Bitte neue Bescheinigung anfordern.`
		};
	}
	return { taxType: 'net', satz: e.mwstSatz, warnung: null };
}

/** § 35a EStG: Arbeitskosten (netto, MwSt, brutto) und die Positionen (1-basiert), bei denen der Materialanteil fehlt. */
export function arbeitskosten35a(positionen: readonly BelegPosition[], satz: number): { nettoCent: number; mwstCent: number; bruttoCent: number; unvollstaendig: number[] } {
	const unvollstaendig: number[] = [];
	const lohn = positionen.map((p, i) => {
		if (p.materialCent === null || p.materialCent === undefined) {
			unvollstaendig.push(i + 1);
			return { menge: p.menge, einzelpreisCent: 0 };
		}
		return { menge: p.menge, einzelpreisCent: Math.max(0, p.einzelpreisCent - p.materialCent) };
	});
	const s = summen(lohn, satz as MwstSatz);
	return { nettoCent: s.nettoCent, mwstCent: s.mwstCent, bruttoCent: s.bruttoCent, unvollstaendig };
}

export function termineText(termine: readonly Terminvorschlag[]): string | null {
	if (termine.length === 0) return null;
	const liste = [...termine]
		.sort((a, b) => a.pos - b.pos)
		.map((t, i) => `${i + 1}) ${tagMitWochentag(t.beginn)}${t.hinweis ? ` (${t.hinweis})` : ''}`)
		.join(' ');
	return `Mögliche Termine für den Baubeginn: ${liste}. Bitte wählen Sie bei der Annahme einen Termin; bis dahin unverbindlich.`;
}

function text35a(e: BelegEingabe, satz: number, warnungen: string[]): string | null {
	if (e.kunde.art !== 'privat') return null;
	const a = arbeitskosten35a(e.positionen, satz);
	if (a.unvollstaendig.length > 0) {
		warnungen.push(`§ 35a: Bei Position ${a.unvollstaendig.join(', ')} fehlt der Materialanteil – die Arbeitskosten werden nicht ausgewiesen. Bitte im Katalog Lohn und Material pflegen.`);
		return 'Die Arbeitskosten nach § 35a EStG weisen wir in der Rechnung aus. Bitte überweisen Sie den Rechnungsbetrag – Barzahlung ist nicht begünstigt.';
	}
	if (a.bruttoCent === 0) return null;
	return `Im Gesamtbetrag enthaltene Arbeitskosten nach § 35a EStG: ${euro(a.bruttoCent)} (darin ${euro(a.mwstCent)} MwSt). Bitte überweisen Sie den Rechnungsbetrag – Barzahlung ist nicht begünstigt.`;
}

function adresse(k: BelegKunde): Record<string, unknown> {
	if (k.lexwareId) return { contactId: k.lexwareId };
	const a: Record<string, unknown> = { name: kuerze(k.name || 'Kunde', 255) };
	const land = adresseLand(k.land, k.plz);
	if (k.strasse) a.street = kuerze(k.strasse, 255);
	if (land.zip) a.zip = kuerze(land.zip, 20);
	if (k.ort) a.city = kuerze(k.ort, 255);
	a.countryCode = land.countryCode;
	return a;
}

function positionen(e: BelegEingabe, satz: number): Record<string, unknown>[] {
	return e.positionen.slice(0, 300).map((p) => {
		const z: Record<string, unknown> = { type: 'custom', name: kuerze(p.bezeichnung, 255) };
		if (p.beschreibung) z.description = kuerze(p.beschreibung);
		z.quantity = p.menge;
		z.unitName = p.einheit;
		z.unitPrice = { currency: 'EUR', netAmount: p.einzelpreisCent / 100, taxRatePercentage: satz };
		z.discountPercentage = 0;
		return z;
	});
}

const verbinde = (teile: (string | null | undefined)[]) => kuerze(teile.filter((t): t is string => !!t && t.trim() !== '').join('\n\n'));

export function angebotAlsLexware(e: BelegEingabe): LexwareBeleg {
	const warnungen: string[] = [];
	const steuer = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: e.datum });
	if (steuer.warnung) warnungen.push(steuer.warnung);
	const body: Record<string, unknown> = {
		voucherDate: lexwareDatum(e.datum),
		expirationDate: lexwareDatum(e.gueltigBis),
		address: adresse(e.kunde),
		lineItems: positionen(e, steuer.satz),
		totalPrice: { currency: 'EUR' },
		taxConditions: { taxType: steuer.taxType },
		title: 'Angebot'
	};
	if (e.einleitung) body.introduction = kuerze(e.einleitung);
	const remark = verbinde([termineText(e.termine), text35a(e, steuer.satz, warnungen), e.schluss]);
	if (remark) body.remark = remark;
	return { body, warnungen, steuer };
}

/** Auftragsbestätigung aus dem angenommenen Angebot (Vorgänger setzt der Aufrufer per `precedingSalesVoucherId`). */
export function abAlsLexware(e: BelegEingabe & { angebotNummer: string; heute: string; termin: string | null; terminWunsch: string | null }): LexwareBeleg {
	const warnungen: string[] = [];
	const steuer = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: e.heute });
	if (steuer.warnung) warnungen.push(steuer.warnung);
	const terminSatz = e.termin
		? `Baubeginn: ${tagMitWochentag(e.termin)} (von Ihnen gewählt).`
		: e.terminWunsch
			? `Ihr Terminwunsch: „${e.terminWunsch}“ – wir melden uns zur Abstimmung.`
			: 'Wir melden uns zur Terminabstimmung.';
	const body: Record<string, unknown> = {
		voucherDate: lexwareDatum(e.heute),
		address: adresse(e.kunde),
		lineItems: positionen(e, steuer.satz),
		totalPrice: { currency: 'EUR' },
		taxConditions: { taxType: steuer.taxType },
		shippingConditions: e.termin ? { shippingType: 'service', shippingDate: lexwareDatum(e.termin) } : { shippingType: 'none' },
		title: 'Auftragsbestätigung',
		introduction: kuerze(`Vielen Dank für Ihren Auftrag. Hiermit bestätigen wir die Annahme unseres Angebots ${e.angebotNummer}. ${terminSatz}`)
	};
	const remark = verbinde([text35a(e, steuer.satz, warnungen), 'Bei Fragen erreichen Sie uns jederzeit.']);
	if (remark) body.remark = remark;
	return { body, warnungen, steuer };
}

/** Bruttosumme, wie Lexware sie für die Belegliste ausweist (für die Suche nach einem schon angelegten Beleg). */
export function bruttoCent(e: Pick<BelegEingabe, 'positionen'>, satz: number): number {
	let netto = 0;
	for (const p of e.positionen) netto += positionsSumme(p.menge, p.einzelpreisCent);
	return summen([{ menge: 1, einzelpreisCent: netto }], satz as MwstSatz).bruttoCent;
}

// ——— Phase 3: Rechnung und Mahnung (Doku „Invoices“, „Dunnings“, gelesen 15.11.2026) ———

export type RechnungEingabe = {
	heute: string;
	mwstSatz: MwstSatz;
	positionen: BelegPosition[];
	kunde: BelegKunde;
	kleinunternehmer: boolean;
	leistungVon: string;
	leistungBis: string;
	zahlungszielTage: number;
	titel: 'Rechnung' | 'Teilrechnung';
	bezug: string | null;
};

/** Pflichttexte nur für Privatkunden (Plan Abschnitt 2): Verzug § 286 Abs. 3 BGB, Aufbewahrung § 14 Abs. 4 Nr. 9 UStG. */
export const TEXT_286 = 'Sie kommen spätestens 30 Tage nach Fälligkeit und Zugang dieser Rechnung in Verzug (§ 286 Abs. 3 BGB).';
export const TEXT_AUFBEWAHRUNG = 'Bitte bewahren Sie diese Rechnung zwei Jahre auf (§ 14 Abs. 4 Nr. 9 UStG).';

export function zahlungsBedingung(tage: number): Record<string, unknown> {
	return { paymentTermLabel: tage === 0 ? 'Zahlbar sofort ohne Abzug' : `Zahlbar innerhalb von ${tage} Tagen ohne Abzug`, paymentTermDuration: tage };
}

/**
 * Rechnung für POST /v1/invoices (Pflicht: voucherDate, address, lineItems, totalPrice, taxConditions,
 * shippingConditions; Zahlungsziel über paymentConditions.paymentTermDuration). Leistungszeitraum: ein Tag →
 * `service` mit shippingDate, sonst `serviceperiod` mit shippingDate + shippingEndDate.
 */
export function rechnungAlsLexware(e: RechnungEingabe): LexwareBeleg {
	const warnungen: string[] = [];
	const steuer = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: e.heute });
	if (steuer.warnung) warnungen.push(steuer.warnung);
	if (e.positionen.length === 0) warnungen.push('Keine Position ausgewählt.');
	const be: BelegEingabe = { datum: e.heute, gueltigBis: e.heute, mwstSatz: e.mwstSatz, einleitung: null, schluss: null, positionen: e.positionen, kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, termine: [] };
	const privat = e.kunde.art === 'privat';
	const body: Record<string, unknown> = {
		voucherDate: lexwareDatum(e.heute),
		address: adresse(e.kunde),
		lineItems: positionen(be, steuer.satz),
		totalPrice: { currency: 'EUR' },
		taxConditions: { taxType: steuer.taxType },
		paymentConditions: zahlungsBedingung(e.zahlungszielTage),
		shippingConditions:
			e.leistungVon === e.leistungBis
				? { shippingType: 'service', shippingDate: lexwareDatum(e.leistungVon) }
				: { shippingType: 'serviceperiod', shippingDate: lexwareDatum(e.leistungVon), shippingEndDate: lexwareDatum(e.leistungBis) },
		title: e.titel,
		introduction: kuerze(`Für unsere Leistungen${e.bezug ? ` (${e.bezug})` : ''} berechnen wir Ihnen:`)
	};
	const remark = verbinde([privat ? text35aRechnung(be, steuer.satz, warnungen) : null, privat ? TEXT_286 : null, privat ? TEXT_AUFBEWAHRUNG : null, 'Vielen Dank für Ihren Auftrag.']);
	if (remark) body.remark = remark;
	return { body, warnungen, steuer };
}

/** § 35a auf der Rechnung: mit Betrag; fehlt ein Materialanteil, kein geratener Betrag (Warnung, nur Überweisungshinweis). */
function text35aRechnung(e: BelegEingabe, satz: number, warnungen: string[]): string | null {
	const a = arbeitskosten35a(e.positionen, satz);
	if (a.unvollstaendig.length > 0) {
		warnungen.push(`§ 35a: Bei Position ${a.unvollstaendig.join(', ')} fehlt der Materialanteil – die Arbeitskosten stehen nicht auf der Rechnung. Bitte im Lexware-Entwurf ergänzen.`);
		return 'Bitte überweisen Sie den Rechnungsbetrag – Barzahlung ist nach § 35a EStG nicht begünstigt.';
	}
	if (a.bruttoCent === 0) return null;
	return `Im Rechnungsbetrag enthaltene Arbeitskosten nach § 35a EStG: ${euro(a.bruttoCent)} (darin ${euro(a.mwstCent)} MwSt). Bitte überweisen Sie den Rechnungsbetrag – Barzahlung ist nicht begünstigt.`;
}

export type MahnungEingabe = {
	heute: string;
	kunde: BelegKunde;
	taxType: SteuerFall['taxType'];
	stufe: number;
	rechnungNummer: string;
	gebuehrCent: number;
	pauschaleCent: number;
	zinsHinweis: string | null;
};

/**
 * Mahnung für POST /v1/dunnings?precedingSalesVoucherId={Rechnung} (bleibt laut Doku immer Entwurf, Kontakt und
 * Steuerart müssen zur Rechnung passen). Mahngebühr und Pauschale als Positionen mit 0 % (kein Entgelt, nicht
 * steuerbar); Verzugszinsen nur als Hinweis im Text (Plan Entscheidung 6). Ohne Gebühr eine Textposition.
 */
export function mahnungAlsLexware(e: MahnungEingabe): Record<string, unknown> {
	const zeilen: Record<string, unknown>[] = [];
	const preis = (cent: number) => ({ currency: 'EUR', netAmount: cent / 100, taxRatePercentage: 0 });
	if (e.gebuehrCent > 0) zeilen.push({ type: 'custom', name: 'Mahngebühr', quantity: 1, unitName: 'pauschal', unitPrice: preis(e.gebuehrCent), discountPercentage: 0 });
	if (e.pauschaleCent > 0) zeilen.push({ type: 'custom', name: 'Verzugspauschale (§ 288 Abs. 5 BGB)', quantity: 1, unitName: 'pauschal', unitPrice: preis(e.pauschaleCent), discountPercentage: 0 });
	if (zeilen.length === 0) zeilen.push({ type: 'text', name: `${e.stufe}. Mahnung`, description: `Zur Rechnung ${e.rechnungNummer}` });
	return {
		voucherDate: lexwareDatum(e.heute),
		address: adresse(e.kunde),
		lineItems: zeilen,
		totalPrice: { currency: 'EUR' },
		taxConditions: { taxType: e.taxType },
		title: `${e.stufe}. Mahnung`,
		introduction: kuerze(`Leider konnten wir zu unserer Rechnung ${e.rechnungNummer} noch keinen vollständigen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag umgehend.`),
		remark: verbinde([e.zinsHinweis, 'Sollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.'])
	};
}
