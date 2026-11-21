import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext, type TransactionSql } from '../db';
import { UUID, anzeigeName } from '../kunden';
import { berlinTag, istTag, tagDeutsch } from '../../zeit';
import { euro, leseEuroInCent, leseMenge, summen, type MwstSatz } from '../../geld';
import {
	abschlagBetrag,
	passtFilter,
	schlussBetrag,
	zahlStatus,
	type RechnungFilter,
	type ZahlStatus
} from '../../rechnungen';
import { zustaendig } from '../auftragsbestaetigung';
import { mailVersandFuer, sendeMail } from '../mail/versand';
import { baueMail, holeSignatur, mailWerte, vorlageFuer } from '../mail-vorlagen';
import { LexwareFehler, type LexwareClient } from './client';
import { bruttoCent, rechnungAlsLexware, steuerFall, type BelegPosition } from './belege';
import { belegEingabe, deeplink, findeBeleg, sichereKontakt, sicher, speichereDatei } from './angebote';
import { holeClient } from './konfig';
import { lexwareBelegModus } from './modus';
import { stelleEin, type Handler } from './warteschlange';
import { stosseLexwareAn } from './anstoss';

/**
 * Rechnungen über Lexware (Plan Phase 3, Tasks T7/T8; docs/superpowers/plans/2026-11-15-lexware-phase3.md).
 *
 * Dialog am Auftrag → `app.rechnungen` (Snapshot der Positionen, Zeitraum, Zahlungsziel) → Warteschlange
 * `rechnung_anlegen`: POST /v1/invoices?precedingSalesVoucherId={AB|Angebot}[&finalize=true] (Standard Entwurf) →
 * `rechnung_holen`: GET /v1/invoices/{id} → Spiegel `app.lexware_belege`, bei festgeschrieben PDF + Aufgabe „senden“,
 * sonst Aufgabe „in Lexware prüfen und festschreiben“ (Deeplink). Zahlungsstand: `zahlung_holen` (GET /v1/payments/{id})
 * nach `payment.changed` bzw. wenn der Abgleich einen geänderten offenen Betrag sieht. Abschlag/Schluss: nur
 * vorbereitet (die API kann sie nicht anlegen) → „In Lexware fertigstellen“, der Abgleich ordnet zu.
 * Lexware-Antworten sind Daten: IDs per UUID, Nummern ≤ 40 Zeichen, Beträge → Cent.
 */

type Roh = Record<string, any>;
const NUMMER = /^[\p{L}\p{N} ._/-]{1,40}$/u;
const RE_STATUS = ['draft', 'open', 'overdue', 'paid', 'paidoff', 'voided'];
const cent = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null);
const tag10 = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
export const RECHNUNG_TYP_PFAD = { invoice: 'invoices', downpaymentinvoice: 'down-payment-invoices' } as const;

export type RechnungPosition = BelegPosition;

// ——— Vorschlag für den Dialog ———

export type RechnungsVorschlag = {
	lexware: boolean;
	angebot: { id: string; nummer: string } | null;
	ab: { nummer: string } | null;
	vorgaengerLink: string | null;
	positionen: (RechnungPosition & { bisherMenge: number })[];
	mwstSatz: MwstSatz;
	leistungVon: string;
	leistungBis: string;
	zahlungszielTage: number;
	gesamtBruttoCent: number;
	abschlaege: { id: string; nummer: string | null; bruttoCent: number; storniert: boolean }[];
	bisher: number;
	wartet: boolean;
	grund: string | null;
};

async function angenommenesAngebot(tx: TransactionSql, k: Kontext, auftragId: string): Promise<Roh | undefined> {
	const [an] = await tx`
		select an.id, an.nummer, an.lexware_id, ab.nummer as ab_nummer, ab.lexware_id as ab_lexware_id
		from app.angebote an left join app.auftragsbestaetigungen ab on ab.angebot_id = an.id and ab.betrieb_id = an.betrieb_id
		where an.betrieb_id = ${k.betriebId} and an.auftrag_id = ${auftragId} and an.status = 'angenommen'
		order by an.angelegt desc limit 1`;
	return an;
}

export function pruefeAuftragId(id: unknown): string {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	return id.toLowerCase();
}
export function pruefeRechnungId(id: unknown): string {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Rechnung nicht gefunden.');
	return id.toLowerCase();
}

export async function rechnungsVorschlag(k: Kontext, auftragIdRoh: string, heute = berlinTag(new Date())): Promise<RechnungsVorschlag> {
	const auftragId = pruefeAuftragId(auftragIdRoh);
	const lexware = await lexwareBelegModus(k);
	const basis = await mitBetrieb(k, async (tx) => {
		const [a] = await tx`select id, to_char(baubeginn, 'YYYY-MM-DD') as baubeginn from app.auftraege where id = ${auftragId} and betrieb_id = ${k.betriebId}`;
		if (!a) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
		const an = await angenommenesAngebot(tx, k, auftragId);
		const [e] = await tx`
			select to_char(min(beginn at time zone 'Europe/Berlin'), 'YYYY-MM-DD') as von, to_char(max(ende at time zone 'Europe/Berlin'), 'YYYY-MM-DD') as bis
			from app.einsaetze where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} and beginn <= now()`;
		const [cfg] = await tx`select zahlungsziel_tage from app.mahn_konfig where betrieb_id = ${k.betriebId}`;
		const vorher = await tx`
			select r.art, r.phase, r.positionen, r.brutto_cent, b.brutto_cent as lx_brutto, b.status, b.nummer, r.id
			from app.rechnungen r left join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
			where r.betrieb_id = ${k.betriebId} and r.auftrag_id = ${auftragId} and r.phase <> 'fehler'`;
		return { a, an, e, cfg, vorher };
	});
	const grund = !lexware ? 'Rechnungen entstehen nur in Lexware – bitte zuerst Lexware verbinden (Einstellungen → Lexware verbinden).' : !basis.an ? 'Zu diesem Auftrag gibt es noch kein angenommenes Angebot.' : null;
	let positionen: RechnungsVorschlag['positionen'] = [];
	let mwstSatz: MwstSatz = 19;
	if (basis.an) {
		const e = await belegEingabe(k, basis.an.id);
		mwstSatz = e.mwstSatz;
		// schon abgerechnete Mengen (Gesamt-/Teilrechnungen, nicht storniert) je Bezeichnung
		const bisher = new Map<string, number>();
		for (const r of basis.vorher)
			if ((r.art === 'rechnung' || r.art === 'teil') && r.status !== 'voided')
				for (const p of (r.positionen ?? []) as RechnungPosition[]) bisher.set(p.bezeichnung, (bisher.get(p.bezeichnung) ?? 0) + Number(p.menge));
		positionen = e.positionen.map((p) => ({ ...p, bisherMenge: bisher.get(p.bezeichnung) ?? 0 }));
	}
	const gesamtBruttoCent = basis.an ? bruttoCent({ positionen }, mwstSatz) : 0;
	const von = basis.a.baubeginn && basis.a.baubeginn <= heute ? basis.a.baubeginn : (basis.e?.von ?? heute);
	const bis = basis.e?.bis && basis.e.bis <= heute && basis.e.bis >= von ? basis.e.bis : heute < von ? von : heute;
	return {
		lexware,
		angebot: basis.an ? { id: basis.an.id, nummer: basis.an.nummer } : null,
		ab: basis.an?.ab_nummer ? { nummer: basis.an.ab_nummer } : null,
		vorgaengerLink: basis.an?.ab_lexware_id ? deeplink('order-confirmations', basis.an.ab_lexware_id) : basis.an?.lexware_id ? deeplink('quotations', basis.an.lexware_id) : null,
		positionen,
		mwstSatz,
		leistungVon: von,
		leistungBis: bis,
		zahlungszielTage: basis.cfg?.zahlungsziel_tage ?? 14,
		gesamtBruttoCent,
		abschlaege: basis.vorher
			.filter((r) => r.art === 'abschlag' && r.phase === 'angelegt')
			.map((r) => ({ id: r.id, nummer: r.nummer ?? null, bruttoCent: Number(r.lx_brutto ?? r.brutto_cent ?? 0), storniert: r.status === 'voided' })),
		bisher: basis.vorher.length,
		wartet: basis.vorher.some((r) => r.phase === 'wartet'),
		grund
	};
}

// ——— Dialog: Rechnung erstellen ———

export type RechnungEingabe = {
	art?: unknown;
	mengen?: unknown;
	leistungVon?: unknown;
	leistungBis?: unknown;
	zahlungszielTage?: unknown;
	festschreiben?: unknown;
	abschlagProzent?: unknown;
	abschlagBetrag?: unknown;
};

const bool = (w: unknown) => w === true || w === 'true' || w === 'on' || w === 'ja' || w === '1';

function leseMengen(roh: unknown, n: number): (number | null)[] {
	if (roh === undefined || roh === null) return Array(n).fill(undefined);
	if (!Array.isArray(roh) || roh.length !== n) throw new ApiFehler(400, 'Mengen: bitte für jede Position eine Menge (leer = weglassen).');
	return roh.map((w, i) => {
		if (w === null || w === '' || w === 0 || w === '0') return null;
		try {
			return leseMenge(w as string | number);
		} catch (e) {
			throw new ApiFehler(400, `Position ${i + 1}: ${(e as Error).message}`);
		}
	});
}

function leseTag(w: unknown, name: string, standard: string): string {
	if (w === undefined || w === null || w === '') return standard;
	if (!istTag(w)) throw new ApiFehler(400, `${name}: Bitte ein gültiges Datum.`);
	return w;
}

export type ErstellErgebnis = { id: string; phase: 'wartet' | 'vorbereitet'; hinweis: string };

/**
 * Rechnung zum Auftrag anlegen (Recht `rechnungen.erstellen` prüft der Aufrufer). `art`:
 * - `rechnung` (Standard): Positionen aus dem angenommenen Angebot mit Mengen laut Aufmaß; weniger/weggelassen →
 *   Teilrechnung. Geht in die Warteschlange; Standard Entwurf (`festschreiben` = gleich festschreiben).
 * - `abschlag` (Betrag in € oder % vom Auftrag) / `schluss` (Gesamt − Abschläge): nur vorbereitet + Deeplink.
 */
export async function erstelleRechnung(k: Kontext, auftragIdRoh: string, e: RechnungEingabe, heute = berlinTag(new Date())): Promise<ErstellErgebnis> {
	const auftragId = pruefeAuftragId(auftragIdRoh);
	const v = await rechnungsVorschlag(k, auftragId, heute);
	if (v.grund) throw new ApiFehler(409, v.grund);
	if (v.wartet) throw new ApiFehler(409, 'Zu diesem Auftrag wird gerade schon eine Rechnung in Lexware angelegt.');
	const art = e.art === undefined || e.art === '' ? 'rechnung' : e.art;
	if (art !== 'rechnung' && art !== 'abschlag' && art !== 'schluss') throw new ApiFehler(400, 'Art: Rechnung, Abschlag oder Schluss.');
	const von = leseTag(e.leistungVon, 'Leistung von', v.leistungVon);
	const bis = leseTag(e.leistungBis, 'Leistung bis', v.leistungBis);
	if (bis < von) throw new ApiFehler(400, 'Leistungszeitraum: „bis“ liegt vor „von“.');
	const tageRoh = e.zahlungszielTage;
	const tage = tageRoh === undefined || tageRoh === '' || tageRoh === null ? v.zahlungszielTage : Number(tageRoh);
	if (!Number.isInteger(tage) || tage < 0 || tage > 120) throw new ApiFehler(400, 'Zahlungsziel: 0 bis 120 Tage.');
	const [an] = await mitBetrieb(k, (tx) => tx`
		select an.lexware_id, ab.lexware_id as ab_lexware_id, coalesce(an.kunde_id, a.kunde_id) as kunde_id
		from app.angebote an join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		left join app.auftragsbestaetigungen ab on ab.angebot_id = an.id and ab.betrieb_id = an.betrieb_id
		where an.id = ${v.angebot!.id} and an.betrieb_id = ${k.betriebId}`);
	const vorgaenger: string | null = an?.ab_lexware_id ?? an?.lexware_id ?? null;
	const von_benutzer = UUID.test(k.benutzerId) ? k.benutzerId : null;

	let positionen: RechnungPosition[] = [];
	let brutto = 0;
	let netto = 0;
	let rechnungsArt: 'rechnung' | 'teil' | 'abschlag' | 'schluss' = art;
	if (art === 'rechnung' || art === 'schluss') {
		const mengen = leseMengen(e.mengen, v.positionen.length);
		positionen = v.positionen
			.map((p, i) => ({ p, m: mengen[i] === undefined ? p.menge : mengen[i] }))
			.filter((x): x is { p: (typeof v.positionen)[number]; m: number } => x.m !== null)
			.map(({ p, m }) => ({ bezeichnung: p.bezeichnung, beschreibung: p.beschreibung, menge: m, einheit: p.einheit, einzelpreisCent: p.einzelpreisCent, materialCent: p.materialCent }));
		if (positionen.length === 0) throw new ApiFehler(400, 'Bitte mindestens eine Position mit Menge.');
		const s = summen(positionen, v.mwstSatz);
		netto = s.nettoCent;
		brutto = s.bruttoCent;
		if (art === 'rechnung') {
			const voll = positionen.length === v.positionen.length && v.positionen.every((p, i) => (mengen[i] === undefined ? p.menge : mengen[i]) === p.menge);
			if (!voll) rechnungsArt = 'teil';
		} else {
			const s2 = schlussBetrag(brutto, v.abschlaege);
			if (s2.abschlaegeCent === 0) throw new ApiFehler(409, 'Es gibt noch keine Abschlagsrechnung – bitte eine normale Rechnung erstellen.');
			brutto = s2.restCent;
		}
	} else {
		let betrag: number;
		try {
			const cents = e.abschlagBetrag !== undefined && e.abschlagBetrag !== '' && e.abschlagBetrag !== null ? leseEuroInCent(e.abschlagBetrag as string) : null;
			const prozent = e.abschlagProzent !== undefined && e.abschlagProzent !== '' && e.abschlagProzent !== null ? Number(String(e.abschlagProzent).replace(',', '.')) : null;
			if (cents === null && (prozent === null || !Number.isFinite(prozent) || prozent <= 0 || prozent > 100)) throw new RangeError('Abschlag: Betrag in € oder Prozent (1–100) angeben.');
			betrag = abschlagBetrag(v.gesamtBruttoCent, { cent: cents, prozent });
		} catch (err) {
			throw new ApiFehler(400, (err as Error).message);
		}
		if (betrag <= 0 || betrag > v.gesamtBruttoCent) throw new ApiFehler(400, 'Abschlag: höchstens der Auftragswert.');
		brutto = betrag;
		netto = Math.round((betrag * 100) / (100 + v.mwstSatz));
		positionen = [{ bezeichnung: `Abschlag ${v.ab ? `zur Auftragsbestätigung ${v.ab.nummer}` : `zum Angebot ${v.angebot!.nummer}`}`, beschreibung: null, menge: 1, einheit: 'pauschal', einzelpreisCent: netto, materialCent: null, einzelpreisBruttoCent: betrag }];
	}
	const phase = art === 'rechnung' ? 'wartet' : 'vorbereitet';
	let id: string;
	try {
		[{ id }] = (await mitBetrieb(k, (tx) => tx`
			insert into app.rechnungen (betrieb_id, art, quelle, phase, auftrag_id, angebot_id, kunde_id, vorgaenger_id, positionen, netto_cent, brutto_cent,
				leistung_von, leistung_bis, zahlungsziel_tage, festschreiben, lexware_typ, von_benutzer)
			values (${k.betriebId}, ${rechnungsArt}, 'crm', ${phase}, ${auftragId}, ${v.angebot!.id}, ${an?.kunde_id ?? null}, ${vorgaenger},
				${tx.json(positionen as never)}, ${netto}, ${brutto}, ${von}, ${bis}, ${tage}, ${art === 'rechnung' && bool(e.festschreiben)},
				${art === 'abschlag' ? 'downpaymentinvoice' : 'invoice'}, ${von_benutzer})
			returning id`)) as unknown as { id: string }[];
	} catch (err) {
		if ((err as { code?: string }).code === '23505') throw new ApiFehler(409, 'Zu diesem Auftrag wird gerade schon eine Rechnung in Lexware angelegt.');
		throw err;
	}
	if (phase === 'vorbereitet')
		return { id, phase, hinweis: `${art === 'abschlag' ? 'Abschlagsrechnung' : 'Schlussrechnung'} über ${euro(brutto)} vorbereitet – bitte mit „In Lexware fertigstellen“ in Lexware anlegen.` };
	await stelleEin(k, { art: 'rechnung_anlegen', nutzlast: { rechnungId: id, seit: new Date().toISOString() }, idempotenz: `rechnung_anlegen:${id}` });
	stosseLexwareAn(k);
	return { id, phase, hinweis: bool(e.festschreiben) ? 'Die Rechnung wird in Lexware angelegt und festgeschrieben.' : 'Die Rechnung wird in Lexware als Entwurf angelegt – bitte dort prüfen und festschreiben.' };
}

// ——— Handler der Warteschlange ———

export async function ladeRechnung(k: Kontext, id: string): Promise<Roh | undefined> {
	if (!UUID.test(String(id))) return undefined;
	const [r] = await mitBetrieb(k, (tx) => tx`
		select r.*, to_char(r.leistung_von, 'YYYY-MM-DD') as von, to_char(r.leistung_bis, 'YYYY-MM-DD') as bis
		from app.rechnungen r where r.id = ${id} and r.betrieb_id = ${k.betriebId}`);
	return r;
}

export async function rechnungsBeleg(k: Kontext, r: Roh, heute: string) {
	if (!r.angebot_id) throw new LexwareFehler('Die Rechnung hat kein Angebot mehr (gelöscht).', null, 'daten', false);
	const e = await belegEingabe(k, r.angebot_id);
	const positionen = (r.positionen ?? []) as RechnungPosition[];
	return {
		e,
		eingabe: {
			heute,
			mwstSatz: e.mwstSatz,
			positionen,
			kunde: e.kunde,
			kleinunternehmer: e.kleinunternehmer,
			leistungVon: r.von ?? heute,
			leistungBis: r.bis ?? heute,
			zahlungszielTage: r.zahlungsziel_tage ?? 14,
			titel: (r.art === 'teil' ? 'Teilrechnung' : r.art === 'abschlag' ? 'Abschlagsrechnung' : 'Rechnung') as 'Rechnung' | 'Teilrechnung' | 'Abschlagsrechnung',
			bezug: e.angebotNummer ? `Angebot ${e.angebotNummer}` : null,
			// Abschlag als Bruttobetrag (Prüfbericht 21.11.2026): keine ±1-ct-Abweichung zwischen CRM und Lexware
			brutto: r.art === 'abschlag'
		}
	};
}

export const rechnungAnlegen: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const r = await ladeRechnung(k, n.rechnungId);
		if (!r) return { ergebnis: { uebersprungen: 'Rechnung gelöscht' } };
		if (r.lexware_id) return { lexwareId: r.lexware_id, ergebnis: { schonDa: true } };
		// „fehler“: „Erneut versuchen“ in der Warteschlange (Einstellungen → Lexware) soll wirklich neu anlegen, statt den
		// Auftrag als erledigt abzuhaken und die Rechnung im Fehlerzustand zu lassen
		if (r.phase === 'fehler') await mitBetrieb(k, (tx) => tx`update app.rechnungen set phase = 'wartet', lexware_fehler = null where id = ${r.id} and betrieb_id = ${k.betriebId} and phase = 'fehler' and lexware_id is null`);
		else if (r.phase !== 'wartet') return { ergebnis: { uebersprungen: `Phase ${r.phase}` } };
		const { e, eingabe } = await rechnungsBeleg(k, r, berlinTag(new Date()));
		eingabe.kunde.lexwareId = await sichereKontakt(c, k, e.kundeId);
		const beleg = rechnungAlsLexware(eingabe);
		// Lexware würde ablehnen (z. B. § 13b ohne USt-IdNr.) → nicht senden, Mensch muss nachtragen
		if (beleg.steuer.fehler) throw new LexwareFehler(beleg.steuer.fehler, null, 'daten', false);
		const q = [r.vorgaenger_id && UUID.test(r.vorgaenger_id) ? `precedingSalesVoucherId=${r.vorgaenger_id}` : null, r.festschreiben ? 'finalize=true' : null].filter(Boolean).join('&');
		const antwort = await c.post<{ id: string }>(`/v1/invoices${q ? `?${q}` : ''}`, beleg.body);
		if (typeof antwort?.id !== 'string' || !UUID.test(antwort.id)) throw new LexwareFehler('Lexware: unerwartete Antwort beim Anlegen der Rechnung.', null, 'daten', false);
		return { lexwareId: antwort.id, ergebnis: { warnungen: beleg.warnungen } };
	},
	async vorhanden(c, n, k) {
		const r = await ladeRechnung(k, n.rechnungId);
		if (!r || r.lexware_id) return r?.lexware_id ?? null;
		const { e, eingabe } = await rechnungsBeleg(k, r, berlinTag(new Date()));
		const kontaktId = e.kundeId ? ((await mitBetrieb(k, (tx) => tx`select lexware_id from app.kunden where id = ${e.kundeId} and betrieb_id = ${k.betriebId}`))[0]?.lexware_id ?? null) : null;
		if (e.kundeId && !kontaktId) return null;
		const satz = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: eingabe.heute }).satz;
		return findeBeleg(c, k, 'invoice', { kontaktId, kontaktName: e.kunde.name, brutto: bruttoCent(eingabe, satz), seit: n.seit });
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		const z = await mitBetrieb(k, (tx) => tx`
			update app.rechnungen set lexware_id = ${r.lexwareId!}, phase = 'angelegt', lexware_fehler = null
			where id = ${n.rechnungId} and betrieb_id = ${k.betriebId} and lexware_id is null returning id`);
		if (z.length) await stelleEin(k, { art: 'rechnung_holen', nutzlast: { rechnungId: n.rechnungId, lexwareId: r.lexwareId }, idempotenz: `rechnung_holen:${r.lexwareId}:anlage` });
	},
	async beiFehler(k, n, text) {
		await mitBetrieb(k, (tx) => tx`
			update app.rechnungen set phase = 'fehler', lexware_fehler = ${text.slice(0, 1000)} where id = ${n.rechnungId} and betrieb_id = ${k.betriebId} and lexware_id is null`);
	}
};

/** Lexware-Rechnung in den Spiegel schreiben (GET /v1/invoices/{id} bzw. /v1/down-payment-invoices/{id}). */
async function spiegele(tx: TransactionSql, k: Kontext, lexwareId: string, typ: 'invoice' | 'downpaymentinvoice', b: Roh, kundeId: string | null): Promise<void> {
	const status = RE_STATUS.includes(b?.voucherStatus) ? b.voucherStatus : 'open';
	const nr = typeof b?.voucherNumber === 'string' && NUMMER.test(b.voucherNumber.trim()) ? b.voucherNumber.trim() : null;
	const brutto = cent(b?.totalPrice?.totalGrossAmount);
	const kontakt = typeof b?.address?.contactId === 'string' && UUID.test(b.address.contactId) ? b.address.contactId : null;
	await tx`
		insert into app.lexware_belege (betrieb_id, lexware_id, typ, nummer, status, datum, faellig, brutto_cent, offen_cent, waehrung, kontakt_id, kontakt_name, kunde_id, stand)
		values (${k.betriebId}, ${lexwareId}, ${typ}, ${nr}, ${status}, ${tag10(b?.voucherDate)}, ${tag10(b?.dueDate)}, ${brutto},
			${status === 'draft' ? brutto : (cent(b?.openAmount) ?? brutto)}, 'EUR', ${kontakt}, ${typeof b?.address?.name === 'string' ? b.address.name.slice(0, 300) : null}, ${kundeId}, now())
		on conflict (betrieb_id, lexware_id) do update set nummer = coalesce(excluded.nummer, app.lexware_belege.nummer), status = excluded.status,
			datum = coalesce(excluded.datum, app.lexware_belege.datum), faellig = coalesce(excluded.faellig, app.lexware_belege.faellig),
			brutto_cent = coalesce(excluded.brutto_cent, app.lexware_belege.brutto_cent), kunde_id = coalesce(app.lexware_belege.kunde_id, excluded.kunde_id), stand = now()`;
}

/** Aufgabe (+ Glocke) zur Rechnung, einmal je Titel solange offen. */
async function aufgabe(tx: TransactionSql, k: Kontext, a: { titel: string; text: string; auftragId: string | null; link: string; benutzerId?: string | null }): Promise<void> {
	const [offen] = await tx`select id from app.todos where betrieb_id = ${k.betriebId} and titel = ${a.titel.slice(0, 200)} and erledigt_am is null limit 1`;
	if (offen) return;
	const wer = await zustaendig(tx, k, a.benutzerId ?? null, a.auftragId);
	const [t] = await tx`
		insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
		values (${k.betriebId}, ${a.auftragId}, ${a.titel.slice(0, 200)}, ${a.text.slice(0, 500)}, ${wer}, ${berlinTag(new Date())}) returning id`;
	if (wer) {
		const [er] = await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
			values (${k.betriebId}, ${wer}, ${t.id}, now(), ${a.titel.slice(0, 300)}, ${a.text.slice(0, 500)}, ${a.link}) returning id`;
		await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${k.betriebId}`;
	}
}
const titelPruefen = (id: string) => `Rechnung in Lexware prüfen und festschreiben (${id.slice(0, 8)})`;
const titelSenden = (nr: string) => `Rechnung ${nr} an den Kunden senden`;

/** Nach dem Festschreiben (sofort oder später in Lexware): PDF holen, Aufgabe „senden“, „prüfen“ erledigt. */
async function nachFestschreiben(c: LexwareClient | null, k: Kontext, r: Roh, nr: string): Promise<void> {
	if (c) {
		const pfad = RECHNUNG_TYP_PFAD[(r.lexware_typ ?? 'invoice') as 'invoice'];
		const d = await c.datei(`/v1/${pfad}/${r.lexware_id}/file`);
		await speichereDatei(k, r.lexware_id, r.lexware_typ ?? 'invoice', `Rechnung_${sicher(nr)}.pdf`, d.bytes);
	}
	await mitBetrieb(k, async (tx) => {
		await tx`update app.todos set erledigt_am = now() where betrieb_id = ${k.betriebId} and titel = ${titelPruefen(r.id)} and erledigt_am is null`;
		if (!r.gesendet_am)
			await aufgabe(tx, k, { titel: titelSenden(nr), text: 'Die Rechnung ist in Lexware festgeschrieben: in der Rechnung „Senden“ (Mail aus dem CRM, PDF aus Lexware) oder PDF herunterladen.', auftragId: r.auftrag_id, link: `/rechnungen/${r.id}`, benutzerId: r.von_benutzer });
	});
}

export const rechnungHolen: Handler = {
	async ausfuehren(c, n, k) {
		if (typeof n.lexwareId !== 'string' || !UUID.test(n.lexwareId)) throw new LexwareFehler('ungültige Lexware-ID', null, 'daten', false);
		const r = await ladeRechnung(k, n.rechnungId);
		if (!r || r.lexware_id !== n.lexwareId) return { ergebnis: { uebersprungen: 'Rechnung passt nicht' } };
		const typ = (r.lexware_typ ?? 'invoice') as 'invoice' | 'downpaymentinvoice';
		const b = await c.get<Roh>(`/v1/${RECHNUNG_TYP_PFAD[typ]}/${n.lexwareId}`);
		await mitBetrieb(k, (tx) => spiegele(tx, k, n.lexwareId, typ, b, r.kunde_id));
		const status = RE_STATUS.includes(b?.voucherStatus) ? b.voucherStatus : null;
		if (status === 'draft') {
			await mitBetrieb(k, (tx) => aufgabe(tx, k, { titel: titelPruefen(r.id), text: `Die Rechnung liegt als Entwurf in Lexware: prüfen und dort festschreiben – ${deeplink('invoices', n.lexwareId)}`, auftragId: r.auftrag_id, link: `/rechnungen/${r.id}`, benutzerId: r.von_benutzer }));
			return { lexwareId: n.lexwareId, ergebnis: { status } };
		}
		const nr = typeof b?.voucherNumber === 'string' && NUMMER.test(b.voucherNumber.trim()) ? b.voucherNumber.trim() : null;
		if (!nr) throw new LexwareFehler('Lexware: Die Rechnung hat noch keine gültige Nummer.', null, 'abhaengig', true);
		await nachFestschreiben(c, k, r, nr);
		return { lexwareId: n.lexwareId, ergebnis: { status, nummer: nr } };
	}
};

/** GET /v1/payments/{id}: offener Betrag, Teilzahlungen, bezahlt am → Spiegel; bezahlt → Mahnen stoppt. */
export const zahlungHolen: Handler = {
	async ausfuehren(c, n, k) {
		if (typeof n.lexwareId !== 'string' || !UUID.test(n.lexwareId)) throw new LexwareFehler('ungültige Lexware-ID', null, 'daten', false);
		const [b] = await mitBetrieb(k, (tx) => tx`select id, typ from app.lexware_belege where betrieb_id = ${k.betriebId} and lexware_id = ${n.lexwareId}`);
		if (!b || !['invoice', 'downpaymentinvoice'].includes(b.typ)) return { ergebnis: { uebersprungen: 'kein Rechnungsbeleg' } };
		const p = await c.get<Roh>(`/v1/payments/${n.lexwareId}`);
		const zahlungen = (Array.isArray(p?.paymentItems) ? p.paymentItems : []).slice(0, 200).map((z: Roh) => ({
			art: typeof z?.paymentItemType === 'string' ? z.paymentItemType.slice(0, 60) : 'payment',
			datum: tag10(z?.postingDate),
			cent: cent(z?.amount) ?? 0
		}));
		const offen = cent(p?.openAmount);
		const status = RE_STATUS.includes(p?.voucherStatus) ? p.voucherStatus : null;
		await mitBetrieb(k, async (tx) => {
			await tx`
				update app.lexware_belege set offen_cent = coalesce(${offen}, offen_cent), zahlungen = ${tx.json(zahlungen as never)},
					bezahlt_am = ${tag10(p?.paidDate)}, status = coalesce(${status}, status), zahlung_stand = now(), stand = now()
				where betrieb_id = ${k.betriebId} and lexware_id = ${n.lexwareId}`;
			await stoppeMahnungen(tx, k);
		});
		return { ergebnis: { offen, zahlungen: zahlungen.length } };
	}
};

/** Mahnen stoppt sofort bei Zahlung/Storno: offene Läufe „gestoppt“, ihre Aufgaben erledigt (Plan Entscheidung 7). */
export async function stoppeMahnungen(tx: TransactionSql, k: Kontext): Promise<number> {
	const z = await tx`
		update app.nachfass_laeufe l set status = 'gestoppt'
		from app.rechnungen r join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
		where l.rechnung_id = r.id and l.betrieb_id = ${k.betriebId} and r.betrieb_id = ${k.betriebId} and l.status in ('offen', 'freigabe', 'wartet', 'bereit')
			and (b.status in ('paid', 'paidoff', 'voided') or coalesce(b.offen_cent, 1) <= 0)
		returning l.todo_id`;
	const todos = z.map((x) => x.todo_id).filter(Boolean) as string[];
	if (todos.length) await tx`update app.todos set erledigt_am = now() where betrieb_id = ${k.betriebId} and id = any(${todos}::uuid[]) and erledigt_am is null`;
	return z.length;
}

// ——— nach dem Belegabgleich (aus abgleich.ts) ———

export type GeaenderterBeleg = { lexwareId: string; typ: string; alt: { status: string; offen: number | null } | null; neu: { status: string; offen: number | null; brutto: number | null; nummer: string | null }; kundeId: string | null };

/**
 * Nach einer Seite der Belegliste: (1) vorbereitete Abschlags-/Schlussrechnung zuordnen (gleicher Kunde, gleiches
 * Brutto ±1 ct), (2) Entwurf → festgeschrieben erkennen (Aufgabe „senden“, PDF beim Senden), (3) geänderter offener
 * Betrag/Status → Zahlungen holen. Nur Belege, die zu einer CRM-Rechnung gehören, lösen Aufgaben aus.
 */
export async function nachBelegabgleich(k: Kontext, liste: GeaenderterBeleg[]): Promise<void> {
	const rechnungsBelege = liste.filter((b) => b.typ === 'invoice' || b.typ === 'downpaymentinvoice');
	if (rechnungsBelege.length === 0) return;
	for (const b of rechnungsBelege) {
		let [r] = await mitBetrieb(k, (tx) => tx`select * from app.rechnungen where betrieb_id = ${k.betriebId} and lexware_id = ${b.lexwareId}`);
		if (!r && !b.alt && b.kundeId && b.neu.brutto !== null) {
			const art = b.typ === 'downpaymentinvoice' ? ['abschlag'] : ['schluss'];
			[r] = await mitBetrieb(k, (tx) => tx`
				update app.rechnungen set lexware_id = ${b.lexwareId}, phase = 'angelegt', lexware_typ = ${b.typ}
				where id = (select id from app.rechnungen where betrieb_id = ${k.betriebId} and phase = 'vorbereitet' and kunde_id = ${b.kundeId}
					and art = any(${art}) and abs(brutto_cent - ${b.neu.brutto}) <= 1
					-- genau gleicher Betrag zuerst (Abschlag wird brutto übergeben); ±1 ct nur noch für ältere Vorbereitungen
					order by abs(brutto_cent - ${b.neu.brutto}), angelegt limit 1)
					and betrieb_id = ${k.betriebId}
				returning *`);
		}
		if (!r) continue;
		if (b.alt?.status === 'draft' && b.neu.status !== 'draft' && b.neu.status !== 'voided' && b.neu.nummer) await nachFestschreiben(null, k, r, b.neu.nummer);
		else if (!b.alt && b.neu.status !== 'draft' && b.neu.status !== 'voided' && b.neu.nummer && !r.gesendet_am)
			await mitBetrieb(k, (tx) => aufgabe(tx, k, { titel: titelSenden(b.neu.nummer!), text: 'Die Rechnung ist in Lexware festgeschrieben – bitte an den Kunden senden.', auftragId: r.auftrag_id, link: `/rechnungen/${r.id}` }));
		if (b.alt && (b.alt.offen !== b.neu.offen || b.alt.status !== b.neu.status))
			await stelleEin(k, { art: 'zahlung_holen', nutzlast: { lexwareId: b.lexwareId }, idempotenz: `zahlung_holen:${b.lexwareId}:${b.neu.status}:${b.neu.offen}` });
	}
	await mitBetrieb(k, (tx) => stoppeMahnungen(tx, k));
}

// ——— Lesen: Liste, Kunde, Auftrag, Detail ———

export type RechnungZeile = {
	id: string;
	/** null = nur in Lexware (kein CRM-Datensatz) → Link in Lexware */
	crm: boolean;
	art: 'rechnung' | 'teil' | 'abschlag' | 'schluss';
	quelle: 'crm' | 'lexware';
	status: ZahlStatus;
	nummer: string | null;
	auftrag: { id: string; nummer: string; titel: string } | null;
	/** `nummer`: Kundennummer aus Lexware (Can #6748), null = folgt */
	kunde: { id: string; name: string; nummer: number | null } | null;
	datum: string;
	faellig: string | null;
	bruttoCent: number | null;
	offenCent: number | null;
	bezahltAm: string | null;
	lexwareId: string | null;
	lexwareLink: string | null;
	fehler: string | null;
	mahnstufe: number | null;
	pausiertBis: string | null;
	gesendetAm: string | null;
};

const SPALTEN = (tx: TransactionSql) => tx`
	r.id, r.art, r.quelle, r.phase, r.lexware_id, r.lexware_typ, r.lexware_fehler, r.brutto_cent as vor_brutto,
	to_char(r.mahnen_pausiert_bis, 'YYYY-MM-DD') as pausiert_bis, r.gesendet_am, r.angelegt,
	a.id as auftrag_id, a.nummer as auftrag_nummer, a.titel as auftrag_titel, a.einmal_name,
	k.id as kunde_id, k.art as kunde_art, k.firma, k.vorname, k.nachname, k.lexware_kundennummer as kunde_nummer,
	b.nummer, b.status, to_char(b.datum, 'YYYY-MM-DD') as datum, to_char(b.faellig, 'YYYY-MM-DD') as faellig, b.brutto_cent, b.offen_cent,
	to_char(b.bezahlt_am, 'YYYY-MM-DD') as bezahlt_am,
	(select max(s.mahnstufe) from app.nachfass_laeufe l join app.nachfass_stufen s on s.id = l.stufe_id and s.betrieb_id = l.betrieb_id
		where l.rechnung_id = r.id and l.betrieb_id = r.betrieb_id and l.status <> 'gestoppt') as mahnstufe`;

function zuZeile(z: Roh, heute: string, preise: boolean): RechnungZeile {
	const lexTyp = (z.lexware_typ ?? 'invoice') as 'invoice' | 'downpaymentinvoice';
	const status = zahlStatus({ phase: z.phase, status: z.status ?? null, bruttoCent: z.brutto_cent === null ? null : Number(z.brutto_cent), offenCent: z.offen_cent === null ? null : Number(z.offen_cent), faellig: z.faellig ?? null }, heute);
	const p = (x: unknown) => (preise && x !== null && x !== undefined ? Number(x) : null);
	return {
		id: z.id,
		crm: true,
		art: z.art,
		quelle: z.quelle,
		status,
		nummer: z.nummer ?? null,
		auftrag: z.auftrag_id ? { id: z.auftrag_id, nummer: z.auftrag_nummer, titel: z.auftrag_titel } : null,
		kunde: z.kunde_id ? { id: z.kunde_id, name: anzeigeName({ art: z.kunde_art, firma: z.firma, vorname: z.vorname, nachname: z.nachname }), nummer: z.kunde_nummer ?? null } : z.einmal_name ? { id: '', name: z.einmal_name, nummer: null } : null,
		datum: z.datum ?? berlinTag(new Date(z.angelegt)),
		faellig: z.faellig ?? null,
		bruttoCent: p(z.brutto_cent ?? z.vor_brutto),
		offenCent: p(z.offen_cent),
		bezahltAm: z.bezahlt_am ?? null,
		lexwareId: z.lexware_id ?? null,
		lexwareLink: z.lexware_id ? deeplink(lexTyp === 'downpaymentinvoice' ? 'down-payment-invoices' : 'invoices', z.lexware_id) : null,
		fehler: z.lexware_fehler ?? null,
		mahnstufe: z.mahnstufe ?? null,
		pausiertBis: z.pausiert_bis ?? null,
		gesendetAm: z.gesendet_am ? new Date(z.gesendet_am).toISOString() : null
	};
}

export const MAX_RECHNUNGEN = 500;

/**
 * Rechnungen des Betriebs: CRM-Rechnungen und (ohne Auftrag/Kunde-Filter nach Auftrag) Lexware-Rechnungen ohne CRM-Datensatz
 * (nur lesend, keine Mahnungen). Beträge nur mit `preise`.
 */
export async function listeRechnungen(
	k: Kontext,
	o: { auftragId?: string; kundeId?: string; filter?: RechnungFilter; suche?: string | null; preise: boolean },
	heute = berlinTag(new Date())
): Promise<RechnungZeile[]> {
	const auftragId = o.auftragId && UUID.test(o.auftragId) ? o.auftragId : null;
	const kundeId = o.kundeId && UUID.test(o.kundeId) ? o.kundeId : null;
	if ((o.auftragId && !auftragId) || (o.kundeId && !kundeId)) return [];
	const [crm, nurLexware] = await mitBetrieb(k, (tx) =>
		Promise.all([
			tx`
				select ${SPALTEN(tx)}
				from app.rechnungen r
				left join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
				left join app.auftraege a on a.id = r.auftrag_id and a.betrieb_id = r.betrieb_id
				left join app.kunden k on k.id = coalesce(r.kunde_id, b.kunde_id) and k.betrieb_id = r.betrieb_id
				where r.betrieb_id = ${k.betriebId} ${auftragId ? tx`and r.auftrag_id = ${auftragId}` : tx``}
					${kundeId ? tx`and coalesce(r.kunde_id, b.kunde_id) = ${kundeId}` : tx``}
				order by coalesce(b.datum, r.angelegt::date) desc, r.angelegt desc limit ${MAX_RECHNUNGEN}`,
			auftragId
				? Promise.resolve([] as Roh[])
				: tx`
				select b.lexware_id, b.typ, b.nummer, b.status, to_char(b.datum, 'YYYY-MM-DD') as datum, to_char(b.faellig, 'YYYY-MM-DD') as faellig,
					b.brutto_cent, b.offen_cent, to_char(b.bezahlt_am, 'YYYY-MM-DD') as bezahlt_am, b.kontakt_name, b.stand,
					k.id as kunde_id, k.art as kunde_art, k.firma, k.vorname, k.nachname, k.lexware_kundennummer as kunde_nummer
				from app.lexware_belege b left join app.kunden k on k.id = b.kunde_id and k.betrieb_id = b.betrieb_id
				where b.betrieb_id = ${k.betriebId} and b.typ in ('invoice', 'downpaymentinvoice') and not b.archiviert
					${kundeId ? tx`and b.kunde_id = ${kundeId}` : tx``}
					and not exists (select 1 from app.rechnungen r where r.betrieb_id = b.betrieb_id and r.lexware_id = b.lexware_id)
				order by b.datum desc nulls last limit ${MAX_RECHNUNGEN}`
		])
	);
	const zeilen = crm.map((z) => zuZeile(z, heute, o.preise));
	for (const z of nurLexware) {
		const zeile = zuZeile({ ...z, id: `lx-${z.lexware_id}`, art: z.typ === 'downpaymentinvoice' ? 'abschlag' : 'rechnung', quelle: 'lexware', phase: 'angelegt', lexware_typ: z.typ, angelegt: z.stand, mahnstufe: null }, heute, o.preise);
		zeile.crm = false;
		zeile.kunde ??= z.kontakt_name ? { id: '', name: z.kontakt_name, nummer: null } : null;
		zeilen.push(zeile);
	}
	const filter = o.filter ?? 'alle';
	const woerter = (o.suche ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
	return zeilen
		.filter((z) => passtFilter(z.status, filter))
		.filter((z) => woerter.every((w) => `${z.nummer ?? ''} ${z.kunde?.name ?? ''} ${z.auftrag?.nummer ?? ''} ${z.auftrag?.titel ?? ''}`.toLowerCase().includes(w)))
		.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
		.slice(0, MAX_RECHNUNGEN);
}

export type OffeneSumme = { anzahl: number; offenCent: number; ueberfaellig: number; ueberfaelligCent: number; teilbezahlt: number; bezahltMonat: number; liste: RechnungZeile[] };

/** Kennzahlen für Liste und Startseiten-Kachel „Offene Rechnungen“ (nur mit „Preise sehen“). */
export async function offeneRechnungen(k: Kontext, heute = berlinTag(new Date())): Promise<OffeneSumme> {
	const alle = await listeRechnungen(k, { preise: true, filter: 'alle' }, heute);
	const offen = alle.filter((z) => passtFilter(z.status, 'offen'));
	const ue = offen.filter((z) => z.status === 'ueberfaellig');
	const monat = heute.slice(0, 7);
	return {
		anzahl: offen.length,
		offenCent: offen.reduce((s, z) => s + (z.offenCent ?? z.bruttoCent ?? 0), 0),
		ueberfaellig: ue.length,
		ueberfaelligCent: ue.reduce((s, z) => s + (z.offenCent ?? 0), 0),
		teilbezahlt: offen.filter((z) => z.status === 'teilbezahlt' || (z.offenCent !== null && z.bruttoCent !== null && z.offenCent < z.bruttoCent)).length,
		bezahltMonat: alle.filter((z) => z.status === 'bezahlt' && z.bezahltAm?.startsWith(monat)).length,
		liste: [...ue.sort((a, b) => ((a.faellig ?? '') < (b.faellig ?? '') ? -1 : 1)), ...offen.filter((z) => z.status !== 'ueberfaellig')].slice(0, 5)
	};
}

export type RechnungDetail = RechnungZeile & {
	positionen: RechnungPosition[];
	nettoCent: number | null;
	leistungVon: string | null;
	leistungBis: string | null;
	zahlungszielTage: number | null;
	festschreiben: boolean;
	zahlungen: { art: string; datum: string | null; cent: number }[];
	vorgaengerLink: string | null;
	pdf: boolean;
	schritte: { art: string; status: string; fehler: string | null; seit: string }[];
	angebotId: string | null;
	mailAn: string | null;
};

export async function holeRechnung(k: Kontext, idRoh: string, preise: boolean, heute = berlinTag(new Date())): Promise<RechnungDetail> {
	const id = pruefeRechnungId(idRoh);
	const z = await mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${SPALTEN(tx)}, r.positionen, r.netto_cent, to_char(r.leistung_von, 'YYYY-MM-DD') as von, to_char(r.leistung_bis, 'YYYY-MM-DD') as bis,
				r.zahlungsziel_tage, r.festschreiben, r.vorgaenger_id, r.angebot_id, b.zahlungen, k.email as kunde_email,
				exists (select 1 from app.lexware_dateien d where d.betrieb_id = r.betrieb_id and d.lexware_id = r.lexware_id) as pdf,
				(select ab.lexware_id from app.auftragsbestaetigungen ab where ab.betrieb_id = r.betrieb_id and ab.lexware_id = r.vorgaenger_id) as vor_ab
			from app.rechnungen r
			left join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
			left join app.auftraege a on a.id = r.auftrag_id and a.betrieb_id = r.betrieb_id
			left join app.kunden k on k.id = coalesce(r.kunde_id, b.kunde_id) and k.betrieb_id = r.betrieb_id
			where r.id = ${id} and r.betrieb_id = ${k.betriebId}`;
		if (!z) throw new ApiFehler(404, 'Rechnung nicht gefunden.');
		const schritte = await tx`
			select art, status, letzter_fehler, angelegt from app.lexware_auftraege
			where betrieb_id = ${k.betriebId} and (nutzlast ->> 'rechnungId' = ${id} or (${z.lexware_id}::uuid is not null and nutzlast ->> 'lexwareId' = ${z.lexware_id}::text))
				and status not in ('erledigt', 'abgebrochen') order by angelegt`;
		return { ...(z as Roh), schritte } as Roh;
	});
	const zeile = zuZeile(z, heute, preise);
	return {
		...zeile,
		positionen: ((z.positionen ?? []) as RechnungPosition[]).map((p) => (preise ? p : { ...p, einzelpreisCent: 0, materialCent: null, einzelpreisBruttoCent: null })),
		nettoCent: preise && z.netto_cent !== null ? Number(z.netto_cent) : null,
		leistungVon: z.von ?? null,
		leistungBis: z.bis ?? null,
		zahlungszielTage: z.zahlungsziel_tage ?? null,
		festschreiben: !!z.festschreiben,
		zahlungen: preise ? ((z.zahlungen ?? []) as RechnungDetail['zahlungen']) : [],
		vorgaengerLink: z.vorgaenger_id ? deeplink(z.vor_ab ? 'order-confirmations' : 'quotations', z.vorgaenger_id) : null,
		pdf: !!z.pdf,
		schritte: z.schritte.map((s: Roh) => ({ art: s.art, status: s.status, fehler: s.letzter_fehler, seit: new Date(s.angelegt).toISOString() })),
		angebotId: z.angebot_id ?? null,
		mailAn: z.kunde_email ?? null
	};
}

// ——— PDF und Versand ———

/** PDF aus dem Zwischenspeicher bzw. frisch aus Lexware (nur festgeschriebene Rechnungen). */
export async function rechnungPdf(k: Kontext, idRoh: string, frisch = false): Promise<{ name: string; bytes: Uint8Array }> {
	const id = pruefeRechnungId(idRoh);
	const r = await ladeRechnung(k, id);
	if (!r?.lexware_id) throw new ApiFehler(404, 'Zu dieser Rechnung gibt es noch kein PDF.');
	const [b] = await mitBetrieb(k, (tx) => tx`select nummer, status from app.lexware_belege where betrieb_id = ${k.betriebId} and lexware_id = ${r.lexware_id}`);
	if (!b || b.status === 'draft') throw new ApiFehler(409, 'Die Rechnung ist noch ein Entwurf – bitte zuerst in Lexware festschreiben.');
	if (!frisch) {
		const [d] = await mitBetrieb(k, (tx) => tx`select name, pdf from app.lexware_dateien where betrieb_id = ${k.betriebId} and lexware_id = ${r.lexware_id}`);
		if (d) return { name: d.name, bytes: new Uint8Array(d.pdf) };
	}
	const c = await holeClient(k);
	const typ = (r.lexware_typ ?? 'invoice') as 'invoice' | 'downpaymentinvoice';
	const d = await c.datei(`/v1/${RECHNUNG_TYP_PFAD[typ]}/${r.lexware_id}/file`);
	const name = `Rechnung_${sicher(b.nummer ?? r.lexware_id.slice(0, 8))}.pdf`;
	await speichereDatei(k, r.lexware_id, typ, name, d.bytes);
	return { name, bytes: d.bytes };
}

/** Platzhalter für Rechnung/Erinnerung/Mahnung: Kunde, Auftrag, Angebot + Rechnungsnummer, Beträge, Fälligkeit. */
export async function rechnungsWerte(tx: TransactionSql, k: Kontext, r: Roh, heute: string): Promise<{ an: string | null; werte: Record<string, string> }> {
	const { an, werte } = await mailWerte(tx, k, { angebotId: r.angebot_id, auftragId: r.auftrag_id, kundeId: r.kunde_id }, { preise: true });
	const [b] = r.lexware_id ? await tx`select nummer, to_char(datum, 'YYYY-MM-DD') as datum, to_char(faellig, 'YYYY-MM-DD') as faellig, brutto_cent, offen_cent from app.lexware_belege where betrieb_id = ${k.betriebId} and lexware_id = ${r.lexware_id}` : [];
	werte['rechnung.nummer'] = b?.nummer ?? '';
	werte['rechnung.datum'] = b?.datum ? tagDeutsch(b.datum) : '';
	werte.betrag = euro(Number(b?.brutto_cent ?? r.brutto_cent ?? 0));
	werte.offen = euro(Number(b?.offen_cent ?? b?.brutto_cent ?? 0));
	werte.faellig_am = b?.faellig ? tagDeutsch(b.faellig) : '';
	werte.tage = b?.faellig ? String(Math.max(0, Math.round((Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${b.faellig}T00:00:00Z`)) / 86_400_000))) : '0';
	return { an, werte };
}

export type MailEntwurf = { an: string | null; betreff: string; text: string; html: string };

/** Mail zur Rechnung (Vorlage „Rechnung senden“) – für „Senden“ und „In Mailprogramm öffnen“. */
export async function rechnungMail(k: Kontext, idRoh: string): Promise<MailEntwurf> {
	const id = pruefeRechnungId(idRoh);
	const r = await ladeRechnung(k, id);
	if (!r) throw new ApiFehler(404, 'Rechnung nicht gefunden.');
	return mitBetrieb(k, async (tx) => {
		const { an, werte } = await rechnungsWerte(tx, k, r, berlinTag(new Date()));
		const m = baueMail(await vorlageFuer(tx, k, 'rechnung'), werte, await holeSignatur(k, tx));
		return { an, betreff: m.betreff.slice(0, 300), text: m.text.slice(0, 5000), html: m.html };
	});
}

/** „Senden“: PDF frisch aus Lexware, Mail über das CRM-Postfach; ohne Postfach → 409 (Mailprogramm nutzen). */
export async function sendeRechnung(k: Kontext, idRoh: string): Promise<{ an: string }> {
	const id = pruefeRechnungId(idRoh);
	const versand = await mailVersandFuer(k.betriebId);
	if (!versand.verbunden) throw new ApiFehler(409, 'Der Mailversand ist nicht eingerichtet – bitte „PDF herunterladen“ und „In Mailprogramm öffnen“, danach „Als gesendet markieren“.');
	const m = await rechnungMail(k, id);
	if (!m.an) throw new ApiFehler(409, 'Beim Kunden ist keine E-Mail-Adresse hinterlegt.');
	const pdf = await rechnungPdf(k, id, true);
	const r = await ladeRechnung(k, id);
	const e = await sendeMail(k, { an: m.an, betreff: m.betreff, html: m.html, text: m.text, anhaenge: [{ name: pdf.name, typ: 'application/pdf', bytes: pdf.bytes }] }, { art: 'rechnung', bezugTyp: 'rechnung', bezugId: id, lexwareId: r!.lexware_id, versand });
	if (e.status !== 'gesendet') throw new ApiFehler(502, 'Die Mail konnte nicht gesendet werden – Details unter Einstellungen → E-Mail-Versand.');
	await markiereRechnungGesendet(k, id);
	return { an: m.an };
}

export async function markiereRechnungGesendet(k: Kontext, idRoh: string): Promise<void> {
	const id = pruefeRechnungId(idRoh);
	await mitBetrieb(k, async (tx) => {
		const [r] = await tx`
			update app.rechnungen r set gesendet_am = coalesce(gesendet_am, now()) from app.lexware_belege b
			where r.id = ${id} and r.betrieb_id = ${k.betriebId} and b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id and b.status not in ('draft', 'voided')
			returning b.nummer`;
		if (!r) throw new ApiFehler(409, 'Die Rechnung ist noch nicht festgeschrieben.');
		await tx`update app.todos set erledigt_am = now() where betrieb_id = ${k.betriebId} and titel = ${titelSenden(r.nummer ?? '')} and erledigt_am is null`;
	});
}

/** „Mahnen pausieren bis …“ (null = Pause aufheben). */
export async function setzeMahnPause(k: Kontext, idRoh: string, bis: string | null): Promise<void> {
	const id = pruefeRechnungId(idRoh);
	if (bis !== null && !istTag(bis)) throw new ApiFehler(400, 'Pause bis: Bitte ein gültiges Datum.');
	const z = await mitBetrieb(k, (tx) => tx`update app.rechnungen set mahnen_pausiert_bis = ${bis} where id = ${id} and betrieb_id = ${k.betriebId} returning id`);
	if (z.length === 0) throw new ApiFehler(404, 'Rechnung nicht gefunden.');
}

/** Vorbereitete Abschlags-/Schlussrechnung verwerfen (z. B. falsch vorbereitet; mit Rückfrage in der Oberfläche). */
export async function verwirfVorbereitung(k: Kontext, idRoh: string): Promise<void> {
	const id = pruefeRechnungId(idRoh);
	const z = await mitBetrieb(k, (tx) => tx`delete from app.rechnungen where id = ${id} and betrieb_id = ${k.betriebId} and phase in ('vorbereitet', 'fehler') returning id`);
	if (z.length === 0) throw new ApiFehler(409, 'Nur vorbereitete oder fehlgeschlagene Rechnungen lassen sich verwerfen.');
}

/** „Erneut versuchen“ nach Fehler: neue Phase „wartet“, neuer Auftrag in der Warteschlange. */
export async function rechnungErneut(k: Kontext, idRoh: string): Promise<void> {
	const id = pruefeRechnungId(idRoh);
	const z = await mitBetrieb(k, (tx) => tx`update app.rechnungen set phase = 'wartet', lexware_fehler = null where id = ${id} and betrieb_id = ${k.betriebId} and phase = 'fehler' and lexware_id is null returning id`);
	if (z.length === 0) throw new ApiFehler(409, 'Die Rechnung ist nicht im Fehlerzustand.');
	// Frühere Versuche könnten die Rechnung in Lexware schon angelegt haben (Zeitüberschreitung, Serverfehler): ab dem
	// ERSTEN Versuch suchen („seit“) und vor dem Anlegen erst nachsehen (Status „ungewiss“) – sonst doppelte Rechnung
	const [frueher] = await mitBetrieb(k, (tx) => tx`
		select min(nutzlast ->> 'seit') as seit from app.lexware_auftraege
		where betrieb_id = ${k.betriebId} and art = 'rechnung_anlegen' and nutzlast ->> 'rechnungId' = ${id}`);
	const seit = typeof frueher?.seit === 'string' && !Number.isNaN(Date.parse(frueher.seit)) ? frueher.seit : new Date().toISOString();
	const neu = await stelleEin(k, { art: 'rechnung_anlegen', nutzlast: { rechnungId: id, seit }, idempotenz: `rechnung_anlegen:${id}:${Date.now()}` });
	if (frueher?.seit) await mitBetrieb(k, (tx) => tx`update app.lexware_auftraege set status = 'ungewiss' where id = ${neu.id} and betrieb_id = ${k.betriebId} and status = 'wartet'`);
	stosseLexwareAn(k);
}

