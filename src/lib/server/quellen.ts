import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { berlinTag, istTag, tagPlus } from '../zeit';
import { istFarbe, standardFarbe } from '../farben';
import { ABLAUF_SCHRITTE, istAblaufSchritt } from '../auftrag-board';

/**
 * Auftragsquellen (Wunsch Jamil msg 2593): Website, Hornbach, Obi, Empfehlung, … – zentral gepflegt (Einstellungen →
 * Quellen, Recht „Einstellungen“). Neue Betriebe bekommen die Startliste beim ersten Lesen. Auswertung je Quelle
 * (Chef/Admin, mit Beträgen nur mit „Preise sehen“).
 */

export type Quelle = {
	id: string;
	name: string;
	aktiv: boolean;
	sortierung: number;
	farbe: string;
	auftraege: number;
	/** übersprungene Schritte (Ablauf je Quelle, Jamil msg 3703); leer = alles gilt */
	uebersprungen: string[];
};

export const START_QUELLEN = ['Website', 'Hornbach', 'Obi', 'Empfehlung', 'Zeitung', 'MyHammer', 'Telefon', 'Online-Buchung', 'Sonstiges'];

/** Quelle für Aufträge aus der Online-Buchung (Wunsch Jamil msgs 2684/2686), falls am Link/Dienst keine gewählt ist. */
export const ONLINE_QUELLE = 'Online-Buchung';

const nichtGefunden = () => new ApiFehler(404, 'Auftragsquelle nicht gefunden.');
const pruefeId = (id: unknown) => {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden();
	return id.trim().toLowerCase();
};

export async function startlisteFallsLeer(tx: TransactionSql, k: Pick<Kontext, 'betriebId'>): Promise<void> {
	const [da] = await tx`select 1 from app.auftrag_quellen where betrieb_id = ${k.betriebId} limit 1`;
	if (da) return;
	let nr = 1;
	for (const name of START_QUELLEN) {
		await tx`insert into app.auftrag_quellen (betrieb_id, name, sortierung, farbe) values (${k.betriebId}, ${name}, ${nr}, ${standardFarbe(name, nr - 1)}) on conflict do nothing`;
		nr++;
	}
}

export async function listeQuellen(k: Kontext, nurAktive = false): Promise<Quelle[]> {
	return mitBetrieb(k, async (tx) => {
		await startlisteFallsLeer(tx, k);
		const z = await tx`
			select q.id, q.name, q.aktiv, q.sortierung, q.farbe, q.uebersprungen,
				(select count(*)::int from app.auftraege a where a.quelle_id = q.id and a.betrieb_id = q.betrieb_id) as auftraege
			from app.auftrag_quellen q
			where q.betrieb_id = ${k.betriebId} ${nurAktive ? tx`and q.aktiv` : tx``}
			order by q.sortierung, public.unaccent(lower(q.name)), q.id`;
		return z.map((r) => ({
			id: r.id,
			name: r.name,
			aktiv: r.aktiv,
			sortierung: r.sortierung,
			farbe: r.farbe,
			auftraege: r.auftraege,
			uebersprungen: r.uebersprungen ?? []
		}));
	});
}

export async function speichereQuelle(k: Kontext, id: unknown, e: Record<string, unknown>): Promise<void> {
	const name = textFeld(e.name, 'Name', 100);
	if (!name) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben.');
	const aktiv = e.aktiv === undefined || e.aktiv === '' ? true : e.aktiv === true || e.aktiv === 'true' || e.aktiv === 'on';
	const bisher = id === null || id === undefined || id === '' ? null : pruefeId(id);
	const farbeRoh = e.farbe === undefined || e.farbe === null || e.farbe === '' ? null : e.farbe;
	if (farbeRoh !== null && !istFarbe(farbeRoh)) throw new ApiFehler(400, 'Farbe: bitte eine Farbe wählen.');
	const farbe = farbeRoh === null ? null : (farbeRoh as string).toLowerCase();
	await mitBetrieb(k, async (tx) => {
		const [gleich] = await tx`
			select 1 from app.auftrag_quellen where betrieb_id = ${k.betriebId} and lower(btrim(name)) = lower(${name}) and id is distinct from ${bisher}::uuid`;
		if (gleich) throw new ApiFehler(409, `Es gibt schon eine Auftragsquelle „${name}“.`);
		if (!bisher) {
			const [{ n }] = await tx`select coalesce(max(sortierung), 0)::int + 1 as n from app.auftrag_quellen where betrieb_id = ${k.betriebId}`;
			await tx`insert into app.auftrag_quellen (betrieb_id, name, aktiv, sortierung, farbe) values (${k.betriebId}, ${name}, ${aktiv}, ${n}, ${farbe ?? standardFarbe(name, n - 1)})`;
			return;
		}
		const z = await tx`update app.auftrag_quellen set name = ${name}, aktiv = ${aktiv}, farbe = coalesce(${farbe}, farbe) where id = ${bisher} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}

/** Eine Stelle nach oben (-1) oder unten (+1) in der Reihenfolge. */
export async function verschiebeQuelle(k: Kontext, id: unknown, richtung: number): Promise<void> {
	const qid = pruefeId(id);
	await mitBetrieb(k, async (tx) => {
		const alle = await tx`select id from app.auftrag_quellen where betrieb_id = ${k.betriebId} order by sortierung, public.unaccent(lower(name)), id`;
		const i = alle.findIndex((r) => r.id === qid);
		if (i < 0) throw nichtGefunden();
		const j = i + (richtung < 0 ? -1 : 1);
		if (j < 0 || j >= alle.length) return;
		const neu = alle.map((r) => r.id as string);
		[neu[i], neu[j]] = [neu[j], neu[i]];
		for (const [nr, qid2] of neu.entries()) await tx`update app.auftrag_quellen set sortierung = ${nr + 1} where id = ${qid2} and betrieb_id = ${k.betriebId}`;
	});
}

/** Löschen; ist die Quelle an Aufträgen gesetzt, wird sie nur ausgeschaltet (Auswertung bleibt richtig). */
export async function loescheQuelle(k: Kontext, id: unknown): Promise<'geloescht' | 'deaktiviert'> {
	const qid = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [benutzt] = await tx`select 1 from app.auftraege where quelle_id = ${qid} and betrieb_id = ${k.betriebId} limit 1`;
		if (benutzt) {
			const z = await tx`update app.auftrag_quellen set aktiv = false where id = ${qid} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw nichtGefunden();
			return 'deaktiviert';
		}
		const z = await tx`delete from app.auftrag_quellen where id = ${qid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
		return 'geloescht';
	});
}

export type QuellenZeile = {
	quelleId: string | null;
	name: string;
	auftraege: number;
	angebote: number;
	angenommen: number;
	/** angenommen / (angenommen + abgelehnt + versendet) in Prozent – null ohne entschiedene/versendete Angebote */
	quoteProzent: number | null;
	umsatzCent: number;
	/** Umsatz / Aufträge mit angenommenem Angebot */
	durchschnittCent: number | null;
};

/**
 * Auswertung je Quelle im Zeitraum (Angelegt-Datum, Berlin, inklusive): Aufträge und Angebote angelegt, Angebote
 * angenommen, Annahmequote, Umsatz = Summe der angenommenen Angebote (netto), Ø Auftragswert. „Ohne Quelle“ als
 * eigene Zeile. Rechnungen gibt es im CRM noch nicht – darum zählen angenommene Angebote.
 */
export async function auswertung(k: Kontext, von: string, bis: string): Promise<QuellenZeile[]> {
	if (!istTag(von) || !istTag(bis) || bis < von) throw new ApiFehler(400, 'Bitte einen gültigen Zeitraum wählen.');
	await listeQuellen(k);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			with a as (
				select a.id, a.quelle_id from app.auftraege a
				where a.betrieb_id = ${k.betriebId}
					and (a.angelegt at time zone 'Europe/Berlin')::date between ${von}::date and ${bis}::date
			),
			an as (
				select an.id, an.status, a.quelle_id, a.id as auftrag_id,
					coalesce((select sum(round(p.menge * p.einzelpreis_cent)) from app.angebot_positionen p
						where p.angebot_id = an.id and p.betrieb_id = an.betrieb_id), 0)::bigint as netto
				from app.angebote an join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
				where an.betrieb_id = ${k.betriebId}
					and (an.angelegt at time zone 'Europe/Berlin')::date between ${von}::date and ${bis}::date
			)
			select q.id as quelle_id, q.name, q.sortierung,
				(select count(*) from a where a.quelle_id is not distinct from q.id)::int as auftraege,
				(select count(*) from an where an.quelle_id is not distinct from q.id)::int as angebote,
				(select count(*) from an where an.quelle_id is not distinct from q.id and an.status = 'angenommen')::int as angenommen,
				(select count(*) from an where an.quelle_id is not distinct from q.id and an.status in ('angenommen', 'abgelehnt', 'versendet'))::int as entschieden,
				(select coalesce(sum(an.netto), 0) from an where an.quelle_id is not distinct from q.id and an.status = 'angenommen')::bigint as umsatz,
				(select count(distinct an.auftrag_id) from an where an.quelle_id is not distinct from q.id and an.status = 'angenommen')::int as auftraege_mit_umsatz
			from (select id, name, sortierung from app.auftrag_quellen where betrieb_id = ${k.betriebId}
				union all select null::uuid, 'Ohne Auftragsquelle', 100000) q
			order by q.sortierung, q.name`;
		return z
			.map((r) => ({
				quelleId: r.quelle_id,
				name: r.name,
				auftraege: r.auftraege,
				angebote: r.angebote,
				angenommen: r.angenommen,
				quoteProzent: r.entschieden > 0 ? Math.round((r.angenommen / r.entschieden) * 1000) / 10 : null,
				umsatzCent: Number(r.umsatz),
				durchschnittCent: r.auftraege_mit_umsatz > 0 ? Math.round(Number(r.umsatz) / r.auftraege_mit_umsatz) : null
			}))
			.filter((r) => r.quelleId !== null || r.auftraege > 0 || r.angebote > 0);
	});
}

/** Standard-Zeitraum: die letzten 12 Monate bis heute. */
export function standardZeitraum(jetzt = new Date()): { von: string; bis: string } {
	const bis = berlinTag(jetzt);
	return { von: tagPlus(bis, -365), bis };
}

/** Übersprungene Schritte einer Quelle (leer, wenn keine Quelle oder alles gilt) – in einer laufenden Transaktion. */
export async function uebersprungeneSchritte(tx: TransactionSql, betriebId: string, quelleId: string | null | undefined): Promise<string[]> {
	if (!quelleId) return [];
	const [q] = await tx`select uebersprungen from app.auftrag_quellen where id = ${quelleId} and betrieb_id = ${betriebId}`;
	return q?.uebersprungen ?? [];
}

/**
 * Ablauf je Auftragsquelle speichern (Jamil msg 3703): `uebersprungen` je Quellen-ID = Liste der übersprungenen Schritte
 * (Schlüssel aus `ABLAUF_SCHRITTE`). Nur Quellen des eigenen Betriebs; unbekannte Schritte → 400. Bestehende Aufträge
 * werden dabei NICHT verschoben – die Einstellung wirkt bei Anzeige und beim nächsten Statusschritt.
 */
export async function speichereAblauf(k: Kontext, eintraege: Record<string, unknown>): Promise<void> {
	const geprueft: [string, string[]][] = [];
	for (const [id, liste] of Object.entries(eintraege)) {
		const roh = Array.isArray(liste) ? liste : [];
		if (!roh.every(istAblaufSchritt)) throw new ApiFehler(400, 'Ablauf: unbekannter Schritt.');
		// in fester Reihenfolge und ohne Doppelte speichern (sauberes Änderungsprotokoll)
		geprueft.push([pruefeId(id), ABLAUF_SCHRITTE.map((x) => x.id).filter((x) => roh.includes(x))]);
	}
	await mitBetrieb(k, async (tx) => {
		for (const [id, liste] of geprueft) {
			const z = await tx`
				update app.auftrag_quellen set uebersprungen = ${liste}
				where id = ${id} and betrieb_id = ${k.betriebId} and uebersprungen is distinct from ${liste}::text[]
				returning id`;
			if (z.length === 0) {
				const [da] = await tx`select 1 from app.auftrag_quellen where id = ${id} and betrieb_id = ${k.betriebId}`;
				if (!da) throw nichtGefunden();
			}
		}
	});
}
