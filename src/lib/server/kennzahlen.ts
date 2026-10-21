/**
 * Kennzahlen – gemeinsames Server-Modul für das Cockpit (Auswertungen → Kennzahlen, Jamil msg 2858) und die
 * Übersichts-Kacheln auf Kunden, Aufträgen, Angeboten und der Startseite (msgs 2799, 2801, 2803).
 *
 * Aufbau: Die Datenbank liefert „Fakten“ (je Angebot/Auftrag die nötigen Zeitpunkte und Beträge, nur in der Sicht des
 * Nutzers); gerechnet wird in reinen Funktionen (`rechne*`), die ohne Datenbank testbar sind. Regeln:
 * - Zeitpunkte von Statuswechseln (angenommen, abgelehnt, abgenommen) aus dem Verlauf (`app.aenderungen`), sonst
 *   „geändert“.
 * - Ersetzte Angebote (es gibt eine neuere Fassung mit `vorgaenger_id`) zählen nicht – sonst drückt jede Überarbeitung
 *   die Quote.
 * - „Abgelaufen“ = versendet, ohne Entscheidung und Gültigkeit vorbei (es gibt keinen eigenen Status).
 * - Beträge in Cent, netto (Summe der Positionen, kaufmännisch gerundet); nur mit „Preise sehen“, sonst null.
 * - Fehlt die Grundlage, steht `fehlt: 'Daten fehlen: …'` statt 0.
 *
 * Nutzung für Kacheln (UX-Seiten): `kundenKennzahlen`, `auftragsKennzahlen`, `angebotsKennzahlen` mit der Sicht des
 * Nutzers (`auftragsSicht(locals)`), dem Zeitraum (`zeitraum(art, heute)` aus `$lib/kennzahlen`) und `preise`.
 */
import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { angebotSichtbar } from './angebote';
import { NACHFASSEN_FAELLIG_SQL, sichtbar, type Sicht } from './auftraege';
import { planIstMinuten } from './nachkalkulation';
import { hatRecht, pruefeRecht } from './rechte';
import { darf } from './tarif';
import { berlinTag, tagesGrenzen } from '../zeit';
import { summiere } from '../zeiterfassung';
import {
	aufgabenZeiten,
	baueKennzahl,
	MS_TAG,
	quote,
	schnitt,
	KENNZAHL_IDS,
	type AufgabenZeiten,
	type Kennzahl,
	type KennzahlId,
	type KennzahlWert,
	type Spanne,
	type Zeitraum,
	abTag,
	istAktiv,
	istKonfigId,
	KONFIG_KENNZAHLEN,
	seit,
	seitText,
	STANDARD_EINSTELLUNG,
	type KennzahlEinstellung,
	type KennzahlEinstellungen
} from '../kennzahlen';
import { istTag } from '../zeit';
import type { AuftragStatus } from '../auftrag-status';

// ——— Fakten ———

export type AngebotFakt = {
	id: string;
	status: 'entwurf' | 'versendet' | 'angenommen' | 'abgelehnt';
	kundeId: string | null;
	auftragId: string | null;
	angelegt: Date;
	/** Versand (bzw. Angebotsdatum, wenn ohne Versand entschieden); null bei Entwürfen. */
	abgegebenAm: Date | null;
	gueltigBis: string;
	angenommenAm: Date | null;
	abgelehntAm: Date | null;
	ersetzt: boolean;
	nettoCent: number;
};

export type AuftragFakt = {
	id: string;
	status: AuftragStatus;
	kundeId: string | null;
	quelleId: string | null;
	angelegt: Date;
	/** Erster Wechsel nach „abgenommen“ (oder direkt „abgerechnet“). */
	abgenommenAm: Date | null;
	/** Berliner Tag des letzten geplanten Einsatzes (Plantafel). */
	geplantesEnde: string | null;
	/** Erster Versand eines Angebots zu diesem Auftrag. */
	ersterAngebotsVersand: Date | null;
	nachfassenFaellig: boolean;
};

/** Grenzen eines Zeitraums als Zeitpunkte (von einschließlich, bis ausschließlich); „alle“ = unbegrenzt. */
export type Grenzen = { ab: number; bis: number };
export const grenzenVon = (s: Spanne | null): Grenzen =>
	s ? { ab: tagesGrenzen(s.von).beginn.getTime(), bis: tagesGrenzen(s.bis).beginn.getTime() } : { ab: -Infinity, bis: Infinity };
const drin = (d: Date | null, g: Grenzen) => d !== null && d.getTime() >= g.ab && d.getTime() < g.bis;
const tagDrin = (tag: string, s: Spanne | null) => !s || (tag >= s.von && tag < s.bis);

const statusZeit = (tabelle: 'angebote' | 'auftraege', alias: string, status: string[]) => `(select min(e.zeit) from app.aenderungen e
	where e.betrieb_id = ${alias}.betrieb_id and e.tabelle = '${tabelle}' and e.datensatz_id = ${alias}.id
		and e.nachher->>'status' in (${status.map((s) => `'${s}'`).join(', ')})
		and (e.vorher->>'status') is distinct from (e.nachher->>'status'))`;

/** Welche der genannten Kennzahlen aus sind und seit wann die übrigen erfasst werden (für Kacheln). */
export type KonfigInfo = { aus: string[]; seit: Record<string, string> };
function konfigInfo(e: KennzahlEinstellungen | undefined, ids: readonly string[]): KonfigInfo {
	const seitMap: Record<string, string> = {};
	for (const id of ids) {
		const t = seitText(e, id);
		if (t && istAktiv(e, id)) seitMap[id] = t;
	}
	return { aus: ids.filter((id) => !istAktiv(e, id)), seit: seitMap };
}
const angelegtAn = (x: { angelegt: Date }) => x.angelegt;

async function ladeAngebote(tx: TransactionSql, k: Kontext, sicht: Sicht): Promise<AngebotFakt[]> {
	const z = await tx`
		select an.id, an.status, coalesce(an.kunde_id, a.kunde_id) as kunde_id, an.auftrag_id, an.angelegt,
			case when an.status = 'entwurf' then null
				else coalesce(an.versendet_am, (an.datum::timestamp at time zone 'Europe/Berlin')) end as abgegeben_am,
			to_char(an.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
			case when an.status = 'angenommen' then coalesce(${tx.unsafe(statusZeit('angebote', 'an', ['angenommen']))}, an.geaendert) end as angenommen_am,
			case when an.status = 'abgelehnt' then coalesce(${tx.unsafe(statusZeit('angebote', 'an', ['abgelehnt']))}, an.geaendert) end as abgelehnt_am,
			exists (select 1 from app.angebote n where n.vorgaenger_id = an.id and n.betrieb_id = an.betrieb_id) as ersetzt,
			(select coalesce(sum(round(p.menge * p.einzelpreis_cent)), 0) from app.angebot_positionen p
				where p.angebot_id = an.id and p.betrieb_id = an.betrieb_id)::bigint as netto_cent
		from app.angebote an
		left join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		where an.betrieb_id = ${k.betriebId} and ${angebotSichtbar(tx, sicht)}`;
	return z.map((r) => ({
		id: r.id,
		status: r.status,
		kundeId: r.kunde_id,
		auftragId: r.auftrag_id,
		angelegt: new Date(r.angelegt),
		abgegebenAm: r.abgegeben_am ? new Date(r.abgegeben_am) : null,
		gueltigBis: r.gueltig_bis,
		angenommenAm: r.angenommen_am ? new Date(r.angenommen_am) : null,
		abgelehntAm: r.abgelehnt_am ? new Date(r.abgelehnt_am) : null,
		ersetzt: r.ersetzt,
		nettoCent: Number(r.netto_cent)
	}));
}

async function ladeAuftraege(tx: TransactionSql, k: Kontext, sicht: Sicht): Promise<AuftragFakt[]> {
	const z = await tx`
		select a.id, a.status, a.kunde_id, a.quelle_id, a.angelegt,
			case when a.status in ('abgenommen', 'abgerechnet')
				then coalesce(${tx.unsafe(statusZeit('auftraege', 'a', ['abgenommen', 'abgerechnet']))}, a.geaendert) end as abgenommen_am,
			(select to_char(max(e.ende) at time zone 'Europe/Berlin', 'YYYY-MM-DD') from app.einsaetze e
				where e.auftrag_id = a.id and e.betrieb_id = a.betrieb_id) as geplantes_ende,
			(select min(an.versendet_am) from app.angebote an
				where an.auftrag_id = a.id and an.betrieb_id = a.betrieb_id and an.versendet_am is not null) as erster_versand,
			${tx.unsafe(NACHFASSEN_FAELLIG_SQL)} as nachfassen_faellig
		from app.auftraege a
		where a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}`;
	return z.map((r) => ({
		id: r.id,
		status: r.status,
		kundeId: r.kunde_id,
		quelleId: r.quelle_id,
		angelegt: new Date(r.angelegt),
		abgenommenAm: r.abgenommen_am ? new Date(r.abgenommen_am) : null,
		geplantesEnde: r.geplantes_ende,
		ersterAngebotsVersand: r.erster_versand ? new Date(r.erster_versand) : null,
		nachfassenFaellig: r.nachfassen_faellig
	}));
}

// ——— Reine Rechnungen ———

const gezaehlt = (a: AngebotFakt) => !a.ersetzt;
export const istAbgelaufen = (a: AngebotFakt, heute: string) => a.status === 'versendet' && a.gueltigBis < heute;

/** Abschlussquote: von den im Zeitraum abgegebenen (nicht ersetzten) Angeboten die angenommenen. */
export function rechneAbschlussquote(angebote: readonly AngebotFakt[], g: Grenzen): KennzahlWert {
	const abgegeben = angebote.filter((a) => gezaehlt(a) && drin(a.abgegebenAm, g));
	const angenommen = abgegeben.filter((a) => a.status === 'angenommen').length;
	const offen = abgegeben.filter((a) => a.status === 'versendet').length;
	return {
		wert: quote(angenommen, abgegeben.length),
		zaehler: angenommen,
		nenner: abgegeben.length,
		fehlt: abgegeben.length ? null : 'Daten fehlen: keine abgegebenen Angebote im Zeitraum',
		hinweis: offen ? `${offen} davon noch ohne Entscheidung` : null
	};
}

/** Durchlaufzeit: Ø Tage vom Anlegen des Auftrags (Anfrage) bis zum ersten Angebotsversand – Versand im Zeitraum. */
export function rechneDurchlaufzeit(auftraege: readonly AuftragFakt[], g: Grenzen): KennzahlWert {
	const tage = auftraege
		.filter((a) => drin(a.ersterAngebotsVersand, g))
		.map((a) => Math.max(0, (a.ersterAngebotsVersand!.getTime() - a.angelegt.getTime()) / MS_TAG));
	const w = schnitt(tage);
	return { wert: w === null ? null : Math.round(w * 10) / 10, nenner: tage.length, fehlt: tage.length ? null : 'Daten fehlen: im Zeitraum wurde kein Angebot versendet' };
}

/** Termintreue: im Zeitraum abgenommene Aufträge mit geplanten Einsätzen – abgenommen spätestens am Tag des letzten Einsatzes. */
export function rechneTermintreue(auftraege: readonly AuftragFakt[], g: Grenzen): KennzahlWert {
	const fertig = auftraege.filter((a) => drin(a.abgenommenAm, g));
	const geplant = fertig.filter((a) => a.geplantesEnde !== null);
	const puenktlich = geplant.filter((a) => berlinTag(a.abgenommenAm!) <= a.geplantesEnde!).length;
	const ohne = fertig.length - geplant.length;
	return {
		wert: quote(puenktlich, geplant.length),
		zaehler: puenktlich,
		nenner: geplant.length,
		fehlt: geplant.length ? null : 'Daten fehlen: keine im Zeitraum abgenommenen Aufträge mit geplanten Einsätzen',
		hinweis: ohne ? `${ohne} abgenommene Aufträge ohne geplante Einsätze nicht gezählt` : null
	};
}

/** Produktivität: Summe Ist-Minuten / Summe kalkulierte Minuten der im Zeitraum abgenommenen Aufträge (mit Kalkulation). */
export function rechneProduktivitaet(auftraege: readonly AuftragFakt[], minuten: ReadonlyMap<string, { planMin: number; istMin: number }>, g: Grenzen): KennzahlWert {
	const mit = auftraege.filter((a) => drin(a.abgenommenAm, g)).map((a) => minuten.get(a.id)).filter((m): m is { planMin: number; istMin: number } => !!m && m.planMin > 0 && m.istMin > 0);
	const plan = mit.reduce((s, m) => s + m.planMin, 0);
	const ist = mit.reduce((s, m) => s + m.istMin, 0);
	return {
		wert: quote(ist, plan),
		zaehler: Math.round(ist / 60),
		nenner: Math.round(plan / 60),
		fehlt: mit.length ? null : 'Daten fehlen: keine abgenommenen Aufträge mit kalkulierten Stunden und erfasster Zeit im Zeitraum'
	};
}

/** Nacharbeitsquote aus Minuten (je Person vorher vereinigt). */
export function rechneNacharbeit(gesamtMin: number, nacharbeitMin: number, jeMarkiert: boolean): KennzahlWert {
	return {
		wert: quote(nacharbeitMin, gesamtMin),
		zaehler: Math.round(nacharbeitMin / 60),
		nenner: Math.round(gesamtMin / 60),
		fehlt: gesamtMin > 0 ? null : 'Daten fehlen: keine erfasste Arbeitszeit im Zeitraum',
		hinweis: jeMarkiert ? null : 'Noch keine Zeit als „Nacharbeit“ markiert (Häkchen in der Zeiterfassung).'
	};
}

/** Umsatz pro Mitarbeiter: netto der im Zeitraum angenommenen Angebote / Mitarbeiter laut Kalkulation (Cent). */
export function rechneUmsatzProMitarbeiter(angebote: readonly AngebotFakt[], mitarbeiter: number, g: Grenzen, preise: boolean): KennzahlWert {
	if (!preise) return { wert: null, fehlt: 'Nur mit dem Recht „Preise sehen“' };
	if (mitarbeiter <= 0) return { wert: null, fehlt: 'Daten fehlen: keine Mitarbeiter in der Kalkulation eingetragen' };
	const umsatz = angebote.filter((a) => gezaehlt(a) && a.status === 'angenommen' && drin(a.angenommenAm, g)).reduce((s, a) => s + a.nettoCent, 0);
	return { wert: Math.round(umsatz / mitarbeiter), zaehler: umsatz, nenner: mitarbeiter, fehlt: null, hinweis: 'Grundlage: angenommene Angebote (netto), bis Rechnungen vorliegen' };
}

export const ZAHLUNGSDAUER_FEHLT: KennzahlWert = { wert: null, fehlt: 'Daten fehlen – kommt mit der Lexware-Anbindung (Rechnungs- und Zahlungsdaten)' };

// ——— Kacheln: Kunden (msg 2799) ———

export const KUNDEN_IDS = ['kunden_aktiv', 'kunden_angenommen', 'kunden_abgelehnt', 'kunden_abgelaufen'] as const;
export type KundenKennzahlen = KonfigInfo & {
	/** Kunden mit mindestens einem offenen Auftrag (nicht abgenommen/abgerechnet) – aktueller Stand. */
	kundenAktiv: number;
	/** Kunden mit im Zeitraum angenommenem / abgelehntem / abgelaufenem Angebot; null ohne Angebotsrechte. */
	kundenMitAngenommen: number | null;
	kundenMitAbgelehnt: number | null;
	kundenMitAbgelaufen: number | null;
};

export function rechneKunden(auftraege: readonly AuftragFakt[], angebote: readonly AngebotFakt[] | null, z: Zeitraum, heute: string, e?: KennzahlEinstellungen): KundenKennzahlen {
	const g = grenzenVon(z.spanne);
	const kunden = (l: readonly { kundeId: string | null }[]) => new Set(l.map((x) => x.kundeId).filter(Boolean)).size;
	// je Kennzahl nur Datensätze ab ihrem „Erfassen ab“; ausgeschaltete werden nicht gerechnet (0)
	const ag = (id: string) => seit(auftraege, abTag(e, id), angelegtAn);
	const an = (id: string) => seit(angebote ?? [], abTag(e, id), angelegtAn).filter(gezaehlt);
	const wenn = (id: string, f: () => number) => (istAktiv(e, id) ? f() : 0);
	const info = konfigInfo(e, KUNDEN_IDS);
	const aktiv = wenn('kunden_aktiv', () => kunden(ag('kunden_aktiv').filter((a) => a.status !== 'abgenommen' && a.status !== 'abgerechnet')));
	if (!angebote) return { ...info, kundenAktiv: aktiv, kundenMitAngenommen: null, kundenMitAbgelehnt: null, kundenMitAbgelaufen: null };
	return {
		...info,
		kundenAktiv: aktiv,
		kundenMitAngenommen: wenn('kunden_angenommen', () => kunden(an('kunden_angenommen').filter((a) => a.status === 'angenommen' && drin(a.angenommenAm, g)))),
		kundenMitAbgelehnt: wenn('kunden_abgelehnt', () => kunden(an('kunden_abgelehnt').filter((a) => a.status === 'abgelehnt' && drin(a.abgelehntAm, g)))),
		kundenMitAbgelaufen: wenn('kunden_abgelaufen', () => kunden(an('kunden_abgelaufen').filter((a) => istAbgelaufen(a, heute) && tagDrin(a.gueltigBis, z.spanne))))
	};
}

// ——— Kacheln: Aufträge (msg 2801) ———

export const AUFTRAG_IDS = ['auftraege_status', 'auftraege_nachfassen', 'auftraege_wert'] as const;
export type AuftragsKennzahlen = KonfigInfo & {
	/** Aufträge je Status (im Zeitraum angelegt; „Gesamt“ = alle). */
	jeStatus: Record<AuftragStatus, number>;
	/** Aufträge mit fälligem Nachfassen (aktueller Stand). */
	nachfassenFaellig: number;
	/** Auftragswert offen: angenommene Angebote von Aufträgen, die noch nicht abgerechnet sind (Cent); null ohne Preise. */
	wertOffenCent: number | null;
	/** Im Zeitraum neu angelegte Aufträge je Auftragsquelle (null = ohne Quelle). */
	neuJeQuelle: { quelleId: string | null; anzahl: number }[];
	/**
	 * Finanzpotenzial je Status (Jamil msg 3047, Cent netto wie alle Kacheln): Summe der Auftragswerte (`auftragsWert`)
	 * der im Zeitraum neuen Aufträge; null = kein Auftrag mit Wert („–“). Ganz null ohne Preise.
	 */
	wertJeStatusCent: Record<AuftragStatus, number | null> | null;
	/** Summe der offenen (versendeten) Angebote der Aufträge mit fälligem Nachfassen; null ohne Preise. */
	nachfassenWertCent: number | null;
};

/**
 * Wert eines Auftrags je nach Status (msg 3047), netto, ersetzte Angebotsfassungen zählen nicht:
 * - Anfrage: der neueste Angebotsentwurf (noch nichts versendet), sonst kein Wert
 * - Angebot: Summe der versendeten, offenen Angebote
 * - Beauftragt, In Arbeit, Abgenommen: Summe der angenommenen Angebote (= Wert der Auftragsbestätigung)
 * - Abgerechnet: Rechnungsbetrag gibt es erst mit Lexware – bis dahin der Auftragswert (angenommene Angebote)
 */
export function auftragsWert(status: AuftragStatus, angebote: readonly AngebotFakt[]): number | null {
	const da = angebote.filter(gezaehlt);
	const summe = (l: readonly AngebotFakt[]) => (l.length ? l.reduce((s, a) => s + a.nettoCent, 0) : null);
	if (status === 'anfrage') {
		const entwurf = da.filter((a) => a.status === 'entwurf').sort((x, y) => y.angelegt.getTime() - x.angelegt.getTime())[0];
		return entwurf ? entwurf.nettoCent : null;
	}
	if (status === 'angebot') return summe(da.filter((a) => a.status === 'versendet'));
	return summe(da.filter((a) => a.status === 'angenommen'));
}

export function rechneAuftraege(auftraege: readonly AuftragFakt[], angebote: readonly AngebotFakt[] | null, z: Zeitraum, e?: KennzahlEinstellungen): AuftragsKennzahlen {
	const g = grenzenVon(z.spanne);
	const jeStatus: Record<AuftragStatus, number> = { anfrage: 0, angebot: 0, beauftragt: 0, in_arbeit: 0, abgenommen: 0, abgerechnet: 0 };
	const quellen = new Map<string | null, number>();
	// Angebote je Auftrag (nur mit Preisen geladen)
	const jeAuftrag = new Map<string, AngebotFakt[]>();
	for (const an of angebote ?? []) if (an.auftragId) jeAuftrag.set(an.auftragId, [...(jeAuftrag.get(an.auftragId) ?? []), an]);
	const wertJeStatusCent: Record<AuftragStatus, number | null> | null = angebote
		? { anfrage: null, angebot: null, beauftragt: null, in_arbeit: null, abgenommen: null, abgerechnet: null }
		: null;
	if (istAktiv(e, 'auftraege_status')) {
		const neu = seit(auftraege, abTag(e, 'auftraege_status'), angelegtAn).filter((a) => drin(a.angelegt, g));
		for (const a of neu) jeStatus[a.status]++;
		for (const a of neu) quellen.set(a.quelleId, (quellen.get(a.quelleId) ?? 0) + 1);
		if (wertJeStatusCent) {
			for (const a of neu) {
				const w = auftragsWert(a.status, jeAuftrag.get(a.id) ?? []);
				if (w !== null) wertJeStatusCent[a.status] = (wertJeStatusCent[a.status] ?? 0) + w;
			}
		}
	}
	let nachfassenWertCent: number | null = null;
	if (angebote && istAktiv(e, 'auftraege_nachfassen')) {
		nachfassenWertCent = seit(auftraege, abTag(e, 'auftraege_nachfassen'), angelegtAn)
			.filter((a) => a.nachfassenFaellig)
			.reduce((s, a) => s + (jeAuftrag.get(a.id) ?? []).filter((an) => gezaehlt(an) && an.status === 'versendet').reduce((t, an) => t + an.nettoCent, 0), 0);
	}
	let wertOffenCent: number | null = null;
	if (angebote && istAktiv(e, 'auftraege_wert')) {
		const ab = abTag(e, 'auftraege_wert');
		const offeneAuftraege = new Set(seit(auftraege, ab, angelegtAn).filter((a) => a.status !== 'abgerechnet').map((a) => a.id));
		wertOffenCent = seit(angebote, ab, angelegtAn).filter((a) => gezaehlt(a) && a.status === 'angenommen' && a.auftragId && offeneAuftraege.has(a.auftragId)).reduce((s, a) => s + a.nettoCent, 0);
	}
	return {
		...konfigInfo(e, AUFTRAG_IDS),
		jeStatus,
		nachfassenFaellig: istAktiv(e, 'auftraege_nachfassen') ? seit(auftraege, abTag(e, 'auftraege_nachfassen'), angelegtAn).filter((a) => a.nachfassenFaellig).length : 0,
		wertOffenCent,
		neuJeQuelle: [...quellen].map(([quelleId, anzahl]) => ({ quelleId, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
		wertJeStatusCent,
		nachfassenWertCent
	};
}

// ——— Kacheln: Angebote (msg 2803) ———

export const ANGEBOT_IDS = ['angebote_entwurf', 'angebote_offen', 'angebote_angenommen', 'angebote_abgelehnt', 'angebote_abgelaufen', 'angebote_quote', 'angebote_schnitt', 'auftraege_nachfassen'] as const;
export type AngebotsKennzahlen = KonfigInfo & {
	/** Aktueller Stand (ohne Zeitraum): Entwürfe; versendet und noch gültig. */
	entwurf: number;
	offen: number;
	/** Im Zeitraum entschieden bzw. abgelaufen. */
	angenommen: number;
	abgelehnt: number;
	abgelaufen: number;
	/** Annahmequote = Abschlussquote (wie im Cockpit). */
	quote: KennzahlWert;
	/** Cent, nur mit Preisen: offen (aktuell), angenommen (Zeitraum), Ø Wert der im Zeitraum abgegebenen. */
	summeOffenCent: number | null;
	summeAngenommenCent: number | null;
	durchschnittCent: number | null;
	nachfassenFaellig: number;
};

export function rechneAngebote(angebote: readonly AngebotFakt[], auftraege: readonly AuftragFakt[], z: Zeitraum, heute: string, preise: boolean, e?: KennzahlEinstellungen): AngebotsKennzahlen {
	const g = grenzenVon(z.spanne);
	const l = (id: string) => (istAktiv(e, id) ? seit(angebote, abTag(e, id), angelegtAn).filter(gezaehlt) : []);
	const offen = l('angebote_offen').filter((a) => a.status === 'versendet' && a.gueltigBis >= heute);
	const angenommen = l('angebote_angenommen').filter((a) => a.status === 'angenommen' && drin(a.angenommenAm, g));
	const abgegeben = l('angebote_schnitt').filter((a) => drin(a.abgegebenAm, g));
	const summe = (x: readonly AngebotFakt[]) => x.reduce((s, a) => s + a.nettoCent, 0);
	const d = schnitt(abgegeben.map((a) => a.nettoCent));
	return {
		...konfigInfo(e, ANGEBOT_IDS),
		entwurf: l('angebote_entwurf').filter((a) => a.status === 'entwurf').length,
		offen: offen.length,
		angenommen: angenommen.length,
		abgelehnt: l('angebote_abgelehnt').filter((a) => a.status === 'abgelehnt' && drin(a.abgelehntAm, g)).length,
		abgelaufen: l('angebote_abgelaufen').filter((a) => istAbgelaufen(a, heute) && tagDrin(a.gueltigBis, z.spanne)).length,
		quote: istAktiv(e, 'angebote_quote') ? rechneAbschlussquote(seit(angebote, abTag(e, 'angebote_quote'), angelegtAn), g) : { wert: null, fehlt: 'ausgeschaltet' },
		summeOffenCent: preise ? summe(offen) : null,
		summeAngenommenCent: preise ? summe(angenommen) : null,
		durchschnittCent: preise && d !== null ? Math.round(d) : null,
		nachfassenFaellig: istAktiv(e, 'auftraege_nachfassen') ? seit(auftraege, abTag(e, 'auftraege_nachfassen'), angelegtAn).filter((a) => a.nachfassenFaellig).length : 0
	};
}

/** Auftragsbestätigung als Fakt (Ausgangsbelege, Jamil msg 2948). */
export type AbFakt = { angelegt: Date; versendetAm: Date | null; status: 'bereit' | 'gesendet' };
export const AB_IDS = ['ab_bereit', 'ab_versendet', 'ab_erstellt'] as const;
export type AbKennzahlen = KonfigInfo & {
	/** Aktueller Stand: erstellt, noch nicht versendet. */
	bereit: number;
	/** Im Zeitraum versendet bzw. erstellt. */
	versendet: number;
	erstellt: number;
};

export function rechneAuftragsbestaetigungen(abs: readonly AbFakt[], z: Zeitraum, e?: KennzahlEinstellungen): AbKennzahlen {
	const g = grenzenVon(z.spanne);
	const l = (id: string) => (istAktiv(e, id) ? seit(abs, abTag(e, id), angelegtAn) : []);
	return {
		...konfigInfo(e, AB_IDS),
		bereit: l('ab_bereit').filter((a) => a.status === 'bereit').length,
		versendet: l('ab_versendet').filter((a) => a.status === 'gesendet' && drin(a.versendetAm, g)).length,
		erstellt: l('ab_erstellt').filter((a) => drin(a.angelegt, g)).length
	};
}

// ——— Öffentliche Funktionen (Server) ———

export async function kundenKennzahlen(k: Kontext, sicht: Sicht, z: Zeitraum, opt: { angebote: boolean }, heute = berlinTag(new Date())): Promise<KundenKennzahlen> {
	return mitBetrieb(k, async (tx) => rechneKunden(await ladeAuftraege(tx, k, sicht), opt.angebote ? await ladeAngebote(tx, k, sicht) : null, z, heute, await ladeEinstellungen(tx, k)));
}

export async function auftragsKennzahlen(k: Kontext, sicht: Sicht, z: Zeitraum, preise: boolean): Promise<AuftragsKennzahlen> {
	return mitBetrieb(k, async (tx) => rechneAuftraege(await ladeAuftraege(tx, k, sicht), preise ? await ladeAngebote(tx, k, sicht) : null, z, await ladeEinstellungen(tx, k)));
}

/** Angebote sieht nur, wer `angebote.bearbeiten` + `preise.sehen` hat – `preise` steuert trotzdem die Beträge. */
export async function angebotsKennzahlen(k: Kontext, sicht: Sicht, z: Zeitraum, preise: boolean, heute = berlinTag(new Date())): Promise<AngebotsKennzahlen> {
	return mitBetrieb(k, async (tx) => rechneAngebote(await ladeAngebote(tx, k, sicht), await ladeAuftraege(tx, k, sicht), z, heute, preise, await ladeEinstellungen(tx, k)));
}

// ——— Einstellungen je Kennzahl (Jamil msg 2946) ———

/** Einstellungen des Betriebs (nur vom Standard abweichende stehen in der Tabelle). */
/**
 * Kacheln „Auftragsbestätigungen“: in der Sicht des Nutzers (über den Auftrag; ohne Auftrag nur mit „Alle Aufträge
 * ansehen“ – wie die Liste).
 */
export async function abKennzahlen(k: Kontext, sicht: Sicht, z: Zeitraum): Promise<AbKennzahlen> {
	return mitBetrieb(k, async (tx) => {
		const z2 = await tx`
			select ab.angelegt, ab.versendet_am, ab.versand_status
			from app.auftragsbestaetigungen ab
			left join app.auftraege a on a.id = ab.auftrag_id and a.betrieb_id = ab.betrieb_id
			where ab.betrieb_id = ${k.betriebId}
				and ${sicht.alle ? tx`true` : tx`(a.id is not null and ${sichtbar(tx, sicht)})`}`;
		const fakten: AbFakt[] = z2.map((r) => ({ angelegt: new Date(r.angelegt), versendetAm: r.versendet_am ? new Date(r.versendet_am) : null, status: r.versand_status }));
		return rechneAuftragsbestaetigungen(fakten, z, await ladeEinstellungen(tx, k));
	});
}

async function ladeEinstellungen(tx: TransactionSql, k: Kontext): Promise<KennzahlEinstellungen> {
	const z = await tx`select kennzahl, aktiv, to_char(ab, 'YYYY-MM-DD') as ab from app.kennzahl_einstellungen where betrieb_id = ${k.betriebId}`;
	return Object.fromEntries(z.filter((r) => istKonfigId(r.kennzahl)).map((r) => [r.kennzahl as string, { aktiv: r.aktiv as boolean, ab: (r.ab as string | null) ?? null }]));
}

/**
 * Für alle, die Kennzahlen anzeigen (Cockpit, Kacheln, Start-Bausteine): welche Kennzahlen an sind und ab wann sie
 * erfasst werden. `aktiv` in der Reihenfolge von KONFIG_KENNZAHLEN.
 */
export async function aktiveKennzahlen(k: Kontext): Promise<{ aktiv: string[]; einstellungen: KennzahlEinstellungen }> {
	const e = await mitBetrieb(k, (tx) => ladeEinstellungen(tx, k));
	return { aktiv: KONFIG_KENNZAHLEN.map((x) => x.id).filter((id) => istAktiv(e, id)), einstellungen: e };
}

/** Einstellungsseite: Recht `kennzahlen.verwalten` (Standard: Chef). */
export function kennzahlEinstellungenZugriff(locals: { nutzer: Nutzer | null }): Kontext {
	pruefeRecht(locals, 'kennzahlen.verwalten');
	const n = locals.nutzer!;
	return { betriebId: n.betriebId!, benutzerId: n.id };
}

/** Alle Kennzahlen mit ihrer Einstellung (fehlende = Standard: an, ohne Datum). */
export async function holeKennzahlEinstellungen(k: Kontext): Promise<((typeof KONFIG_KENNZAHLEN)[number] & KennzahlEinstellung)[]> {
	const e = await mitBetrieb(k, (tx) => ladeEinstellungen(tx, k));
	return KONFIG_KENNZAHLEN.map((x) => ({ ...x, ...(e[x.id] ?? STANDARD_EINSTELLUNG) }));
}

/** Speichert die Einstellungen (nur bekannte Kennzahlen; Datum JJJJ-MM-TT, nicht in der Zukunft). */
export async function speichereKennzahlEinstellungen(k: Kontext, eingabe: Record<string, { aktiv?: unknown; ab?: unknown }>, heute = berlinTag(new Date())): Promise<void> {
	const zeilen: { id: string; aktiv: boolean; ab: string | null }[] = [];
	for (const [id, w] of Object.entries(eingabe)) {
		if (!istKonfigId(id)) throw new ApiFehler(400, `Unbekannte Kennzahl „${id}“.`);
		const ab = w.ab === undefined || w.ab === null || w.ab === '' ? null : w.ab;
		const titel = KONFIG_KENNZAHLEN.find((x) => x.id === id)!.titel;
		if (ab !== null && !istTag(ab)) throw new ApiFehler(400, `${titel}: bitte ein gültiges Datum wählen.`);
		if (ab !== null && (ab as string) > heute) throw new ApiFehler(400, `${titel}: „Erfassen ab“ darf nicht in der Zukunft liegen.`);
		zeilen.push({ id, aktiv: w.aktiv === true || w.aktiv === 'on' || w.aktiv === 'true', ab: ab as string | null });
	}
	await mitBetrieb(k, async (tx) => {
		for (const z of zeilen) {
			if (z.aktiv && z.ab === null) {
				await tx`delete from app.kennzahl_einstellungen where betrieb_id = ${k.betriebId} and kennzahl = ${z.id}`;
				continue;
			}
			await tx`
				insert into app.kennzahl_einstellungen (betrieb_id, kennzahl, aktiv, ab) values (${k.betriebId}, ${z.id}, ${z.aktiv}, ${z.ab})
				on conflict (betrieb_id, kennzahl) do update set aktiv = excluded.aktiv, ab = excluded.ab`;
		}
	});
}

// ——— Cockpit ———

/** Zugriff aufs Cockpit: Modul `auftraege` + „Alle Aufträge ansehen“ (Kennzahlen über den ganzen Betrieb). */
export async function kennzahlenZugriff(locals: { nutzer: Nutzer | null }): Promise<{ k: Kontext; preise: boolean }> {
	pruefeRecht(locals, 'auftraege.alle_lesen');
	await darf(locals, 'auftraege', 'auftraege.alle_lesen');
	const n = locals.nutzer!;
	return { k: { betriebId: n.betriebId!, benutzerId: n.id }, preise: hatRecht(n, 'preise.sehen') };
}

export const siehtKennzahlen = (nutzer: Nutzer, module: readonly string[]) => module.includes('auftraege') && hatRecht(nutzer, 'auftraege.alle_lesen');

/** Arbeitsminuten im Zeitraum, je Person vereinigt und dann summiert: gesamt und davon Nacharbeit. */
async function nacharbeitMinuten(tx: TransactionSql, k: Kontext, s: Spanne | null, jetzt: Date, abErfassen: string | null = null): Promise<{ gesamt: number; nacharbeit: number; jeMarkiert: boolean }> {
	const g = grenzenVon(s);
	// „Erfassen ab“: Zeiten davor zählen nicht
	if (abErfassen) g.ab = Math.max(g.ab, grenzenVon({ von: abErfassen, bis: abErfassen }).ab);
	const ab = Number.isFinite(g.ab) ? new Date(g.ab) : new Date('2000-01-01T00:00:00Z');
	const bis = Number.isFinite(g.bis) ? new Date(g.bis) : new Date(jetzt.getTime() + MS_TAG);
	const z = await tx`
		select benutzer_id, art, beginn, ende, pause_min, km, nacharbeit from app.zeit_eintraege
		where betrieb_id = ${k.betriebId} and art in ('arbeit', 'pause') and beginn < ${bis} and coalesce(ende, now()) > ${ab}`;
	const [m] = await tx`select exists (select 1 from app.zeit_eintraege where betrieb_id = ${k.betriebId} and nacharbeit) as ja`;
	const rahmen = { von: ab, bis };
	let gesamt = 0;
	let nach = 0;
	for (const b of new Set(z.map((r) => r.benutzer_id as string))) {
		const eigene = z
			.filter((r) => r.benutzer_id === b)
			.map((r) => ({ art: r.art, beginn: new Date(r.beginn).toISOString(), ende: r.ende ? new Date(r.ende).toISOString() : null, pauseMin: Number(r.pause_min), km: null, nacharbeit: r.nacharbeit as boolean }));
		gesamt += summiere(eigene, jetzt, rahmen).arbeitMin;
		nach += summiere(eigene.filter((e) => e.art === 'pause' || e.nacharbeit), jetzt, rahmen).arbeitMin;
	}
	return { gesamt, nacharbeit: nach, jeMarkiert: m.ja };
}

/** Werte der Cockpit-Kennzahlen – je Kennzahl mit ihrem „Erfassen ab“; ausgeschaltete werden nicht gerechnet. */
export async function cockpitWerte(
	k: Kontext,
	s: Spanne | null,
	preise: boolean,
	d: { angebote: AngebotFakt[]; auftraege: AuftragFakt[]; minuten: Map<string, { planMin: number; istMin: number }>; mitarbeiter: number },
	jetzt: Date,
	e?: KennzahlEinstellungen
): Promise<Partial<Record<KennzahlId, KennzahlWert>>> {
	const g = grenzenVon(s);
	const an = (id: KennzahlId) => seit(d.angebote, abTag(e, id), angelegtAn);
	const ag = (id: KennzahlId) => seit(d.auftraege, abTag(e, id), angelegtAn);
	const aus: Partial<Record<KennzahlId, KennzahlWert>> = {};
	const wenn = (id: KennzahlId, f: () => KennzahlWert) => {
		if (istAktiv(e, id)) aus[id] = f();
	};
	wenn('abschlussquote', () => rechneAbschlussquote(an('abschlussquote'), g));
	wenn('durchlaufzeit', () => rechneDurchlaufzeit(ag('durchlaufzeit'), g));
	wenn('termintreue', () => rechneTermintreue(ag('termintreue'), g));
	wenn('produktivitaet', () => rechneProduktivitaet(ag('produktivitaet'), d.minuten, g));
	if (istAktiv(e, 'nacharbeit')) {
		const na = await mitBetrieb(k, (tx) => nacharbeitMinuten(tx, k, s, jetzt, abTag(e, 'nacharbeit')));
		aus.nacharbeit = rechneNacharbeit(na.gesamt, na.nacharbeit, na.jeMarkiert);
	}
	wenn('zahlungsdauer', () => ZAHLUNGSDAUER_FEHLT);
	wenn('umsatz_mitarbeiter', () => rechneUmsatzProMitarbeiter(an('umsatz_mitarbeiter'), d.mitarbeiter, g, preise));
	return aus;
}

/** Alle Cockpit-Kennzahlen für den Zeitraum, mit Vorzeitraum (Trend) und Ampel. Sicht: der ganze Betrieb. */
export async function cockpit(k: Kontext, z: Zeitraum, preise: boolean, jetzt = new Date()): Promise<Kennzahl[]> {
	const alle: Sicht = { alle: true, benutzerId: k.benutzerId };
	const d = await mitBetrieb(k, async (tx) => {
		const [angebote, auftraege] = [await ladeAngebote(tx, k, alle), await ladeAuftraege(tx, k, alle)];
		const [ma] = await tx`select count(*)::int as n from app.kalkulation_mitarbeiter where betrieb_id = ${k.betriebId}`;
		return { angebote, auftraege, mitarbeiter: ma.n as number, e: await ladeEinstellungen(tx, k) };
	});
	const fertig = d.auftraege.filter((a) => a.abgenommenAm !== null).map((a) => a.id);
	const minuten = istAktiv(d.e, 'produktivitaet') ? await planIstMinuten(k, fertig, jetzt) : new Map();
	const jetztW = await cockpitWerte(k, z.spanne, preise, { ...d, minuten }, jetzt, d.e);
	const vorherW = z.vorher ? await cockpitWerte(k, z.vorher, preise, { ...d, minuten }, jetzt, d.e) : null;
	return KENNZAHL_IDS.filter((id) => istAktiv(d.e, id)).map((id) => ({ ...baueKennzahl(id, jetztW[id]!, vorherW ? (vorherW[id] ?? null) : null), seit: seitText(d.e, id) }));
}

// ——— Zeitmessung je Vorlagen-Aufgabe (msg 2858) ———

/** Ø Zeiten je Aufgabe einer Auftrags-Vorlage (Schlüssel: Titel der Vorlagen-Aufgabe beim Anlegen, klein geschrieben). */
export async function vorlagenAufgabenZeiten(k: Kontext, vorlageId: string): Promise<Map<string, AufgabenZeiten>> {
	const z = await mitBetrieb(k, (tx) => tx`
		select lower(vorlage_aufgabe) as schluessel, angelegt, begonnen_am, erledigt_am from app.todos
		where betrieb_id = ${k.betriebId} and vorlage_id = ${vorlageId} and vorlage_aufgabe is not null`);
	const je = new Map<string, { angelegt: string; begonnen: string | null; erledigt: string | null }[]>();
	for (const r of z) {
		const l = je.get(r.schluessel) ?? [];
		l.push({ angelegt: new Date(r.angelegt).toISOString(), begonnen: r.begonnen_am ? new Date(r.begonnen_am).toISOString() : null, erledigt: r.erledigt_am ? new Date(r.erledigt_am).toISOString() : null });
		je.set(r.schluessel, l);
	}
	return new Map([...je].map(([s, l]) => [s, aufgabenZeiten(l)]));
}

// ——— Klick auf eine Kunden-Kachel filtert die Kundenliste (msg 2799) ———

export const KUNDEN_GRUPPEN = ['aktiv', 'angenommen', 'abgelehnt', 'abgelaufen'] as const;
export type KundenGruppe = (typeof KUNDEN_GRUPPEN)[number];
export const istKundenGruppe = (w: unknown): w is KundenGruppe => typeof w === 'string' && (KUNDEN_GRUPPEN as readonly string[]).includes(w);

/** Kunden-IDs hinter einer Kachel – gleiche Regeln wie `rechneKunden` (damit Zahl und gefilterte Liste passen). */
export async function kundenIdsFuer(k: Kontext, sicht: Sicht, z: Zeitraum, gruppe: KundenGruppe, heute = berlinTag(new Date())): Promise<Set<string>> {
	return mitBetrieb(k, async (tx) => {
		const ids = (l: readonly { kundeId: string | null }[]) => new Set(l.map((x) => x.kundeId).filter((x): x is string => !!x));
		// gleiche Einstellungen wie die Kachel (Jamil msg 2946): aus → leer, sonst ab „Erfassen ab“
		const e = await ladeEinstellungen(tx, k);
		const id = `kunden_${gruppe}`;
		if (!istAktiv(e, id)) return new Set<string>();
		if (gruppe === 'aktiv') return ids(seit(await ladeAuftraege(tx, k, sicht), abTag(e, id), angelegtAn).filter((a) => a.status !== 'abgenommen' && a.status !== 'abgerechnet'));
		const g = grenzenVon(z.spanne);
		const l = seit(await ladeAngebote(tx, k, sicht), abTag(e, id), angelegtAn).filter(gezaehlt);
		if (gruppe === 'angenommen') return ids(l.filter((a) => a.status === 'angenommen' && drin(a.angenommenAm, g)));
		if (gruppe === 'abgelehnt') return ids(l.filter((a) => a.status === 'abgelehnt' && drin(a.abgelehntAm, g)));
		return ids(l.filter((a) => istAbgelaufen(a, heute) && tagDrin(a.gueltigBis, z.spanne)));
	});
}

/**
 * Start-Kacheln (Katalog und Layout) ohne ausgeschaltete Kennzahlen (Jamil msg 2946): Einzel-Kennzahlen `kz-<id>`,
 * „Nachfassen fällig“ und „Alle Kennzahlen“ (wenn keine Cockpit-Kennzahl mehr an ist). Ändert `erlaubt` und gibt es zurück.
 */
export async function ohneAusgeschalteteKacheln(k: Kontext, erlaubt: Set<string>): Promise<Set<string>> {
	const { einstellungen: e } = await aktiveKennzahlen(k);
	for (const id of KENNZAHL_IDS) if (!istAktiv(e, id)) erlaubt.delete(`kz-${id}`);
	if (!istAktiv(e, 'auftraege_nachfassen')) erlaubt.delete('nachfassen');
	if (!KENNZAHL_IDS.some((id) => istAktiv(e, id))) erlaubt.delete('kennzahlen');
	return erlaubt;
}
