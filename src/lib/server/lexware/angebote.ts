import { createHash } from 'node:crypto';
import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext, type TransactionSql } from '../db';
import { UUID } from '../kunden';
import { berlinTag } from '../../zeit';
import { gibAngebotImPortalFrei, holeAngebot, ladePdfDaten, pruefeAngebotId, type AngebotZugriff } from '../angebote';
import { mailVersandFuer, sendeMail } from '../mail/versand';
import { baueMail, holeSignatur, mailWerte, vorlageFuer } from '../mail-vorlagen';
import { zustaendig, stelleAbZu } from '../auftragsbestaetigung';
import { LexwareFehler, type LexwareClient } from './client';
import { abAlsLexware, angebotAlsLexware, bruttoCent, steuerFall, type BelegEingabe } from './belege';
import { kontaktAnlegen } from './kontakte';
import { holeClient } from './konfig';
import { meldeProblem, stelleEin, type Handler } from './warteschlange';

/**
 * Angebot und Auftragsbestätigung über Lexware (Plan Phase 2, Tasks T5/T6; docs/superpowers/plans/2026-11-15-lexware-phase2.md).
 *
 * Ablauf (alles über die Warteschlange, je Schritt idempotent):
 *   „Versenden“ → angebot_festschreiben: Kunde sicherstellen, POST /v1/quotations?finalize=true (genau ein Beleg je
 *   Version) → angebot_versand: GET Beleg (Nummer), GET …/file (PDF) → Zwischenspeicher, Portal, Mail über das
 *   CRM-Postfach bzw. Aufgabe „bereit zum Versand“.
 *   Annahme → ab_anlegen: POST /v1/order-confirmations?precedingSalesVoucherId={Angebot}&finalize=true (Altbeleg ohne
 *   Vorgänger) → ab_versand: Nummer + PDF → app.auftragsbestaetigungen (Spiegel), Mail/Aufgabe; Lexware setzt den
 *   Angebotsstatus per API nicht → falls nicht „accepted“: Aufgabe „in Lexware als angenommen markieren“ (Deeplink).
 *
 * Doppelbeleg nach Zeitüberschreitung: `vorhanden()` sucht in der Belegliste nach einem Beleg mit gleichem Kontakt und
 * Bruttobetrag, angelegt nach dem ersten Versuch (Verkaufsbelege haben kein Feld für eine Marke).
 */

/** Lexware-Oberfläche für Deeplinks (`{appbaseurl}/permalink/quotations/view/{id}`, Doku „Deeplinks“). */
export const LEXWARE_APP = 'https://app.lexware.de';
export const deeplink = (typ: 'quotations' | 'order-confirmations', id: string) => `${LEXWARE_APP}/permalink/${typ}/view/${id}`;

const NUMMER = /^[\p{L}\p{N} ._/-]{1,40}$/u;
const sicher = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '_');

type Roh = Record<string, any>;

async function ladeKopf(k: Kontext, angebotId: string): Promise<Roh | undefined> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select an.id, an.status, an.nummer, an.beleg_quelle, an.lexware_id, an.lexware_nummer, an.lexware_phase, an.auftrag_id,
			coalesce(a.kunde_id, an.kunde_id) as kunde_id
		from app.angebote an left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		where an.id = ${angebotId} and an.betrieb_id = ${k.betriebId}`);
	return z;
}

/** Alles, was die Belegbauer brauchen (Positionen, Kunde mit § 13b, Kleinunternehmer, Termine). */
export async function belegEingabe(k: Kontext, angebotId: string): Promise<BelegEingabe & { angebotNummer: string; kundeId: string | null }> {
	const daten = await ladePdfDaten(k, angebotId);
	const a = daten.angebot;
	const [[kd], [cfg]] = await mitBetrieb(k, (tx) =>
		Promise.all([
			a.kundeId
				? tx`select art, lexware_id, bauleister_13b, to_char(bescheinigung_13b_bis, 'YYYY-MM-DD') as bis from app.kunden where id = ${a.kundeId} and betrieb_id = ${k.betriebId}`
				: Promise.resolve([] as Roh[]),
			tx`select kleinunternehmer from app.lexware_konfig where betrieb_id = ${k.betriebId}`
		])
	);
	return {
		datum: a.datum,
		gueltigBis: a.gueltigBis,
		mwstSatz: a.mwstSatz,
		einleitung: a.einleitung,
		schluss: a.schluss,
		positionen: a.positionen.map((p) => ({ bezeichnung: p.bezeichnung, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit, einzelpreisCent: p.einzelpreisCent, materialCent: p.materialCent })),
		kunde: {
			lexwareId: kd?.lexware_id ?? null,
			art: kd?.art === 'firma' ? 'firma' : 'privat',
			name: daten.kunde.name || 'Kunde',
			strasse: daten.kunde.strasse,
			plz: daten.kunde.plz,
			ort: daten.kunde.ort,
			bauleister13b: kd?.bauleister_13b === true,
			bescheinigung13bBis: kd?.bis ?? null
		},
		kleinunternehmer: cfg?.kleinunternehmer === true,
		termine: a.terminvorschlaege.map((t) => ({ pos: t.pos, beginn: t.beginn, hinweis: t.hinweis })),
		angebotNummer: a.nummer,
		kundeId: a.kundeId
	};
}

/** Kunde vor dem Beleg in Lexware sicherstellen: verknüpft → ID; sonst erst suchen (Marke), dann anlegen. */
async function sichereKontakt(c: LexwareClient, k: Kontext, kundeId: string | null): Promise<string | null> {
	if (!kundeId) return null;
	const [kd] = await mitBetrieb(k, (tx) => tx`select lexware_id from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`);
	if (!kd) return null;
	if (kd.lexware_id) return kd.lexware_id;
	const n = { kundeId };
	const da = await kontaktAnlegen.vorhanden!(c, n, k);
	const r = da ? { lexwareId: da } : await kontaktAnlegen.ausfuehren(c, n, k, '');
	await kontaktAnlegen.nachher!(k, n, r);
	return r.lexwareId ?? null;
}

/** Schon angelegten Beleg finden (nach Zeitüberschreitung): gleicher Kontakt + Bruttobetrag, angelegt seit dem ersten Versuch. */
async function findeBeleg(
	c: LexwareClient,
	k: Kontext,
	typ: 'quotation' | 'orderconfirmation',
	e: { kontaktId: string | null; kontaktName: string; brutto: number; seit: string }
): Promise<string | null> {
	const seit = Date.parse(e.seit);
	if (!Number.isFinite(seit)) return null;
	const tag = berlinTag(new Date(seit - 86_400_000));
	const bekannt = new Set(
		(await mitBetrieb(k, (tx) => tx`
			select lexware_id from app.angebote where betrieb_id = ${k.betriebId} and lexware_id is not null
			union select lexware_id from app.auftragsbestaetigungen where betrieb_id = ${k.betriebId} and lexware_id is not null`)).map((z) => z.lexware_id as string)
	);
	const treffer: string[] = [];
	for (let seite = 0; seite < 20; seite++) {
		const r = await c.get<{ content: any[]; last: boolean }>(`/v1/voucherlist?voucherType=${typ}&voucherStatus=any&updatedDateFrom=${tag}&size=250&page=${seite}`);
		for (const b of r.content ?? []) {
			if (typeof b?.id !== 'string' || !UUID.test(b.id) || bekannt.has(b.id)) continue;
			const passt = e.kontaktId ? b.contactId === e.kontaktId : b.contactName === e.kontaktName;
			const angelegt = Date.parse(b.createdDate);
			if (passt && Math.round(Number(b.totalAmount) * 100) === e.brutto && Number.isFinite(angelegt) && angelegt >= seit - 60_000) treffer.push(b.id);
		}
		if (r.last || !r.content?.length) break;
	}
	if (treffer.length > 1) throw new LexwareFehler('Lexware: Mehrere passende Belege gefunden – bitte in Lexware prüfen, welcher zum CRM gehört.', null, 'daten', false);
	return treffer[0] ?? null;
}

async function speichereDatei(k: Kontext, lexwareId: string, typ: 'quotation' | 'orderconfirmation', name: string, bytes: Uint8Array): Promise<void> {
	const sha = createHash('sha256').update(bytes).digest('hex');
	await mitBetrieb(k, (tx) => tx`
		insert into app.lexware_dateien (betrieb_id, lexware_id, typ, name, pdf, sha256)
		values (${k.betriebId}, ${lexwareId}, ${typ}, ${name}, ${Buffer.from(bytes)}, ${sha})
		on conflict (betrieb_id, lexware_id) do update set name = excluded.name, pdf = excluded.pdf, sha256 = excluded.sha256, geholt = now()`);
}

const nummerAus = (b: any): string => {
	const nr = typeof b?.voucherNumber === 'string' ? b.voucherNumber.trim() : '';
	if (!NUMMER.test(nr)) throw new LexwareFehler('Lexware: Der Beleg hat noch keine gültige Nummer.', null, 'abhaengig', true);
	return nr;
};
const STATUS = ['draft', 'open', 'accepted', 'rejected', 'voided'];

// ——— Handler der Warteschlange ———

export const angebotFestschreiben: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const a = await ladeKopf(k, n.angebotId);
		if (!a || a.beleg_quelle !== 'lexware') return { ergebnis: { uebersprungen: 'Angebot fehlt' } };
		if (a.lexware_id) return { lexwareId: a.lexware_id, ergebnis: { schonFestgeschrieben: true } };
		if (a.status !== 'versendet') return { ergebnis: { uebersprungen: `Status ${a.status}` } };
		const e = await belegEingabe(k, a.id);
		e.kunde.lexwareId = await sichereKontakt(c, k, e.kundeId);
		const beleg = angebotAlsLexware(e);
		const r = await c.post<{ id: string; version?: number }>('/v1/quotations?finalize=true', beleg.body);
		if (typeof r?.id !== 'string' || !UUID.test(r.id)) throw new LexwareFehler('Lexware: unerwartete Antwort beim Anlegen des Angebots.', null, 'daten', false);
		return { lexwareId: r.id, ergebnis: { version: r.version ?? null, warnungen: beleg.warnungen } };
	},
	async vorhanden(c, n, k) {
		const e = await belegEingabe(k, n.angebotId);
		const kontaktId = e.kundeId ? ((await mitBetrieb(k, (tx) => tx`select lexware_id from app.kunden where id = ${e.kundeId} and betrieb_id = ${k.betriebId}`))[0]?.lexware_id ?? null) : null;
		if (e.kundeId && !kontaktId) return null; // ohne Kontakt kann es den Beleg noch nicht geben
		const satz = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: e.datum }).satz;
		return findeBeleg(c, k, 'quotation', { kontaktId, kontaktName: e.kunde.name, brutto: bruttoCent(e, satz), seit: n.seit });
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		const z = await mitBetrieb(k, (tx) => tx`
			update app.angebote set lexware_id = ${r.lexwareId!}, lexware_phase = 'festgeschrieben', lexware_status = 'open', lexware_fehler = null,
				lexware_version = ${typeof r.ergebnis?.version === 'number' ? (r.ergebnis.version as number) : null}, lexware_stand = now()
			where id = ${n.angebotId} and betrieb_id = ${k.betriebId} and lexware_id is null returning id`);
		if (z.length === 0) return;
		await stelleEin(k, { art: 'angebot_versand', nutzlast: { angebotId: n.angebotId, lexwareId: r.lexwareId }, idempotenz: `angebot_versand:${n.angebotId}:${r.lexwareId}` });
	},
	async beiFehler(k, n, text) {
		await mitBetrieb(k, (tx) => tx`
			update app.angebote set lexware_phase = 'fehler', lexware_fehler = ${text.slice(0, 1000)}
			where id = ${n.angebotId} and betrieb_id = ${k.betriebId} and lexware_id is null`);
	}
};

export const angebotVersand: Handler = {
	async ausfuehren(c, n, k) {
		if (typeof n.lexwareId !== 'string' || !UUID.test(n.lexwareId)) throw new LexwareFehler('ungültige Lexware-ID', null, 'daten', false);
		const a = await ladeKopf(k, n.angebotId);
		if (!a || a.lexware_id !== n.lexwareId) return { ergebnis: { uebersprungen: 'Angebot passt nicht' } };
		const q = await c.get<any>(`/v1/quotations/${n.lexwareId}`);
		const nr = nummerAus(q);
		const status = STATUS.includes(q?.voucherStatus) ? q.voucherStatus : null;
		await mitBetrieb(k, (tx) => tx`
			update app.angebote set lexware_nummer = ${nr}, nummer = ${nr}, lexware_status = coalesce(${status}, lexware_status),
				lexware_version = ${typeof q?.version === 'number' ? q.version : null}, lexware_stand = now()
			where id = ${a.id} and betrieb_id = ${k.betriebId} and lexware_id = ${n.lexwareId}`);
		const datei = await c.datei(`/v1/quotations/${n.lexwareId}/file`);
		const name = `Angebot_${sicher(nr)}.pdf`;
		await speichereDatei(k, n.lexwareId, 'quotation', name, datei.bytes);
		const hinweis = await mitBetrieb(k, async (tx) => {
			await tx`update app.angebote set lexware_phase = 'pdf' where id = ${a.id} and betrieb_id = ${k.betriebId} and lexware_phase is distinct from 'gesendet'`;
			if (a.auftrag_id) await gibAngebotImPortalFrei(tx, k, a.id, a.auftrag_id);
			if (a.lexware_phase === 'gesendet') return 'schon gesendet';
			return stelleAngebotZu(tx, k, { angebotId: a.id, nummer: nr, name, pdf: datei.bytes, lexwareId: n.lexwareId, auftragId: a.auftrag_id });
		});
		return { lexwareId: n.lexwareId, ergebnis: { nummer: nr, hinweis } };
	}
};

/** Mail mit dem Lexware-PDF (Vorlage „Angebot senden“) bzw. Aufgabe + Glocke „bereit zum Versand“. */
async function stelleAngebotZu(
	tx: TransactionSql,
	k: Kontext,
	e: { angebotId: string; nummer: string; name: string; pdf: Uint8Array; lexwareId: string; auftragId: string | null }
): Promise<string> {
	const { an, werte } = await mailWerte(tx, k, { angebotId: e.angebotId, auftragId: e.auftragId }, { preise: true });
	const versand = await mailVersandFuer(k.betriebId);
	if (versand.verbunden && an) {
		const vorlage = await vorlageFuer(tx, k, 'angebot');
		const mail = baueMail(vorlage, werte, await holeSignatur(k, tx));
		const r = await sendeMail(
			k,
			{ an, betreff: mail.betreff.slice(0, 300), html: mail.html, text: mail.text.slice(0, 5000), anhaenge: [{ name: e.name, typ: 'application/pdf', bytes: e.pdf }] },
			{ art: 'angebot', bezugTyp: 'angebot', bezugId: e.angebotId, lexwareId: e.lexwareId, versand }
		).catch((err: Error) => ({ status: 'fehler' as const, fehler: err.message }));
		if (r.status === 'gesendet') {
			await tx`update app.angebote set lexware_phase = 'gesendet', versendet_am = now() where id = ${e.angebotId} and betrieb_id = ${k.betriebId}`;
			return `Angebot ${e.nummer} an ${an} gesendet.`;
		}
	}
	const wer = await zustaendig(tx, k, null, e.auftragId);
	const titel = `Angebot ${e.nummer} an den Kunden senden`;
	const [t] = await tx`
		insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
		values (${k.betriebId}, ${e.auftragId}, ${titel}, ${'Bereit zum Versand: im Angebot „PDF (Lexware) herunterladen“ oder „In Mailprogramm öffnen“ (PDF anhängen), danach „Als gesendet markieren“.'}, ${wer}, ${berlinTag(new Date())})
		returning id`;
	if (wer) {
		const [er] = await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
			values (${k.betriebId}, ${wer}, ${t.id}, now(), ${`Angebot ${e.nummer} ist bereit`}, ${'Lexware hat das Angebot festgeschrieben – bitte an den Kunden senden.'}, ${`/angebote/${e.angebotId}`})
			returning id`;
		await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${k.betriebId}`;
	}
	return `Angebot ${e.nummer} ist bereit zum Versand.`;
}

export const abAnlegen: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const [da] = await mitBetrieb(k, (tx) => tx`select lexware_id from app.auftragsbestaetigungen where betrieb_id = ${k.betriebId} and angebot_id = ${n.angebotId}`);
		if (da) return { lexwareId: da.lexware_id, ergebnis: { schonDa: true } };
		const a = await ladeKopf(k, n.angebotId);
		if (!a || a.status !== 'angenommen') return { ergebnis: { uebersprungen: 'nicht angenommen' } };
		if (a.beleg_quelle === 'lexware' && !a.lexware_id)
			throw new LexwareFehler('Das Angebot ist noch nicht in Lexware festgeschrieben – die Auftragsbestätigung wartet darauf.', null, 'abhaengig', true);
		const e = await belegEingabe(k, a.id);
		e.kunde.lexwareId = await sichereKontakt(c, k, e.kundeId);
		const termin = typeof n.termin === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.termin) ? n.termin : null;
		const wunsch = typeof n.terminWunsch === 'string' ? n.terminWunsch.slice(0, 1000) : null;
		const beleg = abAlsLexware({ ...e, angebotNummer: a.nummer ?? '', heute: berlinTag(new Date()), termin, terminWunsch: wunsch });
		const pfad = `/v1/order-confirmations?${a.lexware_id ? `precedingSalesVoucherId=${a.lexware_id}&` : ''}finalize=true`;
		const r = await c.post<{ id: string }>(pfad, beleg.body);
		if (typeof r?.id !== 'string' || !UUID.test(r.id)) throw new LexwareFehler('Lexware: unerwartete Antwort beim Anlegen der Auftragsbestätigung.', null, 'daten', false);
		return { lexwareId: r.id, ergebnis: { warnungen: beleg.warnungen } };
	},
	async vorhanden(c, n, k) {
		const e = await belegEingabe(k, n.angebotId);
		const kontaktId = e.kundeId ? ((await mitBetrieb(k, (tx) => tx`select lexware_id from app.kunden where id = ${e.kundeId} and betrieb_id = ${k.betriebId}`))[0]?.lexware_id ?? null) : null;
		if (e.kundeId && !kontaktId) return null;
		const satz = steuerFall({ kunde: e.kunde, kleinunternehmer: e.kleinunternehmer, mwstSatz: e.mwstSatz, datum: berlinTag(new Date()) }).satz;
		return findeBeleg(c, k, 'orderconfirmation', { kontaktId, kontaktName: e.kunde.name, brutto: bruttoCent(e, satz), seit: n.seit });
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		await stelleEin(k, { art: 'ab_versand', nutzlast: { ...n, lexwareId: r.lexwareId }, idempotenz: `ab_versand:${n.angebotId}` });
	}
};

export const abVersand: Handler = {
	async ausfuehren(c, n, k) {
		if (typeof n.lexwareId !== 'string' || !UUID.test(n.lexwareId)) throw new LexwareFehler('ungültige Lexware-ID', null, 'daten', false);
		const a = await ladeKopf(k, n.angebotId);
		if (!a) return { ergebnis: { uebersprungen: 'Angebot gelöscht' } };
		const ab = await c.get<any>(`/v1/order-confirmations/${n.lexwareId}`);
		const nr = nummerAus(ab);
		const datei = await c.datei(`/v1/order-confirmations/${n.lexwareId}/file`);
		await speichereDatei(k, n.lexwareId, 'orderconfirmation', `Auftragsbestaetigung_${sicher(nr)}.pdf`, datei.bytes);
		const benutzer = typeof n.benutzerId === 'string' && UUID.test(n.benutzerId) ? n.benutzerId : null;
		const quelle = typeof n.quelle === 'string' ? n.quelle.slice(0, 40) : 'oberflaeche';
		const hinweis = await mitBetrieb(k, async (tx) => {
			const [neu] = await tx`
				insert into app.auftragsbestaetigungen (betrieb_id, angebot_id, auftrag_id, nummer, pdf, ausloeser, beleg_quelle, lexware_id)
				values (${k.betriebId}, ${a.id}, ${a.auftrag_id}, ${nr}, ${Buffer.from(datei.bytes)}, ${quelle}, 'lexware', ${n.lexwareId})
				on conflict (betrieb_id, angebot_id) do nothing returning id`;
			if (!neu) return 'schon da';
			return stelleAbZu(tx, k, { abId: neu.id, nummer: nr, pdf: datei.bytes, angebotId: a.id, angebotNummer: a.nummer ?? '', auftragId: a.auftrag_id, benutzerId: benutzer, lexwareId: n.lexwareId });
		});
		// Den Angebotsstatus kann das CRM in Lexware nicht setzen (Doku „Quotations“) → falls nötig Aufgabe mit Deeplink
		if (a.lexware_id && hinweis !== 'schon da') {
			const q = await c.get<any>(`/v1/quotations/${a.lexware_id}`);
			const st = STATUS.includes(q?.voucherStatus) ? q.voucherStatus : null;
			if (st) await mitBetrieb(k, (tx) => tx`update app.angebote set lexware_status = ${st}, lexware_stand = now() where id = ${a.id} and betrieb_id = ${k.betriebId}`);
			if (st !== 'accepted')
				await meldeProblem(k, `Angebot ${a.nummer} in Lexware als angenommen markieren`, `Der Kunde hat angenommen, die Auftragsbestätigung ${nr} ist angelegt. Lexware lässt den Angebotsstatus nicht per Schnittstelle setzen: ${deeplink('quotations', a.lexware_id)}`);
		}
		return { lexwareId: n.lexwareId, ergebnis: { nummer: nr, hinweis } };
	}
};

// ——— für Oberfläche und Sprache ———

/** Hinweise vor dem Versand (z. B. § 35a ohne Materialanteil, § 13b abgelaufen) – nur für Lexware-Entwürfe. */
export async function lexwareHinweise(k: Kontext, angebotId: string): Promise<string[]> {
	const e = await belegEingabe(k, angebotId);
	return angebotAlsLexware(e).warnungen;
}

/** Stand der Lexware-Schritte eines Angebots (Warteschlange): offen/Problem, für „wartet auf Lexware (seit …)“. */
export async function lexwareSchritte(k: Kontext, angebotId: string): Promise<{ art: string; status: string; fehler: string | null; seit: string }[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select art, status, letzter_fehler, angelegt from app.lexware_auftraege
		where betrieb_id = ${k.betriebId} and nutzlast ->> 'angebotId' = ${angebotId} and status not in ('erledigt', 'abgebrochen')
		order by angelegt`);
	return z.map((r) => ({ art: r.art, status: r.status, fehler: r.letzter_fehler, seit: new Date(r.angelegt).toISOString() }));
}

/** PDF aus Lexware (Zwischenspeicher; fehlt es, frisch aus Lexware holen). Rechte/Sicht prüft `holeAngebot`. */
export async function lexwareAngebotPdf(k: Kontext, angebotId: string, zg: AngebotZugriff): Promise<{ name: string; bytes: Uint8Array } | null> {
	const a = await holeAngebot(k, angebotId, zg);
	if (a.belegQuelle !== 'lexware' || !a.lexware?.id) return null;
	const [z] = await mitBetrieb(k, (tx) => tx`select name, pdf from app.lexware_dateien where betrieb_id = ${k.betriebId} and lexware_id = ${a.lexware!.id}`);
	if (z) return { name: z.name, bytes: new Uint8Array(z.pdf) };
	const c = await holeClient(k);
	const d = await c.datei(`/v1/quotations/${a.lexware.id}/file`);
	const name = `Angebot_${sicher(a.nummer)}.pdf`;
	await speichereDatei(k, a.lexware.id, 'quotation', name, d.bytes);
	return { name, bytes: d.bytes };
}

/** „Als gesendet markieren“ (nach dem Mailprogramm): Versanddatum (Nachfassen zählt ab hier), Aufgabe erledigt. */
export async function markiereAngebotGesendet(k: Kontext, id: string, zg: AngebotZugriff): Promise<void> {
	const aid = pruefeAngebotId(id);
	const a = await holeAngebot(k, aid, zg);
	if (a.belegQuelle !== 'lexware' || a.lexware?.phase !== 'pdf') throw new ApiFehler(409, 'Das Angebot ist noch nicht bereit oder schon gesendet.');
	await mitBetrieb(k, async (tx) => {
		await tx`update app.angebote set lexware_phase = 'gesendet', versendet_am = now() where id = ${aid} and betrieb_id = ${k.betriebId} and lexware_phase = 'pdf'`;
		await tx`update app.todos set erledigt_am = now() where betrieb_id = ${k.betriebId} and titel = ${`Angebot ${a.nummer} an den Kunden senden`} and erledigt_am is null`;
	});
}
