import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { anzeigeName, textFeld, UUID } from './kunden';
import { hatRecht, pruefeRecht } from './rechte';
import { sichtbar, sichtVon, type Sicht } from './auftraege';
import { darf } from './tarif';
import { erlaubterAngebotWechsel, istAngebotStatus, type AngebotStatus } from '../angebot-status';
import { istMwstSatz, leseEuroInCent, leseMenge, positionsSumme, summen, type MwstSatz } from '../geld';
import { istEinheit, EINHEITEN } from '../katalog-werte';
import { istTag } from '../zeit';

/**
 * Angebote zu Aufträgen (Modul `angebote`). Jeder Zugriff verlangt `angebote.bearbeiten` UND `preise.sehen` – ein
 * Angebot besteht aus Preisen. Geld in ganzen Cent, Summen mit `summen()` aus `src/lib/geld.ts` (kaufmännisch
 * gerundet). Nur ein Entwurf ist änderbar (die Datenbank sichert das zusätzlich per Trigger ab, Fehler 55000).
 *
 * Statuskopplung (in derselben Transaktion): Angebot → „versendet“ setzt den Auftrag von „anfrage“ auf „angebot“,
 * Angebot → „angenommen“ setzt ihn von „angebot“ auf „beauftragt“; in jedem anderen Auftragsstatus bleibt er. Die
 * Kopplung gibt es nur mit `auftraege.bearbeiten` – sonst ändert sich nur das Angebot (Antwort mit `hinweis`).
 *
 * Sichtbarkeit wie bei Aufträgen (`Sicht`): Wer nur eigene Aufträge sieht, sieht und bearbeitet nur deren Angebote;
 * Angebote unsichtbarer Aufträge sind ein 404 (Listen filtern sie heraus).
 */

export type AngebotPosition = {
	id: string;
	pos: number;
	katalogPositionId: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	menge: number;
	einheit: string;
	einzelpreisCent: number;
	summeCent: number;
};

export type AngebotWarnung = 'preis_fehlt';

export type Angebot = {
	id: string;
	nummer: string;
	auftragId: string;
	auftragNummer: string;
	auftragTitel: string;
	kundeId: string;
	kundeName: string;
	objektId: string | null;
	status: AngebotStatus;
	datum: string;
	gueltigBis: string;
	mwstSatz: MwstSatz;
	einleitung: string | null;
	schluss: string | null;
	positionen: AngebotPosition[];
	nettoCent: number;
	mwstCent: number;
	bruttoCent: number;
	vorgaengerId: string | null;
	warnungen: AngebotWarnung[];
	angelegt: string;
	geaendert: string;
};

/** Für Listen: Kopf mit Summen, ohne Positionen. */
export type AngebotKurz = Omit<Angebot, 'positionen'> & { anzahlPositionen: number };

export type PositionEingabe = {
	katalogPositionId?: string | null;
	bezeichnung?: string;
	beschreibung?: string | null;
	menge: string | number;
	einheit?: string;
	einzelpreis?: string | number;
};

/** Wer greift zu: Sicht auf Aufträge und ob Auftragsstatus mitgeändert werden dürfen (`auftraege.bearbeiten`). */
export type AngebotZugriff = { sicht: Sicht; auftragAendern: boolean };

/** Voller Zugriff (Seed, Tests, interne Aufrufe). */
const voll = (k: Kontext): AngebotZugriff => ({ sicht: { alle: true, benutzerId: k.benutzerId }, auftragAendern: true });

export const HINWEIS_OHNE_AUFTRAGSRECHT = 'Auftragsstatus nicht geändert – fehlende Berechtigung „Aufträge bearbeiten“';
/** Höchste Nettosumme eines Angebots: 100 Mrd. € (in Cent). */
export const MAX_NETTO_CENT = 10_000_000_000_000;

export const MAX_POSITIONEN = 200;
export const MAX_ANGEBOTE = 200;
export const GUELTIG_TAGE = 30;
export const STANDARD_EINLEITUNG = 'Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:';
export const STANDARD_SCHLUSS = 'Wir freuen uns auf Ihren Auftrag.';
export const KOPF_FELDER = ['datum', 'gueltigBis', 'mwstSatz', 'einleitung', 'schluss'] as const;

const nichtGefunden = () => new ApiFehler(404, 'Angebot nicht gefunden.');
const nichtAenderbar = () => new ApiFehler(409, 'Angebot ist nicht mehr änderbar');

/**
 * Rechte für jeden Angebots-Endpunkt: 401/403 ohne `angebote.bearbeiten` oder `preise.sehen`, 402 ohne Modul.
 * Liefert die Sicht des Nutzers auf Aufträge und ob er Auftragsstatus ändern darf.
 */
export async function angeboteZugriff(locals: { nutzer: Nutzer | null }): Promise<AngebotZugriff> {
	pruefeRecht(locals, 'angebote.bearbeiten');
	pruefeRecht(locals, 'preise.sehen');
	await darf(locals, 'angebote', 'angebote.bearbeiten');
	const n = locals.nutzer!;
	return { sicht: sichtVon(n), auftragAendern: hatRecht(n, 'auftraege.bearbeiten') };
}

export function pruefeAngebotId(id: string): string {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	return id.toLowerCase();
}

/** Datenbankfehler „nicht mehr änderbar“ (Trigger, 55000) als 409. */
async function mitSchutz<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if ((e as { code?: string })?.code === '55000') throw nichtAenderbar();
		throw e;
	}
}

const KOPF = `an.id, an.nummer, an.auftrag_id, an.status, to_char(an.datum, 'YYYY-MM-DD') as datum,
	to_char(an.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis, an.mwst_satz, an.einleitung, an.schluss, an.vorgaenger_id,
	an.angelegt, an.geaendert, a.nummer as auftrag_nummer, a.titel as auftrag_titel, a.objekt_id, a.kunde_id,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname`;

const VON = `app.angebote an
	join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
	join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id`;

const von = (tx: TransactionSql) => tx.unsafe(VON);

function zuPosition(z: Record<string, any>): AngebotPosition {
	const menge = Number(z.menge);
	const einzelpreisCent = Number(z.einzelpreis_cent);
	return {
		id: z.id,
		pos: z.pos,
		katalogPositionId: z.katalog_position_id,
		bezeichnung: z.bezeichnung,
		beschreibung: z.beschreibung,
		menge,
		einheit: z.einheit,
		einzelpreisCent,
		summeCent: positionsSumme(menge, einzelpreisCent)
	};
}

function zuAngebot(z: Record<string, any>, positionen: AngebotPosition[]): Angebot {
	const mwstSatz = Number(z.mwst_satz) as MwstSatz;
	return {
		id: z.id,
		nummer: z.nummer,
		auftragId: z.auftrag_id,
		auftragNummer: z.auftrag_nummer,
		auftragTitel: z.auftrag_titel,
		kundeId: z.kunde_id,
		kundeName: anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname }),
		objektId: z.objekt_id,
		status: z.status,
		datum: z.datum,
		gueltigBis: z.gueltig_bis,
		mwstSatz,
		einleitung: z.einleitung,
		schluss: z.schluss,
		positionen,
		...summen(positionen, mwstSatz),
		vorgaengerId: z.vorgaenger_id,
		warnungen: positionen.some((p) => p.einzelpreisCent === 0) ? ['preis_fehlt'] : [],
		angelegt: new Date(z.angelegt).toISOString(),
		geaendert: new Date(z.geaendert).toISOString()
	};
}

async function ladePositionen(tx: TransactionSql, k: Kontext, ids: string[]): Promise<Map<string, AngebotPosition[]>> {
	const z = await tx`
		select id, angebot_id, pos, katalog_position_id, bezeichnung, beschreibung, menge::text as menge,
			einheit::text as einheit, einzelpreis_cent
		from app.angebot_positionen
		where betrieb_id = ${k.betriebId} and angebot_id = any(${ids}::uuid[])
		order by angebot_id, pos`;
	const karte = new Map<string, AngebotPosition[]>(ids.map((id) => [id, []]));
	for (const r of z) karte.get(r.angebot_id)?.push(zuPosition(r));
	return karte;
}

async function ladeEines(tx: TransactionSql, k: Kontext, id: string, sicht: Sicht): Promise<Angebot> {
	const [z] = await tx`
		select ${tx.unsafe(KOPF)} from ${von(tx)}
		where an.id = ${id} and an.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)}`;
	if (!z) throw nichtGefunden();
	const pos = await ladePositionen(tx, k, [id]);
	return zuAngebot(z, pos.get(id) ?? []);
}

export type AngebotFilter = { auftragId?: string; status?: string };

/** Angebote des Betriebs (neueste zuerst, höchstens 200), optional je Auftrag oder Status. */
export async function listeAngebote(k: Kontext, filter: AngebotFilter = {}, zg: AngebotZugriff = voll(k)): Promise<AngebotKurz[]> {
	if (filter.auftragId !== undefined && !UUID.test(filter.auftragId)) throw new ApiFehler(400, 'Ungültiger Auftrag.');
	if (filter.status !== undefined && !istAngebotStatus(filter.status)) throw new ApiFehler(400, 'Unbekannter Status.');
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(KOPF)} from ${von(tx)}
			where an.betrieb_id = ${k.betriebId} and ${sichtbar(tx, zg.sicht)}
				${filter.auftragId ? tx`and an.auftrag_id = ${filter.auftragId}` : tx``}
				${filter.status ? tx`and an.status = ${filter.status}` : tx``}
			order by an.angelegt desc, an.nummer desc
			limit ${MAX_ANGEBOTE}`;
		const pos = await ladePositionen(tx, k, z.map((r) => r.id));
		return z.map((r) => {
			const { positionen, ...rest } = zuAngebot(r, pos.get(r.id) ?? []);
			return { ...rest, anzahlPositionen: positionen.length };
		});
	});
}

export async function holeAngebot(k: Kontext, id: string, zg: AngebotZugriff = voll(k)): Promise<Angebot> {
	const aid = pruefeAngebotId(id);
	return mitBetrieb(k, (tx) => ladeEines(tx, k, aid, zg.sicht));
}

/** Neues Angebot (Entwurf) zu einem Auftrag: Datum heute (Berlin), gültig 30 Tage, Standardtexte, MwSt 19 %. */
export async function legeAngebotAn(k: Kontext, auftragId: unknown, zg: AngebotZugriff = voll(k)): Promise<Angebot> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(400, 'Bitte einen Auftrag wählen.');
	return mitBetrieb(k, async (tx) => {
		// unbekannte, fremde und unsichtbare Aufträge gleich: 404 (verrät nicht, dass es sie gibt)
		const [auftrag] = await tx`
			select a.id from app.auftraege a
			where a.id = ${auftragId} and a.betrieb_id = ${k.betriebId} and ${sichtbar(tx, zg.sicht)} for key share of a`;
		if (!auftrag) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
		const [z] = await tx`
			insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, einleitung, schluss)
			values (${k.betriebId}, ${auftrag.id},
				(now() at time zone 'Europe/Berlin')::date + ${GUELTIG_TAGE}::int, ${STANDARD_EINLEITUNG}, ${STANDARD_SCHLUSS})
			returning id`;
		return ladeEines(tx, k, z.id, zg.sicht);
	});
}

/** Sperrt den Kopf und prüft „Entwurf“ (sonst 409); unbekannt/fremd → 404. */
async function sperreEntwurf(tx: TransactionSql, k: Kontext, id: string, sicht: Sicht): Promise<Record<string, any>> {
	const [z] = await tx`
		select an.id, an.status, to_char(an.datum, 'YYYY-MM-DD') as datum, to_char(an.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
			an.mwst_satz, an.einleitung, an.schluss
		from app.angebote an join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		where an.id = ${id} and an.betrieb_id = ${k.betriebId} and ${sichtbar(tx, sicht)} for update of an`;
	if (!z) throw nichtGefunden();
	if (z.status !== 'entwurf') throw nichtAenderbar();
	return z;
}

function leseMwst(w: unknown): MwstSatz {
	const n = typeof w === 'string' && /^\d{1,2}$/.test(w.trim()) ? Number(w) : w;
	if (!istMwstSatz(n)) throw new ApiFehler(400, 'Der MwSt-Satz muss 0, 7 oder 19 % sein.');
	return n;
}

function pruefeFelder(e: Record<string, unknown>, erlaubt: readonly string[]): void {
	const unbekannt = Object.keys(e).filter((f) => !erlaubt.includes(f));
	if (unbekannt.length > 0) throw new ApiFehler(400, `Unbekanntes Feld: ${unbekannt[0]}`);
	if (Object.keys(e).length === 0) throw new ApiFehler(400, 'Nichts zu ändern.');
}

/** Kopf in der laufenden Transaktion ändern (der Kopf `alt` ist schon gesperrt und ein Entwurf). */
async function kopfAendern(tx: TransactionSql, k: Kontext, aid: string, alt: Record<string, any>, e: Record<string, unknown>) {
	const hat = (f: string) => Object.hasOwn(e, f);
	if (!KOPF_FELDER.some(hat)) return;
	const tag = (w: unknown, name: string) => {
		if (!istTag(w)) throw new ApiFehler(400, `${name}: Bitte ein gültiges Datum angeben.`);
		return w;
	};
	const datum = hat('datum') ? tag(e.datum, 'Datum') : alt.datum;
	const gueltigBis = hat('gueltigBis') ? tag(e.gueltigBis, 'Gültig bis') : alt.gueltig_bis;
	if (gueltigBis < datum) throw new ApiFehler(400, '„Gültig bis“ darf nicht vor dem Angebotsdatum liegen.');
	const mwst = hat('mwstSatz') ? leseMwst(e.mwstSatz) : Number(alt.mwst_satz);
	const einleitung = hat('einleitung') ? textFeld(e.einleitung, 'Einleitung', 2000) : alt.einleitung;
	const schluss = hat('schluss') ? textFeld(e.schluss, 'Schlusstext', 2000) : alt.schluss;
	await tx`
		update app.angebote set datum = ${datum}, gueltig_bis = ${gueltigBis}, mwst_satz = ${mwst},
			einleitung = ${einleitung}, schluss = ${schluss}
		where id = ${aid} and betrieb_id = ${k.betriebId}`;
}

/** Kopf ändern (Datum, gültig bis, MwSt-Satz, Einleitung, Schluss) – nur im Entwurf. */
export async function aendereAngebotKopf(
	k: Kontext,
	id: string,
	e: Record<string, unknown>,
	zg: AngebotZugriff = voll(k)
): Promise<Angebot> {
	const aid = pruefeAngebotId(id);
	pruefeFelder(e, KOPF_FELDER);
	return mitSchutz(() =>
		mitBetrieb(k, async (tx) => {
			const alt = await sperreEntwurf(tx, k, aid, zg.sicht);
			await kopfAendern(tx, k, aid, alt, e);
			return ladeEines(tx, k, aid, zg.sicht);
		})
	);
}

/**
 * Kopf und Positionen in EINER Transaktion speichern (Editor): `{ datum?, gueltigBis?, mwstSatz?, einleitung?,
 * schluss?, positionen? }`. Scheitert etwas (z. B. eine Position), bleibt alles wie vorher.
 */
export async function speichereAngebot(
	k: Kontext,
	id: string,
	e: Record<string, unknown>,
	zg: AngebotZugriff = voll(k)
): Promise<Angebot> {
	const aid = pruefeAngebotId(id);
	pruefeFelder(e, [...KOPF_FELDER, 'positionen']);
	if (Object.hasOwn(e, 'positionen')) pruefePositionsListe(e.positionen);
	return mitSchutz(() =>
		mitBetrieb(k, async (tx) => {
			const alt = await sperreEntwurf(tx, k, aid, zg.sicht);
			await kopfAendern(tx, k, aid, alt, e);
			if (Object.hasOwn(e, 'positionen')) await positionenErsetzen(tx, k, aid, e.positionen as unknown[]);
			return ladeEines(tx, k, aid, zg.sicht);
		})
	);
}

type Zeile = {
	katalog_position_id: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	menge: number;
	einheit: string;
	einzelpreis_cent: number;
};

/**
 * Ersetzt die ganze Positionsliste eines Entwurfs (Reihenfolge = Position 1…n, höchstens 200). Mit
 * `katalogPositionId` werden Bezeichnung, Beschreibung, Einheit und Einzelpreis (Lohn + Material) aus dem Katalog
 * kopiert, soweit sie nicht ausdrücklich mitgegeben sind; spätere Katalogänderungen ändern das Angebot nicht.
 * Mengen „2,5“/2.5 (> 0, ≤ 3 Nachkommastellen), Preise in Euro („1.234,56“). Fehler nennen die Position.
 */
export async function speicherePositionen(
	k: Kontext,
	id: string,
	eingabe: unknown,
	zg: AngebotZugriff = voll(k)
): Promise<Angebot> {
	const aid = pruefeAngebotId(id);
	pruefePositionsListe(eingabe);
	return mitSchutz(() =>
		mitBetrieb(k, async (tx) => {
			await sperreEntwurf(tx, k, aid, zg.sicht);
			await positionenErsetzen(tx, k, aid, eingabe);
			return ladeEines(tx, k, aid, zg.sicht);
		})
	);
}

function pruefePositionsListe(eingabe: unknown): asserts eingabe is unknown[] {
	if (!Array.isArray(eingabe)) throw new ApiFehler(400, 'Positionen müssen eine Liste sein.');
	if (eingabe.length > MAX_POSITIONEN) throw new ApiFehler(400, `Höchstens ${MAX_POSITIONEN} Positionen je Angebot.`);
}

/** Positionen in der laufenden Transaktion ersetzen (Kopf ist gesperrt und ein Entwurf). */
async function positionenErsetzen(tx: TransactionSql, k: Kontext, aid: string, eingabe: unknown[]): Promise<void> {
	const katalogIds = [
		...new Set(
			eingabe
				.map((p) => (p && typeof p === 'object' ? (p as PositionEingabe).katalogPositionId : null))
				.filter((x): x is string => typeof x === 'string' && x !== '')
		)
	];
	for (const kid of katalogIds) if (!UUID.test(kid)) throw new ApiFehler(400, 'Katalogposition nicht gefunden.');
	const katalog = new Map<string, Record<string, any>>();
	if (katalogIds.length > 0) {
		const z = await tx`
			select id, bezeichnung, beschreibung, einheit::text as einheit, lohn_cent + material_cent as preis
			from app.katalog_positionen
			where betrieb_id = ${k.betriebId} and id = any(${katalogIds}::uuid[])
			for key share`;
		for (const r of z) katalog.set(r.id, r);
	}
	const zeilen: Zeile[] = eingabe.map((roh, i) => {
		const nr = i + 1;
		const fehler = (m: string) => new ApiFehler(400, `Position ${nr}: ${m}`);
		if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw fehler('ungültige Angabe.');
		const p = roh as PositionEingabe;
		const kid = typeof p.katalogPositionId === 'string' && p.katalogPositionId !== '' ? p.katalogPositionId.toLowerCase() : null;
		const kat = kid ? katalog.get(kid) : undefined;
		if (kid && !kat) throw fehler('Katalogposition nicht gefunden.');
		let bezeichnung: string | null;
		let beschreibung: string | null;
		try {
			bezeichnung = p.bezeichnung !== undefined ? textFeld(p.bezeichnung, 'Bezeichnung', 200) : (kat?.bezeichnung ?? null);
			beschreibung =
				p.beschreibung !== undefined ? textFeld(p.beschreibung, 'Beschreibung', 2000) : (kat?.beschreibung ?? null);
		} catch (e) {
			throw fehler((e as Error).message);
		}
		if (bezeichnung === null) throw fehler('Bitte eine Bezeichnung eingeben.');
		const einheit = p.einheit !== undefined && p.einheit !== '' ? p.einheit : kat?.einheit;
		if (!istEinheit(einheit)) throw fehler(`Bitte eine Einheit wählen (${EINHEITEN.join(', ')}).`);
		let menge: number;
		let einzelpreis: number;
		try {
			if (typeof p.menge !== 'string' && typeof p.menge !== 'number') throw new RangeError('Bitte eine Menge eingeben.');
			menge = leseMenge(p.menge);
			einzelpreis =
				p.einzelpreis !== undefined && p.einzelpreis !== null && p.einzelpreis !== ''
					? leseEuroInCent(p.einzelpreis)
					: kat
						? Number(kat.preis)
						: 0;
		} catch (e) {
			throw fehler((e as Error).message);
		}
		return { katalog_position_id: kid, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent: einzelpreis };
	});
	const netto = summen(zeilen.map((z) => ({ menge: z.menge, einzelpreisCent: z.einzelpreis_cent })), 0).nettoCent;
	if (netto > MAX_NETTO_CENT) throw new ApiFehler(400, 'Die Angebotssumme ist zu hoch (höchstens 100 Mrd. € netto).');
	await tx`delete from app.angebot_positionen where angebot_id = ${aid} and betrieb_id = ${k.betriebId}`;
	if (zeilen.length > 0) {
		await tx`
			insert into app.angebot_positionen ${tx(
				zeilen.map((z, i) => ({ betrieb_id: k.betriebId, angebot_id: aid, pos: i + 1, ...z })),
				'betrieb_id',
				'angebot_id',
				'pos',
				'katalog_position_id',
				'bezeichnung',
				'beschreibung',
				'menge',
				'einheit',
				'einzelpreis_cent'
			)}`;
	}
	// geaendert des Kopfs fortschreiben (Positionen gehören zum Angebot)
	await tx`update app.angebote set status = status where id = ${aid} and betrieb_id = ${k.betriebId}`;
}

/**
 * Statuswechsel (siehe `erlaubterAngebotWechsel`, sonst 409) samt Kopplung an den Auftrag – die nur mit
 * `auftraege.bearbeiten`; ohne das Recht bleibt der Auftrag stehen und die Antwort trägt `hinweis`.
 */
export async function setzeAngebotStatus(
	k: Kontext,
	id: string,
	nach: unknown,
	zg: AngebotZugriff = voll(k)
): Promise<Angebot & { hinweis?: string }> {
	const aid = pruefeAngebotId(id);
	if (!istAngebotStatus(nach)) throw new ApiFehler(400, 'Unbekannter Status.');
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select an.status, an.auftrag_id, a.status as auftrag_status,
				(select count(*)::int from app.angebot_positionen p where p.angebot_id = an.id and p.betrieb_id = an.betrieb_id) as anzahl
			from app.angebote an join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
			where an.id = ${aid} and an.betrieb_id = ${k.betriebId} and ${sichtbar(tx, zg.sicht)} for update of an`;
		if (!alt) throw nichtGefunden();
		if (!erlaubterAngebotWechsel(alt.status, nach)) throw new ApiFehler(409, 'Statuswechsel nicht erlaubt');
		if (nach === 'versendet' && alt.anzahl === 0) {
			throw new ApiFehler(409, 'Ein Angebot ohne Positionen kann nicht versendet werden.');
		}
		await tx`update app.angebote set status = ${nach} where id = ${aid} and betrieb_id = ${k.betriebId}`;
		const kopplung: Partial<Record<AngebotStatus, [string, string]>> = {
			versendet: ['anfrage', 'angebot'],
			angenommen: ['angebot', 'beauftragt']
		};
		const schritt = kopplung[nach];
		let hinweis: string | undefined;
		if (schritt && alt.auftrag_status === schritt[0]) {
			if (zg.auftragAendern) {
				await tx`
					update app.auftraege set status = ${schritt[1]}
					where id = ${alt.auftrag_id} and betrieb_id = ${k.betriebId} and status = ${schritt[0]}`;
			} else {
				hinweis = HINWEIS_OHNE_AUFTRAGSRECHT;
			}
		}
		const angebot = await ladeEines(tx, k, aid, zg.sicht);
		return hinweis ? { ...angebot, hinweis } : angebot;
	});
}

/** „Als neue Version bearbeiten“: kopiert Kopf und Positionen in einen neuen Entwurf (Vorgänger = dieses Angebot). */
export async function neueVersion(k: Kontext, id: string, zg: AngebotZugriff = voll(k)): Promise<Angebot> {
	const aid = pruefeAngebotId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select an.auftrag_id, an.mwst_satz, an.einleitung, an.schluss
			from app.angebote an join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
			where an.id = ${aid} and an.betrieb_id = ${k.betriebId} and ${sichtbar(tx, zg.sicht)} for key share of an`;
		if (!alt) throw nichtGefunden();
		const [neu] = await tx`
			insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, mwst_satz, einleitung, schluss, vorgaenger_id)
			values (${k.betriebId}, ${alt.auftrag_id}, (now() at time zone 'Europe/Berlin')::date + ${GUELTIG_TAGE}::int,
				${alt.mwst_satz}, ${alt.einleitung}, ${alt.schluss}, ${aid})
			returning id`;
		await tx`
			insert into app.angebot_positionen
				(betrieb_id, angebot_id, pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent)
			select betrieb_id, ${neu.id}, pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent
			from app.angebot_positionen where angebot_id = ${aid} and betrieb_id = ${k.betriebId}`;
		return ladeEines(tx, k, neu.id, zg.sicht);
	});
}

export type PdfDaten = {
	angebot: Angebot;
	kunde: { name: string; ansprechpartner: string | null; strasse: string | null; plz: string | null; ort: string | null };
	objekt: { bezeichnung: string; strasse: string | null; plz: string | null; ort: string | null } | null;
};

/** Alles, was das PDF über Angebot, Kunde (Anschrift) und Objekt (Bauvorhaben) braucht. */
export async function ladePdfDaten(k: Kontext, id: string, zg: AngebotZugriff = voll(k)): Promise<PdfDaten> {
	const aid = pruefeAngebotId(id);
	return mitBetrieb(k, async (tx) => {
		const angebot = await ladeEines(tx, k, aid, zg.sicht);
		const [kd] = await tx`
			select art, firma, anrede, vorname, nachname, strasse, plz, ort from app.kunden
			where id = ${angebot.kundeId} and betrieb_id = ${k.betriebId}`;
		const person = [kd.anrede, kd.vorname, kd.nachname].filter(Boolean).join(' ');
		const [ob] = angebot.objektId
			? await tx`
				select bezeichnung, strasse, plz, ort from app.objekte where id = ${angebot.objektId} and betrieb_id = ${k.betriebId}`
			: [];
		return {
			angebot,
			kunde: {
				name: kd.art === 'firma' ? kd.firma : person,
				ansprechpartner: kd.art === 'firma' && (kd.vorname || kd.nachname) ? `z. Hd. ${person}` : null,
				strasse: kd.strasse,
				plz: kd.plz,
				ort: kd.ort
			},
			objekt: ob ? { bezeichnung: ob.bezeichnung, strasse: ob.strasse, plz: ob.plz, ort: ob.ort } : null
		};
	});
}

/** Löscht einen Entwurf samt Positionen (sonst 409). */
export async function loescheAngebot(k: Kontext, id: string, zg: AngebotZugriff = voll(k)): Promise<void> {
	const aid = pruefeAngebotId(id);
	return mitSchutz(() =>
		mitBetrieb(k, async (tx) => {
			await sperreEntwurf(tx, k, aid, zg.sicht);
			await tx`delete from app.angebote where id = ${aid} and betrieb_id = ${k.betriebId}`;
		})
	);
}
