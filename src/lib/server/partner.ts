import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { sichtbar, type Sicht } from './auftraege';
import { textFeld, UUID } from './kunden';
import { pruefeRecht } from './rechte';
import { darf } from './tarif';
import { pruefeBild } from './bildpruefung';
import { pruefeLinkUrl } from './auftrag-links';
import { leseEuroInCent } from '../geld';
import { berlinTag, berlinZeitpunkt, istTag, tagDeutsch, tagPlus } from '../zeit';

/**
 * Partner (Wunsch Jamil, Talk msgs 2854/2856): Auftraggeber, Subunternehmer, Lieferanten mit Kontakten, Konditionen und
 * Nachweisen. Verwalten nur mit `partner.verwalten` (Modul `auftraege`). Am Auftrag: Auftraggeber, Subunternehmer
 * (Warnung bei abgelaufenen Nachweisen) und Fremdleistungen (Beträge nur mit „Preise sehen“, in der Nachkalkulation).
 * Nachweise mit „gültig bis“: 30 Tage vorher eine Aufgabe mit Erinnerung für alle, die Partner verwalten.
 */

import {
	ERINNERN_TAGE,
	istPartnerArt,
	NACHWEIS_ART_NAMEN,
	NACHWEIS_ARTEN,
	NACHWEIS_MAX_BYTES,
	nachweisStatus,
	PARTNER_ART_NAMEN,
	type NachweisArt,
	type NachweisStatus,
	type PartnerArt
} from '../partner';
export { ERINNERN_TAGE, istPartnerArt, NACHWEIS_ART_NAMEN, NACHWEIS_ARTEN, nachweisStatus, PARTNER_ART_NAMEN, PARTNER_ARTEN, NACHWEIS_MAX_BYTES } from '../partner';
export type { NachweisArt, NachweisStatus, PartnerArt } from '../partner';

export type Kontakt = { id: string; name: string; rolle: string | null; telefon: string | null; email: string | null };
export type Nachweis = { id: string; art: NachweisArt; bezeichnung: string | null; gueltigBis: string | null; dateiName: string | null; status: NachweisStatus };
export type Partner = {
	id: string;
	art: PartnerArt;
	name: string;
	nummer: string | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
	telefon: string | null;
	email: string | null;
	web: string | null;
	portalUrl: string | null;
	portalNotiz: string | null;
	notizen: string | null;
	provisionProzent: number | null;
	rabattProzent: number | null;
	zahlungszielTage: number | null;
	aktiv: boolean;
	kontakte: Kontakt[];
	nachweise: Nachweis[];
};
export type PartnerKurz = { id: string; art: PartnerArt; name: string; ort: string | null; aktiv: boolean; warnung: string | null; auftraege: number };

const nichtGefunden = () => new ApiFehler(404, 'Partner nicht gefunden.');
const pruefeId = (w: unknown, fehler = nichtGefunden) => {
	if (typeof w !== 'string' || !UUID.test(w)) throw fehler();
	return w.toLowerCase();
};

/** Verwalten: Modul `auftraege` + `partner.verwalten`. */
export async function partnerZugriff(locals: { nutzer: Nutzer | null }): Promise<Kontext> {
	pruefeRecht(locals, 'partner.verwalten');
	await darf(locals, 'auftraege', 'partner.verwalten');
	const n = locals.nutzer!;
	return { betriebId: n.betriebId!, benutzerId: n.id };
}

// ——— Eingaben ———

function prozent(w: unknown, was: string): number | null {
	if (w === undefined || w === null || w === '') return null;
	const n = typeof w === 'number' ? w : Number(String(w).trim().replace('%', '').replace(',', '.'));
	if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiFehler(400, `${was}: bitte eine Zahl von 0 bis 100.`);
	return Math.round(n * 100) / 100;
}
function tage(w: unknown): number | null {
	if (w === undefined || w === null || w === '') return null;
	const n = typeof w === 'number' ? w : Number(String(w).trim());
	if (!Number.isInteger(n) || n < 0 || n > 365) throw new ApiFehler(400, 'Zahlungsziel: bitte 0 bis 365 Tage.');
	return n;
}
const optUrl = (w: unknown) => (w === undefined || w === null || w === '' ? null : pruefeLinkUrl(w));

export type PartnerWerte = Omit<Partner, 'id' | 'kontakte' | 'nachweise'>;
export function pruefePartnerEingabe(e: Record<string, unknown>): PartnerWerte {
	if (!istPartnerArt(e.art)) throw new ApiFehler(400, 'Art: bitte Auftraggeber, Subunternehmer oder Lieferant wählen.');
	const name = textFeld(e.name, 'Name', 200);
	if (!name) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben.');
	const email = textFeld(e.email, 'E-Mail', 200);
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFehler(400, 'E-Mail: Bitte eine gültige Adresse eingeben.');
	return {
		art: e.art,
		name,
		nummer: textFeld(e.nummer, 'Kunden-/Lieferantennummer', 60),
		strasse: textFeld(e.strasse, 'Straße', 200),
		plz: textFeld(e.plz, 'PLZ', 20),
		ort: textFeld(e.ort, 'Ort', 200),
		telefon: textFeld(e.telefon, 'Telefon', 50),
		email,
		web: textFeld(e.web, 'Website', 300),
		portalUrl: optUrl(e.portalUrl),
		portalNotiz: textFeld(e.portalNotiz, 'Notiz zum Portal', 500),
		notizen: textFeld(e.notizen, 'Notizen', 5000),
		provisionProzent: prozent(e.provisionProzent, 'Provision'),
		rabattProzent: prozent(e.rabattProzent, 'Rabatt'),
		zahlungszielTage: tage(e.zahlungszielTage),
		aktiv: e.aktiv === undefined ? true : e.aktiv === true || e.aktiv === 'true' || e.aktiv === 'on'
	};
}

// ——— Lesen ———

const zahl = (w: unknown) => (w === null || w === undefined ? null : Number(w));

function warnungAus(nachweise: { art: string; gueltig_bis: string | null }[], heute: string): string | null {
	const ab = nachweise.filter((n) => nachweisStatus(n.gueltig_bis, heute) === 'abgelaufen');
	if (ab.length) return `abgelaufen: ${ab.map((n) => NACHWEIS_ART_NAMEN[n.art as NachweisArt] ?? n.art).join(', ')}`;
	const bald = nachweise.filter((n) => nachweisStatus(n.gueltig_bis, heute) === 'bald');
	if (bald.length) return `läuft bald ab: ${bald.map((n) => NACHWEIS_ART_NAMEN[n.art as NachweisArt] ?? n.art).join(', ')}`;
	return null;
}

export async function listePartner(k: Kontext, filter: { art?: unknown; suche?: unknown; mitInaktiven?: boolean } = {}, heute = berlinTag(new Date())): Promise<PartnerKurz[]> {
	const art = istPartnerArt(filter.art) ? filter.art : null;
	const suche = typeof filter.suche === 'string' && filter.suche.trim() ? `%${filter.suche.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select p.id, p.art, p.name, p.ort, p.aktiv,
				(select coalesce(json_agg(json_build_object('art', n.art, 'gueltig_bis', to_char(n.gueltig_bis, 'YYYY-MM-DD'))), '[]') from app.partner_nachweise n
					where n.partner_id = p.id and n.betrieb_id = p.betrieb_id) as nachweise,
				(select count(*) from app.auftraege a where a.auftraggeber_id = p.id and a.betrieb_id = p.betrieb_id)
					+ (select count(*) from app.auftrag_subunternehmer s where s.partner_id = p.id and s.betrieb_id = p.betrieb_id) as auftraege
			from app.partner p
			where p.betrieb_id = ${k.betriebId} ${art ? tx`and p.art = ${art}` : tx``} ${filter.mitInaktiven ? tx`` : tx`and p.aktiv`}
				${suche ? tx`and (p.name ilike ${suche} or p.ort ilike ${suche} or p.nummer ilike ${suche})` : tx``}
			order by p.aktiv desc, public.unaccent(lower(p.name)), p.id
			limit 500`;
		return z.map((r) => ({ id: r.id, art: r.art, name: r.name, ort: r.ort, aktiv: r.aktiv, warnung: warnungAus(r.nachweise, heute), auftraege: Number(r.auftraege) }));
	});
}

async function lade(tx: TransactionSql, k: Kontext, id: string, heute: string): Promise<Partner> {
	const [p] = await tx`select * from app.partner where id = ${id} and betrieb_id = ${k.betriebId}`;
	if (!p) throw nichtGefunden();
	const kontakte = await tx`select id, name, rolle, telefon, email from app.partner_kontakte where partner_id = ${id} and betrieb_id = ${k.betriebId} order by angelegt, id`;
	const nachweise = await tx`
		select id, art, bezeichnung, to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis, datei_name
		from app.partner_nachweise where partner_id = ${id} and betrieb_id = ${k.betriebId} order by gueltig_bis nulls last, angelegt`;
	return {
		id: p.id,
		art: p.art,
		name: p.name,
		nummer: p.nummer,
		strasse: p.strasse,
		plz: p.plz,
		ort: p.ort,
		telefon: p.telefon,
		email: p.email,
		web: p.web,
		portalUrl: p.portal_url,
		portalNotiz: p.portal_notiz,
		notizen: p.notizen,
		provisionProzent: zahl(p.provision_prozent),
		rabattProzent: zahl(p.rabatt_prozent),
		zahlungszielTage: p.zahlungsziel_tage,
		aktiv: p.aktiv,
		kontakte: kontakte.map((x) => ({ id: x.id, name: x.name, rolle: x.rolle, telefon: x.telefon, email: x.email })),
		nachweise: nachweise.map((n) => ({ id: n.id, art: n.art, bezeichnung: n.bezeichnung, gueltigBis: n.gueltig_bis, dateiName: n.datei_name, status: nachweisStatus(n.gueltig_bis, heute) }))
	};
}

export async function holePartner(k: Kontext, id: unknown, heute = berlinTag(new Date())): Promise<Partner> {
	const pid = pruefeId(id);
	return mitBetrieb(k, (tx) => lade(tx, k, pid, heute));
}

// ——— Schreiben ———

export async function legePartnerAn(k: Kontext, e: Record<string, unknown>): Promise<Partner> {
	const w = pruefePartnerEingabe(e);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			insert into app.partner (betrieb_id, art, name, nummer, strasse, plz, ort, telefon, email, web, portal_url, portal_notiz, notizen,
				provision_prozent, rabatt_prozent, zahlungsziel_tage, aktiv)
			values (${k.betriebId}, ${w.art}, ${w.name}, ${w.nummer}, ${w.strasse}, ${w.plz}, ${w.ort}, ${w.telefon}, ${w.email}, ${w.web},
				${w.portalUrl}, ${w.portalNotiz}, ${w.notizen}, ${w.provisionProzent}, ${w.rabattProzent}, ${w.zahlungszielTage}, ${w.aktiv})
			returning id`;
		return lade(tx, k, z.id, berlinTag(new Date()));
	});
}

export async function aenderePartner(k: Kontext, id: unknown, e: Record<string, unknown>): Promise<Partner> {
	const pid = pruefeId(id);
	const w = pruefePartnerEingabe(e);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			update app.partner set art = ${w.art}, name = ${w.name}, nummer = ${w.nummer}, strasse = ${w.strasse}, plz = ${w.plz}, ort = ${w.ort},
				telefon = ${w.telefon}, email = ${w.email}, web = ${w.web}, portal_url = ${w.portalUrl}, portal_notiz = ${w.portalNotiz},
				notizen = ${w.notizen}, provision_prozent = ${w.provisionProzent}, rabatt_prozent = ${w.rabattProzent},
				zahlungsziel_tage = ${w.zahlungszielTage}, aktiv = ${w.aktiv}
			where id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
		return lade(tx, k, pid, berlinTag(new Date()));
	});
}

/** Löschen; ist der Partner an Aufträgen, wird er nur deaktiviert (Aufträge und Kosten bleiben nachvollziehbar). */
export async function loeschePartner(k: Kontext, id: unknown): Promise<'geloescht' | 'deaktiviert'> {
	const pid = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [benutzt] = await tx`
			select 1 where exists (select 1 from app.auftraege where auftraggeber_id = ${pid} and betrieb_id = ${k.betriebId})
				or exists (select 1 from app.auftrag_subunternehmer where partner_id = ${pid} and betrieb_id = ${k.betriebId})
				or exists (select 1 from app.auftrag_fremdleistungen where partner_id = ${pid} and betrieb_id = ${k.betriebId})`;
		if (benutzt) {
			const z = await tx`update app.partner set aktiv = false where id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw nichtGefunden();
			return 'deaktiviert';
		}
		// offene Erinnerungs-Aufgaben der Nachweise mit weg
		await tx`delete from app.todos t using app.partner_nachweise n where n.partner_id = ${pid} and n.betrieb_id = ${k.betriebId} and t.id = n.todo_id and t.betrieb_id = n.betrieb_id and t.erledigt_am is null`;
		const z = await tx`delete from app.partner where id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
		return 'geloescht';
	});
}

export async function speichereKontakt(k: Kontext, partnerId: unknown, kontaktId: unknown, e: Record<string, unknown>): Promise<void> {
	const pid = pruefeId(partnerId);
	const name = textFeld(e.name, 'Name', 200);
	if (!name) throw new ApiFehler(400, 'Ansprechpartner: Bitte einen Namen eingeben.');
	const w = { name, rolle: textFeld(e.rolle, 'Rolle', 100), telefon: textFeld(e.telefon, 'Telefon', 50), email: textFeld(e.email, 'E-Mail', 200) };
	await mitBetrieb(k, async (tx) => {
		const [p] = await tx`select 1 from app.partner where id = ${pid} and betrieb_id = ${k.betriebId}`;
		if (!p) throw nichtGefunden();
		if (kontaktId === null || kontaktId === undefined || kontaktId === '') {
			const [{ n }] = await tx`select count(*)::int as n from app.partner_kontakte where partner_id = ${pid} and betrieb_id = ${k.betriebId}`;
			if (n >= 30) throw new ApiFehler(400, 'Höchstens 30 Ansprechpartner je Partner.');
			await tx`insert into app.partner_kontakte (betrieb_id, partner_id, name, rolle, telefon, email) values (${k.betriebId}, ${pid}, ${w.name}, ${w.rolle}, ${w.telefon}, ${w.email})`;
		} else {
			const kid = pruefeId(kontaktId, () => new ApiFehler(404, 'Ansprechpartner nicht gefunden.'));
			const z = await tx`update app.partner_kontakte set name = ${w.name}, rolle = ${w.rolle}, telefon = ${w.telefon}, email = ${w.email}
				where id = ${kid} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw new ApiFehler(404, 'Ansprechpartner nicht gefunden.');
		}
	});
}

export async function loescheKontakt(k: Kontext, partnerId: unknown, kontaktId: unknown): Promise<void> {
	const pid = pruefeId(partnerId);
	const kid = pruefeId(kontaktId, () => new ApiFehler(404, 'Ansprechpartner nicht gefunden.'));
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.partner_kontakte where id = ${kid} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Ansprechpartner nicht gefunden.');
	});
}

// ——— Nachweise ———

/** Dateityp an den ersten Bytes erkennen (nie dem Browser glauben): PDF, JPEG oder PNG – sonst 400. */
export function nachweisDateityp(b: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' {
	if (b.byteLength > NACHWEIS_MAX_BYTES) throw new ApiFehler(400, 'Die Datei ist zu groß (höchstens 10 MB).');
	if (b.byteLength >= 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-') return 'application/pdf';
	const bild = pruefeBild(b);
	if (bild) return bild.typ;
	throw new ApiFehler(400, 'Bitte ein PDF oder ein Foto (JPEG/PNG) hochladen.');
}

/** Erinnerungs-Aufgabe für einen Nachweis (alte offene wird ersetzt): fällig 30 Tage vor Ablauf, Glocke für alle Verwalter. */
async function erinnerungFuer(tx: TransactionSql, k: Kontext, nachweisId: string, partner: { id: string; name: string }, art: NachweisArt, gueltigBis: string | null, heute: string): Promise<void> {
	const [alt] = await tx`select todo_id from app.partner_nachweise where id = ${nachweisId} and betrieb_id = ${k.betriebId}`;
	if (alt?.todo_id) await tx`delete from app.todos where id = ${alt.todo_id} and betrieb_id = ${k.betriebId} and erledigt_am is null`;
	await tx`update app.partner_nachweise set todo_id = null where id = ${nachweisId} and betrieb_id = ${k.betriebId}`;
	if (!gueltigBis) return;
	const verwalter = await tx`
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = ${k.betriebId} and b.aktiv and 'partner.verwalten' = any (r.rechte)
		order by ('einstellungen' = any (r.rechte)) desc, b.name, b.id`;
	const faellig = [tagPlus(gueltigBis, -ERINNERN_TAGE), heute].sort().at(-1)!;
	const titel = `Nachweis erneuern: ${NACHWEIS_ART_NAMEN[art]} – ${partner.name}`.slice(0, 200);
	const [t] = await tx`
		insert into app.todos (betrieb_id, titel, beschreibung, zustaendig_id, faellig)
		values (${k.betriebId}, ${titel}, ${`Gültig bis ${tagDeutsch(gueltigBis)}. Neuen Nachweis beim Partner anfordern und unter Partner hochladen.`},
			${verwalter[0]?.id ?? null}, ${faellig})
		returning id`;
	await tx`update app.partner_nachweise set todo_id = ${t.id} where id = ${nachweisId} and betrieb_id = ${k.betriebId}`;
	const um = berlinZeitpunkt(faellig, 8, 0);
	for (const v of verwalter) {
		await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
			values (${k.betriebId}, ${v.id}, ${t.id}, ${um}, ${titel}, ${`läuft am ${tagDeutsch(gueltigBis)} ab`}, ${`/partner/${partner.id}`})`;
	}
}

export type NachweisEingabe = { art?: unknown; bezeichnung?: unknown; gueltigBis?: unknown; datei?: { name: string; inhalt: Uint8Array } | null };

/** Nachweis anlegen (nachweisId leer) oder ändern; Datei optional (beim Ändern bleibt die alte ohne neue). */
export async function speichereNachweis(k: Kontext, partnerId: unknown, nachweisId: unknown, e: NachweisEingabe, heute = berlinTag(new Date())): Promise<string> {
	const pid = pruefeId(partnerId);
	if (typeof e.art !== 'string' || !(NACHWEIS_ARTEN as readonly string[]).includes(e.art)) throw new ApiFehler(400, 'Art des Nachweises: ungültige Auswahl.');
	const art = e.art as NachweisArt;
	const gueltigBis = e.gueltigBis === undefined || e.gueltigBis === null || e.gueltigBis === '' ? null : e.gueltigBis;
	if (gueltigBis !== null && !istTag(gueltigBis)) throw new ApiFehler(400, 'Gültig bis: bitte ein Datum wählen.');
	const bezeichnung = textFeld(e.bezeichnung, 'Bezeichnung', 200);
	const datei = e.datei && e.datei.inhalt.byteLength > 0 ? { name: (textFeld(e.datei.name, 'Dateiname', 200) ?? 'Nachweis').replace(/[\\/]/g, '_'), typ: nachweisDateityp(e.datei.inhalt), inhalt: e.datei.inhalt } : null;
	return mitBetrieb(k, async (tx) => {
		const [p] = await tx`select id, name from app.partner where id = ${pid} and betrieb_id = ${k.betriebId}`;
		if (!p) throw nichtGefunden();
		let id: string;
		if (nachweisId === null || nachweisId === undefined || nachweisId === '') {
			const [{ n }] = await tx`select count(*)::int as n from app.partner_nachweise where partner_id = ${pid} and betrieb_id = ${k.betriebId}`;
			if (n >= 50) throw new ApiFehler(400, 'Höchstens 50 Nachweise je Partner.');
			const [z] = await tx`
				insert into app.partner_nachweise (betrieb_id, partner_id, art, bezeichnung, gueltig_bis, datei_name, datei_typ, groesse, inhalt)
				values (${k.betriebId}, ${pid}, ${art}, ${bezeichnung}, ${gueltigBis}, ${datei?.name ?? null}, ${datei?.typ ?? null},
					${datei?.inhalt.byteLength ?? null}, ${datei ? Buffer.from(datei.inhalt) : null})
				returning id`;
			id = z.id;
		} else {
			id = pruefeId(nachweisId, () => new ApiFehler(404, 'Nachweis nicht gefunden.'));
			const z = datei
				? await tx`update app.partner_nachweise set art = ${art}, bezeichnung = ${bezeichnung}, gueltig_bis = ${gueltigBis},
						datei_name = ${datei.name}, datei_typ = ${datei.typ}, groesse = ${datei.inhalt.byteLength}, inhalt = ${Buffer.from(datei.inhalt)}
					where id = ${id} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning id`
				: await tx`update app.partner_nachweise set art = ${art}, bezeichnung = ${bezeichnung}, gueltig_bis = ${gueltigBis}
					where id = ${id} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw new ApiFehler(404, 'Nachweis nicht gefunden.');
		}
		await erinnerungFuer(tx, k, id, { id: p.id, name: p.name }, art, gueltigBis, heute);
		return id;
	});
}

export async function loescheNachweis(k: Kontext, partnerId: unknown, nachweisId: unknown): Promise<void> {
	const pid = pruefeId(partnerId);
	const nid = pruefeId(nachweisId, () => new ApiFehler(404, 'Nachweis nicht gefunden.'));
	await mitBetrieb(k, async (tx) => {
		const [n] = await tx`delete from app.partner_nachweise where id = ${nid} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning todo_id`;
		if (!n) throw new ApiFehler(404, 'Nachweis nicht gefunden.');
		if (n.todo_id) await tx`delete from app.todos where id = ${n.todo_id} and betrieb_id = ${k.betriebId} and erledigt_am is null`;
	});
}

export async function holeNachweisDatei(k: Kontext, partnerId: unknown, nachweisId: unknown): Promise<{ name: string; typ: string; inhalt: Uint8Array }> {
	const pid = pruefeId(partnerId);
	const nid = pruefeId(nachweisId, () => new ApiFehler(404, 'Nachweis nicht gefunden.'));
	const [z] = await mitBetrieb(k, (tx) => tx`select datei_name, datei_typ, inhalt from app.partner_nachweise where id = ${nid} and partner_id = ${pid} and betrieb_id = ${k.betriebId}`);
	if (!z || !z.inhalt) throw new ApiFehler(404, 'Datei nicht gefunden.');
	return { name: z.datei_name, typ: z.datei_typ, inhalt: z.inhalt as Uint8Array };
}

// ——— Auswertung je Partner ———

export type PartnerAuswertung = {
	auftraegeAlsAuftraggeber: number;
	auftraegeAlsSubunternehmer: number;
	/** angenommene Angebote (netto) der Aufträge dieses Auftraggebers; null ohne Preise */
	umsatzCent: number | null;
	provisionCent: number | null;
	fremdleistungCent: number | null;
};

export async function partnerAuswertung(k: Kontext, partnerId: unknown, preise: boolean): Promise<PartnerAuswertung> {
	const pid = pruefeId(partnerId);
	return mitBetrieb(k, async (tx) => {
		const [p] = await tx`select provision_prozent from app.partner where id = ${pid} and betrieb_id = ${k.betriebId}`;
		if (!p) throw nichtGefunden();
		const [z] = await tx`
			select
				(select count(*) from app.auftraege a where a.auftraggeber_id = ${pid} and a.betrieb_id = ${k.betriebId})::int as ag,
				(select count(*) from app.auftrag_subunternehmer s where s.partner_id = ${pid} and s.betrieb_id = ${k.betriebId})::int as su,
				(select coalesce(sum(round(pos.menge * pos.einzelpreis_cent)), 0) from app.angebot_positionen pos
					join app.angebote an on an.id = pos.angebot_id and an.betrieb_id = pos.betrieb_id
					join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
					where a.auftraggeber_id = ${pid} and a.betrieb_id = ${k.betriebId} and an.status = 'angenommen')::bigint as umsatz,
				(select coalesce(sum(betrag_cent), 0) from app.auftrag_fremdleistungen f where f.partner_id = ${pid} and f.betrieb_id = ${k.betriebId})::bigint as fremd`;
		const umsatz = Number(z.umsatz);
		return {
			auftraegeAlsAuftraggeber: z.ag,
			auftraegeAlsSubunternehmer: z.su,
			umsatzCent: preise ? umsatz : null,
			provisionCent: preise && p.provision_prozent !== null ? Math.round((umsatz * Number(p.provision_prozent)) / 100) : null,
			fremdleistungCent: preise ? Number(z.fremd) : null
		};
	});
}

// ——— Am Auftrag ———

export type AuftragPartner = {
	auftraggeber: { id: string; name: string } | null;
	subunternehmer: { id: string; name: string; leistung: string | null; warnung: string | null }[];
	/** null ohne „Preise sehen“ */
	fremdleistungen: { id: string; bezeichnung: string; betragCent: number; partnerName: string | null; rechnungsnummer: string | null; datum: string | null }[] | null;
	summeFremdCent: number | null;
};

async function auftragPruefen(tx: TransactionSql, k: Kontext, sicht: Sicht, auftragId: unknown): Promise<string> {
	const aid = pruefeId(auftragId, () => new ApiFehler(404, 'Auftrag nicht gefunden.'));
	const [a] = await tx`select 1 from app.auftraege a where a.id = ${aid} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}`;
	if (!a) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	return aid;
}

export async function auftragPartner(k: Kontext, sicht: Sicht, auftragId: string, preise: boolean, heute = berlinTag(new Date())): Promise<AuftragPartner> {
	return mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		const [ag] = await tx`select p.id, p.name from app.auftraege a join app.partner p on p.id = a.auftraggeber_id and p.betrieb_id = a.betrieb_id where a.id = ${aid} and a.betrieb_id = ${k.betriebId}`;
		const su = await tx`
			select p.id, p.name, s.leistung,
				(select coalesce(json_agg(json_build_object('art', n.art, 'gueltig_bis', to_char(n.gueltig_bis, 'YYYY-MM-DD'))), '[]') from app.partner_nachweise n
					where n.partner_id = p.id and n.betrieb_id = p.betrieb_id) as nachweise
			from app.auftrag_subunternehmer s join app.partner p on p.id = s.partner_id and p.betrieb_id = s.betrieb_id
			where s.auftrag_id = ${aid} and s.betrieb_id = ${k.betriebId} order by s.angelegt`;
		let fremd: AuftragPartner['fremdleistungen'] = null;
		if (preise) {
			const f = await tx`
				select f.id, f.bezeichnung, f.betrag_cent, p.name as partner_name, f.rechnungsnummer, to_char(f.datum, 'YYYY-MM-DD') as datum
				from app.auftrag_fremdleistungen f left join app.partner p on p.id = f.partner_id and p.betrieb_id = f.betrieb_id
				where f.auftrag_id = ${aid} and f.betrieb_id = ${k.betriebId} order by f.datum nulls last, f.angelegt`;
			fremd = f.map((r) => ({ id: r.id, bezeichnung: r.bezeichnung, betragCent: Number(r.betrag_cent), partnerName: r.partner_name, rechnungsnummer: r.rechnungsnummer, datum: r.datum }));
		}
		return {
			auftraggeber: ag ? { id: ag.id, name: ag.name } : null,
			subunternehmer: su.map((r) => ({ id: r.id, name: r.name, leistung: r.leistung, warnung: warnungAus(r.nachweise, heute) })),
			fremdleistungen: fremd,
			summeFremdCent: fremd ? fremd.reduce((s, x) => s + x.betragCent, 0) : null
		};
	});
}

/** Partner zur Auswahl am Auftrag (nur aktive, nur Name/Art/Warnung – keine Konditionen). */
export async function partnerAuswahl(k: Kontext, heute = berlinTag(new Date())): Promise<{ id: string; name: string; art: PartnerArt; warnung: string | null }[]> {
	return (await listePartner(k, {}, heute)).map((p) => ({ id: p.id, name: p.name, art: p.art, warnung: p.warnung }));
}

async function partnerDerArt(tx: TransactionSql, k: Kontext, partnerId: unknown, art: PartnerArt): Promise<{ id: string; name: string }> {
	const pid = pruefeId(partnerId, () => new ApiFehler(400, 'Bitte einen Partner wählen.'));
	const [p] = await tx`select id, name, art, aktiv from app.partner where id = ${pid} and betrieb_id = ${k.betriebId}`;
	if (!p || !p.aktiv) throw new ApiFehler(400, 'Bitte einen (aktiven) Partner wählen.');
	if (p.art !== art) throw new ApiFehler(400, `„${p.name}“ ist kein ${PARTNER_ART_NAMEN[art]}.`);
	return { id: p.id, name: p.name };
}

export async function setzeAuftraggeber(k: Kontext, sicht: Sicht, auftragId: unknown, partnerId: unknown): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		const p = partnerId === null || partnerId === undefined || partnerId === '' ? null : await partnerDerArt(tx, k, partnerId, 'auftraggeber');
		await tx`update app.auftraege set auftraggeber_id = ${p?.id ?? null} where id = ${aid} and betrieb_id = ${k.betriebId}`;
	});
}

/** Subunternehmer an den Auftrag; liefert Warnungen (abgelaufene/bald ablaufende Nachweise) für die Oberfläche. */
export async function fuegeSubunternehmerHinzu(k: Kontext, sicht: Sicht, auftragId: unknown, partnerId: unknown, leistung: unknown, heute = berlinTag(new Date())): Promise<string | null> {
	return mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		const p = await partnerDerArt(tx, k, partnerId, 'subunternehmer');
		const l = textFeld(leistung, 'Leistung', 300);
		const z = await tx`insert into app.auftrag_subunternehmer (betrieb_id, auftrag_id, partner_id, leistung) values (${k.betriebId}, ${aid}, ${p.id}, ${l})
			on conflict (auftrag_id, partner_id) do update set leistung = excluded.leistung returning partner_id`;
		if (z.length === 0) throw new ApiFehler(409, 'Schon zugeordnet.');
		const nachweise = await tx`select art, to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis from app.partner_nachweise where partner_id = ${p.id} and betrieb_id = ${k.betriebId}`;
		const w = warnungAus(nachweise as never, heute);
		return w ? `${p.name}: Nachweis ${w}` : null;
	});
}

export async function entferneSubunternehmer(k: Kontext, sicht: Sicht, auftragId: unknown, partnerId: unknown): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		const pid = pruefeId(partnerId, () => new ApiFehler(404, 'Nicht zugeordnet.'));
		const z = await tx`delete from app.auftrag_subunternehmer where auftrag_id = ${aid} and partner_id = ${pid} and betrieb_id = ${k.betriebId} returning partner_id`;
		if (z.length === 0) throw new ApiFehler(404, 'Nicht zugeordnet.');
	});
}

export async function legeFremdleistungAn(k: Kontext, sicht: Sicht, auftragId: unknown, e: Record<string, unknown>): Promise<void> {
	const bezeichnung = textFeld(e.bezeichnung, 'Bezeichnung', 200);
	if (!bezeichnung) throw new ApiFehler(400, 'Bezeichnung: Bitte angeben, z. B. „Elektro Subunternehmer“.');
	if (typeof e.betrag !== 'string' && typeof e.betrag !== 'number') throw new ApiFehler(400, 'Betrag: bitte einen Betrag in Euro (netto) eingeben.');
	let betrag: number;
	try {
		betrag = leseEuroInCent(e.betrag);
	} catch (f) {
		throw new ApiFehler(400, `Betrag: ${(f as Error).message}`);
	}
	const datum = e.datum === undefined || e.datum === null || e.datum === '' ? null : e.datum;
	if (datum !== null && !istTag(datum)) throw new ApiFehler(400, 'Datum: bitte ein Datum wählen.');
	await mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		let pid: string | null = null;
		if (e.partnerId !== undefined && e.partnerId !== null && e.partnerId !== '') {
			pid = pruefeId(e.partnerId, () => new ApiFehler(400, 'Partner: ungültige Auswahl.'));
			const [p] = await tx`select 1 from app.partner where id = ${pid} and betrieb_id = ${k.betriebId}`;
			if (!p) throw new ApiFehler(400, 'Partner: ungültige Auswahl.');
		}
		const [{ n }] = await tx`select count(*)::int as n from app.auftrag_fremdleistungen where auftrag_id = ${aid} and betrieb_id = ${k.betriebId}`;
		if (n >= 100) throw new ApiFehler(400, 'Höchstens 100 Fremdleistungen je Auftrag.');
		await tx`
			insert into app.auftrag_fremdleistungen (betrieb_id, auftrag_id, partner_id, bezeichnung, betrag_cent, rechnungsnummer, datum)
			values (${k.betriebId}, ${aid}, ${pid}, ${bezeichnung}, ${betrag}, ${textFeld(e.rechnungsnummer, 'Rechnungsnummer', 60)}, ${datum})`;
	});
}

export async function loescheFremdleistung(k: Kontext, sicht: Sicht, auftragId: unknown, id: unknown): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		const aid = await auftragPruefen(tx, k, sicht, auftragId);
		const fid = pruefeId(id, () => new ApiFehler(404, 'Fremdleistung nicht gefunden.'));
		const z = await tx`delete from app.auftrag_fremdleistungen where id = ${fid} and auftrag_id = ${aid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Fremdleistung nicht gefunden.');
	});
}

/** Auftragsquelle → Auftraggeber-Partner (Einstellungen → Auftragsquellen). */
export async function setzeQuellenPartner(k: Kontext, quelleId: unknown, partnerId: unknown): Promise<void> {
	const qid = pruefeId(quelleId, () => new ApiFehler(404, 'Auftragsquelle nicht gefunden.'));
	await mitBetrieb(k, async (tx) => {
		const p = partnerId === null || partnerId === undefined || partnerId === '' ? null : await partnerDerArt(tx, k, partnerId, 'auftraggeber');
		const z = await tx`update app.auftrag_quellen set partner_id = ${p?.id ?? null} where id = ${qid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Auftragsquelle nicht gefunden.');
	});
}

/** Aufträge eines Partners (als Auftraggeber oder Subunternehmer), nur sichtbare, neueste zuerst. */
export async function partnerAuftraege(k: Kontext, sicht: Sicht, partnerId: unknown): Promise<{ id: string; nummer: string; titel: string; status: string; rolle: 'Auftraggeber' | 'Subunternehmer' }[]> {
	const pid = pruefeId(partnerId);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select a.id, a.nummer, a.titel, a.status, case when a.auftraggeber_id = ${pid} then 'Auftraggeber' else 'Subunternehmer' end as rolle
			from app.auftraege a
			where a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}
				and (a.auftraggeber_id = ${pid} or exists (select 1 from app.auftrag_subunternehmer s where s.auftrag_id = a.id and s.betrieb_id = a.betrieb_id and s.partner_id = ${pid}))
			order by a.angelegt desc limit 100`;
		return z.map((r) => ({ id: r.id, nummer: r.nummer, titel: r.titel, status: r.status, rolle: r.rolle }));
	});
}

/** Auftragsquelle → Auftraggeber-Partner (für die Einstellungen). */
export async function quellenPartner(k: Kontext): Promise<Record<string, string>> {
	const z = await mitBetrieb(k, (tx) => tx`select id, partner_id from app.auftrag_quellen where betrieb_id = ${k.betriebId} and partner_id is not null`);
	return Object.fromEntries(z.map((r) => [r.id as string, r.partner_id as string]));
}
