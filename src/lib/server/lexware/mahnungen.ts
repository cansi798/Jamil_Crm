import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { UUID } from '../kunden';
import { berlinTag, tagDeutsch, tagPlus } from '../../zeit';
import { euro } from '../../geld';
import { faelligeStufe, fuelle } from '../../nachfassen';
import { MAHNSTUFE_NAMEN, verzugszinsenCent } from '../../rechnungen';
import { listeStufen, zustaendigFuer, type NachfassStufe } from '../nachfassen';
import { baueMail, holeSignatur, stelleStandardsSicher, vorlageFuer } from '../mail-vorlagen';
import { mailVersandFuer, sendeMail } from '../mail/versand';
import { LexwareFehler } from './client';
import { mahnungAlsLexware, type BelegKunde, type SteuerFall } from './belege';
import { deeplink, sicher, speichereDatei } from './angebote';
import { RECHNUNG_TYP_PFAD, rechnungPdf, rechnungsWerte, stoppeMahnungen } from './rechnungen';
import { stelleEin, type Handler } from './warteschlange';
import { stosseLexwareAn } from './anstoss';

/**
 * Zahlungserinnerung und Mahnung (Plan Phase 3, Task T9; Jamil #6093 „Mahnstufen individuell einstellbar“).
 *
 * Stufen je Betrieb: `app.nachfass_stufen` Art „rechnung“ (Tage nach Fälligkeit, Mahnstufe 0–3, Gebühr, 40-€-Pauschale
 * nur Firmen, Zinshinweis, Freigabe, Mail-Vorlage, Zuständig). Der Lauf (Hintergrund-Dienst, höchstens stündlich)
 * legt je Rechnung und Stufe genau einen Lauf an – Basis ist die gespiegelte Lexware-Fälligkeit –, nur für offene/
 * überfällige CRM-Rechnungen mit offenem Betrag, nicht pausiert, Kunde ohne „kein Nachfassen“.
 * Stufe 0: Aufgabe + vorbereitete Mail. Stufe 1–3: POST /v1/dunnings?precedingSalesVoucherId={Rechnung} (bleibt
 * Entwurf), PDF → Aufgabe + Mail auf Klick; mit „Freigabe“ erst nach „Mahnung freigeben“. Bei Zahlung stoppt alles.
 * Verzugszinsen nur als Hinweis (Text/Platzhalter), nie als Lexware-Position.
 */

type Roh = Record<string, any>;
export const PAUSCHALE_CENT = 4000;

// ——— Einstellungen ———

export type MahnKonfig = { basiszinsHundertstel: number; zahlungszielTage: number };

export async function holeMahnKonfig(k: Kontext): Promise<MahnKonfig> {
	const [z] = await mitBetrieb(k, (tx) => tx`select basiszins_hundertstel, zahlungsziel_tage from app.mahn_konfig where betrieb_id = ${k.betriebId}`);
	return { basiszinsHundertstel: z?.basiszins_hundertstel ?? 127, zahlungszielTage: z?.zahlungsziel_tage ?? 14 };
}

export async function speichereMahnKonfig(k: Kontext, e: { basiszins?: unknown; zahlungszielTage?: unknown }): Promise<MahnKonfig> {
	const t = typeof e.basiszins === 'string' ? e.basiszins.trim().replace('%', '').replace(',', '.') : String(e.basiszins ?? '');
	if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(t)) throw new ApiFehler(400, 'Basiszins: Bitte eine Zahl wie 1,27 (Prozent, auch negativ).');
	const basis = Math.round(Number(t) * 100);
	const tage = Number(e.zahlungszielTage);
	if (basis < -1000 || basis > 2000) throw new ApiFehler(400, 'Basiszins: −10 bis 20 %.');
	if (!Number.isInteger(tage) || tage < 0 || tage > 120) throw new ApiFehler(400, 'Zahlungsziel: 0 bis 120 Tage.');
	await mitBetrieb(k, (tx) => tx`
		insert into app.mahn_konfig (betrieb_id, basiszins_hundertstel, zahlungsziel_tage) values (${k.betriebId}, ${basis}, ${tage})
		on conflict (betrieb_id) do update set basiszins_hundertstel = excluded.basiszins_hundertstel, zahlungsziel_tage = excluded.zahlungsziel_tage, geaendert = now()`);
	return { basiszinsHundertstel: basis, zahlungszielTage: tage };
}

/** Vorschlag (Plan Frage 11): Erinnerung +3, 1. Mahnung +17, 2. Mahnung +45 mit Zinshinweis + 40 € bei Firmen, 3. Mahnung +60 nur nach Freigabe. */
export const STANDARD_MAHNSTUFEN = [
	{ tage: 3, mahnstufe: 0, gebuehrCent: 0, pauschaleFirma: false, zinsenHinweis: false, freigabe: false },
	{ tage: 17, mahnstufe: 1, gebuehrCent: 0, pauschaleFirma: false, zinsenHinweis: false, freigabe: false },
	{ tage: 45, mahnstufe: 2, gebuehrCent: 0, pauschaleFirma: true, zinsenHinweis: true, freigabe: false },
	{ tage: 60, mahnstufe: 3, gebuehrCent: 0, pauschaleFirma: true, zinsenHinweis: true, freigabe: true }
] as const;

export async function uebernimmMahnStandard(k: Kontext): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.nachfass_stufen where betrieb_id = ${k.betriebId} and art = 'rechnung' limit 1`;
		if (da) throw new ApiFehler(409, 'Es gibt schon Mahnstufen.');
		await stelleStandardsSicher(tx, k, ['zahlungserinnerung', 'mahnung']);
		const v = new Map((await tx`select zweck, id from app.mail_vorlagen where betrieb_id = ${k.betriebId} and ist_standard and zweck in ('zahlungserinnerung', 'mahnung')`).map((z) => [z.zweck as string, z.id as string]));
		let pos = 0;
		for (const s of STANDARD_MAHNSTUFEN)
			await tx`
				insert into app.nachfass_stufen (betrieb_id, art, pos, tage, todo, mail, mail_vorlage_id, zuweisung, mahnstufe, gebuehr_cent, pauschale_firma, zinsen_hinweis, freigabe)
				values (${k.betriebId}, 'rechnung', ${pos++}, ${s.tage}, true, true, ${v.get(s.mahnstufe === 0 ? 'zahlungserinnerung' : 'mahnung') ?? null}, 'zustaendig',
					${s.mahnstufe}, ${s.gebuehrCent}, ${s.pauschaleFirma}, ${s.zinsenHinweis}, ${s.freigabe})`;
	});
}

// ——— Lauf ———

function zinsSatz(zinsen: number, heute: string): string | null {
	return zinsen > 0 ? `Verzugszinsen nach § 288 BGB bis ${tagDeutsch(heute)}: ${euro(zinsen)} – wir behalten uns vor, sie geltend zu machen.` : null;
}

/** Fällige Mahnstufen anlegen; liefert die Zahl neuer Läufe. `heute` nur für Tests. */
export async function pruefeMahnungen(k: Kontext, heute = berlinTag(new Date())): Promise<number> {
	await mitBetrieb(k, (tx) => stoppeMahnungen(tx, k));
	const stufen = (await listeStufen(k, 'rechnung')).filter((s) => s.aktiv);
	if (stufen.length === 0) return 0;
	const cfg = await holeMahnKonfig(k);
	const kandidaten = await mitBetrieb(k, (tx) => tx`
		select r.*, b.nummer as re_nummer, to_char(b.faellig, 'YYYY-MM-DD') as faellig, b.offen_cent, b.brutto_cent as re_brutto, k.art as kunde_art,
			coalesce((select array_agg(l.stufe_id::text) from app.nachfass_laeufe l where l.rechnung_id = r.id and l.betrieb_id = r.betrieb_id), '{}') as gelaufen
		from app.rechnungen r
		join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
		left join app.kunden k on k.id = coalesce(r.kunde_id, b.kunde_id) and k.betrieb_id = r.betrieb_id
		where r.betrieb_id = ${k.betriebId} and r.phase = 'angelegt' and b.typ in ('invoice', 'downpaymentinvoice') and b.status in ('open', 'overdue')
			and coalesce(b.offen_cent, 0) > 0 and b.faellig is not null and b.faellig < ${heute} and not b.archiviert
			and (r.mahnen_pausiert_bis is null or r.mahnen_pausiert_bis < ${heute}) and not coalesce(k.kein_nachfassen, false)
		order by b.faellig`);
	let neu = 0;
	const signatur = await holeSignatur(k);
	for (const r of kandidaten) {
		const s = faelligeStufe(r.faellig, heute, stufen, r.gelaufen as string[]);
		if (!s) continue;
		const stufe = s.mahnstufe ?? 0;
		const firma = r.kunde_art === 'firma';
		const zinsen = s.zinsenHinweis ? verzugszinsenCent({ offenCent: Number(r.offen_cent), faellig: r.faellig, heute, basiszinsHundertstel: cfg.basiszinsHundertstel, firma }).cent : 0;
		const gebuehr = s.gebuehrCent + (s.pauschaleFirma && firma ? PAUSCHALE_CENT : 0);
		const status = stufe === 0 ? 'bereit' : s.freigabe ? 'freigabe' : 'wartet';
		const nr = stufen.findIndex((x) => x.id === s.id) + 1;
		const lauf = await mitBetrieb(k, async (tx) => {
			const { an, werte } = await rechnungsWerte(tx, k, r, heute);
			werte.zinsen = euro(zinsen);
			werte.gebuehr = euro(gebuehr);
			werte.mahnstufe = MAHNSTUFE_NAMEN[stufe];
			const mail = s.mail ? baueMail(await vorlageFuer(tx, k, stufe === 0 ? 'zahlungserinnerung' : 'mahnung', s.mailVorlageId), werte, signatur) : null;
			const [l] = await tx`
				insert into app.nachfass_laeufe (betrieb_id, rechnung_id, stufe_id, stufe_nr, tage, mail_betreff, mail_html, mail_text, mail_an, status, zinsen_cent, gebuehr_cent)
				values (${k.betriebId}, ${r.id}, ${s.id}, ${nr}, ${s.tage}, ${mail?.betreff.slice(0, 300) ?? null}, ${mail?.html ?? null}, ${mail?.text ?? null}, ${an},
					${status}, ${zinsen}, ${gebuehr})
				on conflict (rechnung_id, stufe_id) do nothing returning id`;
			if (!l) return null;
			const kunde = werte['kunde.name'] || 'Kunde';
			const titel = (
				s.todo && s.todoTitel
					? fuelle(s.todoTitel, werte, false)
					: status === 'freigabe'
						? `${MAHNSTUFE_NAMEN[stufe]} freigeben: Rechnung ${r.re_nummer} (${kunde})`
						: `${MAHNSTUFE_NAMEN[stufe]} senden: Rechnung ${r.re_nummer} (${kunde})`
			).slice(0, 200);
			const text = [
				`Rechnung ${r.re_nummer}: ${werte.offen} offen, fällig seit ${werte.faellig_am} (${werte.tage} Tage).`,
				zinsen > 0 ? `Verzugszinsen (nur Hinweis): ${werte.zinsen}.` : null,
				status === 'freigabe' ? 'Diese Stufe braucht Ihre Freigabe – in der Rechnung „Mahnung freigeben“.' : stufe > 0 ? 'Die Mahnung wird in Lexware angelegt; danach in der Rechnung „Senden“.' : 'Die Mail liegt fertig in der Rechnung („Senden“ oder Mailprogramm).'
			].filter(Boolean).join(' ');
			const wer = await zustaendigFuer(tx, k, s as NachfassStufe, r.auftrag_id);
			const [t] = await tx`
				insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig, nachfass_id)
				values (${k.betriebId}, ${r.auftrag_id}, ${titel}, ${text.slice(0, 500)}, ${wer}, ${tagPlus(heute, s.faelligVersatz)}, ${l.id}) returning id`;
			await tx`update app.nachfass_laeufe set todo_id = ${t.id} where id = ${l.id} and betrieb_id = ${k.betriebId}`;
			return l.id as string;
		});
		if (!lauf) continue;
		neu++;
		if (status === 'wartet') await stelleEin(k, { art: 'mahnung_anlegen', nutzlast: { laufId: lauf }, idempotenz: `mahnung_anlegen:${lauf}` });
	}
	if (neu) stosseLexwareAn(k);
	return neu;
}

const zuletzt = new Map<string, number>();
/** Höchstens stündlich je Betrieb (Hintergrund-Dienst); Fehler nur ins Log. */
export async function pruefeMahnungenGedrosselt(k: Kontext): Promise<void> {
	const jetzt = Date.now();
	if ((zuletzt.get(k.betriebId) ?? 0) > jetzt - 3_600_000) return;
	zuletzt.set(k.betriebId, jetzt);
	try {
		await pruefeMahnungen(k);
	} catch (e) {
		console.error('Mahnungen fehlgeschlagen:', (e as Error).message);
	}
}
export const loeseMahnDrossel = (betriebId: string) => zuletzt.delete(betriebId);

// ——— Lexware-Mahnung ———

async function ladeLauf(k: Kontext, laufId: unknown): Promise<Roh | undefined> {
	if (typeof laufId !== 'string' || !UUID.test(laufId)) return undefined;
	const [z] = await mitBetrieb(k, (tx) => tx`
		select l.*, s.mahnstufe, s.gebuehr_cent as stufe_gebuehr, s.pauschale_firma, kd.art as kunde_art,
			r.lexware_id as re_lexware_id, r.lexware_typ, r.auftrag_id, r.id as re_id, b.nummer as re_nummer
		from app.nachfass_laeufe l join app.nachfass_stufen s on s.id = l.stufe_id and s.betrieb_id = l.betrieb_id
		join app.rechnungen r on r.id = l.rechnung_id and r.betrieb_id = l.betrieb_id
		left join app.lexware_belege b on b.lexware_id = r.lexware_id and b.betrieb_id = r.betrieb_id
		left join app.kunden kd on kd.id = coalesce(r.kunde_id, b.kunde_id) and kd.betrieb_id = r.betrieb_id
		where l.id = ${laufId} and l.betrieb_id = ${k.betriebId}`);
	return z;
}

const TAX = ['net', 'gross', 'vatfree', 'constructionService13b', 'intraCommunitySupply', 'externalService13b', 'thirdPartyCountryService', 'thirdPartyCountryDelivery', 'photovoltaicEquipment'];

export const mahnungAnlegen: Handler = {
	anlegend: true,
	async ausfuehren(c, n, k) {
		const l = await ladeLauf(k, n.laufId);
		if (!l) return { ergebnis: { uebersprungen: 'Lauf fehlt' } };
		if (l.mahnung_lexware_id) return { lexwareId: l.mahnung_lexware_id, ergebnis: { schonDa: true } };
		if (l.status !== 'wartet') return { ergebnis: { uebersprungen: `Status ${l.status}` } };
		const pfad = RECHNUNG_TYP_PFAD[(l.lexware_typ ?? 'invoice') as 'invoice'];
		const inv = await c.get<Roh>(`/v1/${pfad}/${l.re_lexware_id}`);
		// erneut prüfen: inzwischen bezahlt/storniert → keine Mahnung (Plan Entscheidung 7)
		if (!['open', 'overdue'].includes(inv?.voucherStatus)) {
			await mitBetrieb(k, async (tx) => {
				await tx`update app.nachfass_laeufe set status = 'gestoppt' where id = ${l.id} and betrieb_id = ${k.betriebId}`;
				if (l.todo_id) await tx`update app.todos set erledigt_am = now() where id = ${l.todo_id} and betrieb_id = ${k.betriebId} and erledigt_am is null`;
			});
			return { ergebnis: { uebersprungen: `Rechnung ${inv?.voucherStatus}` } };
		}
		const ad = inv?.address ?? {};
		const kunde: BelegKunde = {
			lexwareId: typeof ad.contactId === 'string' && UUID.test(ad.contactId) ? ad.contactId : null,
			art: 'privat',
			name: typeof ad.name === 'string' ? ad.name : 'Kunde',
			strasse: typeof ad.street === 'string' ? ad.street : null,
			plz: typeof ad.zip === 'string' ? ad.zip : null,
			ort: typeof ad.city === 'string' ? ad.city : null,
			bauleister13b: false,
			bescheinigung13bBis: null
		};
		const taxType = (TAX.includes(inv?.taxConditions?.taxType) ? inv.taxConditions.taxType : 'net') as SteuerFall['taxType'];
		const heute = berlinTag(new Date());
		const body = mahnungAlsLexware({
			heute,
			kunde,
			taxType,
			stufe: Math.max(1, Number(l.mahnstufe ?? 1)),
			rechnungNummer: l.re_nummer ?? '',
			gebuehrCent: Number(l.stufe_gebuehr ?? 0),
			pauschaleCent: l.pauschale_firma && l.kunde_art === 'firma' ? PAUSCHALE_CENT : 0,
			zinsHinweis: zinsSatz(Number(l.zinsen_cent ?? 0), heute)
		});
		const r = await c.post<{ id: string }>(`/v1/dunnings?precedingSalesVoucherId=${l.re_lexware_id}`, body);
		if (typeof r?.id !== 'string' || !UUID.test(r.id)) throw new LexwareFehler('Lexware: unerwartete Antwort beim Anlegen der Mahnung.', null, 'daten', false);
		return { lexwareId: r.id };
	},
	// Mahnungen stehen laut Doku nicht in der Belegliste → nach Zeitüberschreitung nie blind neu anlegen
	async vorhanden() {
		throw new LexwareFehler('Ob Lexware die Mahnung angelegt hat, ist unklar (Zeitüberschreitung oder Serverfehler). Bitte in Lexware unter der Rechnung nachsehen und hier „Erneut versuchen“ oder „Abbrechen“.', null, 'daten', false);
	},
	async nachher(k, n, r) {
		if (!r.lexwareId) return;
		const z = await mitBetrieb(k, (tx) => tx`update app.nachfass_laeufe set mahnung_lexware_id = ${r.lexwareId!} where id = ${n.laufId} and betrieb_id = ${k.betriebId} and mahnung_lexware_id is null returning id`);
		if (z.length) await stelleEin(k, { art: 'mahnung_versand', nutzlast: { laufId: n.laufId, lexwareId: r.lexwareId }, idempotenz: `mahnung_versand:${r.lexwareId}` });
	},
	async beiFehler(k, n) {
		await mitBetrieb(k, (tx) => tx`update app.nachfass_laeufe set status = 'fehler' where id = ${n.laufId} and betrieb_id = ${k.betriebId} and status = 'wartet'`);
	}
};

export const mahnungVersand: Handler = {
	async ausfuehren(c, n, k) {
		if (typeof n.lexwareId !== 'string' || !UUID.test(n.lexwareId)) throw new LexwareFehler('ungültige Lexware-ID', null, 'daten', false);
		const l = await ladeLauf(k, n.laufId);
		if (!l || l.mahnung_lexware_id !== n.lexwareId) return { ergebnis: { uebersprungen: 'Lauf passt nicht' } };
		let pdf = false;
		try {
			const d = await c.datei(`/v1/dunnings/${n.lexwareId}/file`);
			await speichereDatei(k, n.lexwareId, 'dunning', `Mahnung_${sicher(l.re_nummer ?? 'Rechnung')}_${l.mahnstufe ?? 1}.pdf`, d.bytes);
			pdf = true;
		} catch (e) {
			// Entwurf ohne Dokument (Plan T0 offen) → Mahnung in Lexware öffnen und dort drucken/versenden
			if (!(e instanceof LexwareFehler && (e.art === 'konflikt' || e.art === 'nicht_gefunden'))) throw e;
		}
		await mitBetrieb(k, (tx) => tx`update app.nachfass_laeufe set status = 'bereit' where id = ${l.id} and betrieb_id = ${k.betriebId} and status = 'wartet'`);
		return { lexwareId: n.lexwareId, ergebnis: { pdf } };
	}
};

// ——— Oberfläche: Läufe, Freigabe, Senden ———

export type MahnLauf = {
	id: string;
	stufe: number;
	name: string;
	status: string;
	angelegt: string;
	gesendetAm: string | null;
	mailBetreff: string | null;
	mailText: string | null;
	mailAn: string | null;
	zinsenCent: number;
	gebuehrCent: number;
	pdf: boolean;
	lexwareLink: string | null;
	todoErledigt: boolean;
};

export async function mahnLaeufe(k: Kontext, rechnungId: string): Promise<MahnLauf[]> {
	if (!UUID.test(rechnungId)) return [];
	const z = await mitBetrieb(k, (tx) => tx`
		select l.id, s.mahnstufe, l.status, l.angelegt, l.gesendet_am, l.mail_betreff, l.mail_text, l.mail_an, l.zinsen_cent, l.gebuehr_cent, l.mahnung_lexware_id,
			t.erledigt_am is not null as todo_erledigt,
			exists (select 1 from app.lexware_dateien d where d.betrieb_id = l.betrieb_id and d.lexware_id = l.mahnung_lexware_id) as pdf
		from app.nachfass_laeufe l join app.nachfass_stufen s on s.id = l.stufe_id and s.betrieb_id = l.betrieb_id
		left join app.todos t on t.id = l.todo_id and t.betrieb_id = l.betrieb_id
		where l.rechnung_id = ${rechnungId} and l.betrieb_id = ${k.betriebId} order by l.angelegt, l.id`);
	return z.map((r) => ({
		id: r.id,
		stufe: r.mahnstufe ?? 0,
		name: MAHNSTUFE_NAMEN[r.mahnstufe ?? 0] ?? 'Mahnung',
		status: r.status,
		angelegt: new Date(r.angelegt).toISOString(),
		gesendetAm: r.gesendet_am ? new Date(r.gesendet_am).toISOString() : null,
		mailBetreff: r.mail_betreff,
		mailText: r.mail_text,
		mailAn: r.mail_an,
		zinsenCent: Number(r.zinsen_cent ?? 0),
		gebuehrCent: Number(r.gebuehr_cent ?? 0),
		pdf: !!r.pdf,
		lexwareLink: r.mahnung_lexware_id ? deeplink('dunnings', r.mahnung_lexware_id) : null,
		todoErledigt: !!r.todo_erledigt
	}));
}

export async function mahnungFreigeben(k: Kontext, laufId: unknown): Promise<void> {
	const l = await ladeLauf(k, laufId);
	if (!l) throw new ApiFehler(404, 'Mahnung nicht gefunden.');
	const z = await mitBetrieb(k, (tx) => tx`update app.nachfass_laeufe set status = 'wartet' where id = ${l.id} and betrieb_id = ${k.betriebId} and status = 'freigabe' returning id`);
	if (z.length === 0) throw new ApiFehler(409, 'Diese Mahnung wartet nicht auf Freigabe.');
	await stelleEin(k, { art: 'mahnung_anlegen', nutzlast: { laufId: l.id }, idempotenz: `mahnung_anlegen:${l.id}` });
	stosseLexwareAn(k);
}

/** Mahnung/Erinnerung als PDF (Mahnung aus Lexware; Erinnerung = Rechnungs-PDF). */
export async function laufPdf(k: Kontext, laufId: unknown): Promise<{ name: string; bytes: Uint8Array } | null> {
	const l = await ladeLauf(k, laufId);
	if (!l) throw new ApiFehler(404, 'Mahnung nicht gefunden.');
	if (!l.mahnung_lexware_id) return null;
	const [d] = await mitBetrieb(k, (tx) => tx`select name, pdf from app.lexware_dateien where betrieb_id = ${k.betriebId} and lexware_id = ${l.mahnung_lexware_id}`);
	return d ? { name: d.name, bytes: new Uint8Array(d.pdf) } : null;
}

/** „Senden“ über das CRM-Postfach (Erinnerung mit Rechnungs-PDF, Mahnung mit Mahnungs-PDF). */
export async function sendeLauf(k: Kontext, laufId: unknown): Promise<{ an: string }> {
	const l = await ladeLauf(k, laufId);
	if (!l) throw new ApiFehler(404, 'Mahnung nicht gefunden.');
	if (l.status !== 'bereit') throw new ApiFehler(409, l.status === 'freigabe' ? 'Bitte die Mahnung zuerst freigeben.' : 'Die Mahnung ist noch nicht bereit oder schon gesendet.');
	if (!l.mail_an || !l.mail_betreff) throw new ApiFehler(409, 'Für diese Stufe ist keine Mail vorbereitet bzw. beim Kunden fehlt die E-Mail-Adresse.');
	const versand = await mailVersandFuer(k.betriebId);
	if (!versand.verbunden) throw new ApiFehler(409, 'Der Mailversand ist nicht eingerichtet – bitte „In Mailprogramm öffnen“ und danach „Als gesendet markieren“.');
	const pdf = l.mahnung_lexware_id ? await laufPdf(k, l.id) : await rechnungPdf(k, l.re_id, true);
	const e = await sendeMail(
		k,
		{ an: l.mail_an, betreff: l.mail_betreff, html: l.mail_html ?? l.mail_text, text: (l.mail_text ?? '').slice(0, 5000), anhaenge: pdf ? [{ name: pdf.name, typ: 'application/pdf', bytes: pdf.bytes }] : [] },
		{ art: (l.mahnstufe ?? 0) === 0 ? 'erinnerung' : 'mahnung', bezugTyp: 'rechnung', bezugId: l.re_id, lexwareId: l.mahnung_lexware_id ?? l.re_lexware_id, versand }
	);
	if (e.status !== 'gesendet') throw new ApiFehler(502, 'Die Mail konnte nicht gesendet werden – Details unter Einstellungen → E-Mail-Versand.');
	await markiereLaufGesendet(k, l.id);
	return { an: l.mail_an };
}

export async function markiereLaufGesendet(k: Kontext, laufId: unknown): Promise<void> {
	const l = await ladeLauf(k, laufId);
	if (!l) throw new ApiFehler(404, 'Mahnung nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`update app.nachfass_laeufe set status = 'gesendet', gesendet_am = coalesce(gesendet_am, now()) where id = ${l.id} and betrieb_id = ${k.betriebId} and status = 'bereit' returning todo_id`;
		if (!z.length) throw new ApiFehler(409, 'Die Mahnung ist noch nicht bereit oder schon gesendet.');
		if (z[0].todo_id) await tx`update app.todos set erledigt_am = coalesce(erledigt_am, now()) where id = ${z[0].todo_id} and betrieb_id = ${k.betriebId}`;
	});
}
