import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { leseEuroInCent, leseMenge } from '../geld';
import { EINHEITEN, istEinheit } from '../katalog-werte';
import { MAX_POSITIONEN, type PositionEingabe } from './angebote';

/**
 * Angebots-Vorlagen (Modul `angebote`, Rechte wie Angebote: `angebote.bearbeiten` UND `preise.sehen` – die Vorlagen
 * enthalten Preise; geprüft von den Aufrufern mit `angeboteZugriff`).
 *
 * Eine Vorlage = Name, optional Einleitung/Schlusstext, geordnete Positionen. Katalogpositionen speichern KEINEN Preis:
 * Beim Einfügen ins Angebot (`wendeAngebotVorlageAn` in angebote.ts) gilt der dann aktuelle Katalogpreis. Freie
 * Positionen speichern ihren Preis. Bezeichnung/Einheit werden immer gespeichert (bei Katalogpositionen als Vorschlag
 * aus dem Katalog, wenn nicht angegeben) – so bleibt die Zeile auch erhalten, wenn die Katalogposition verschwindet.
 */

export type AngebotVorlagePosition = {
	pos: number;
	katalogPositionId: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	menge: number;
	einheit: string;
	/** Nur freie Positionen; bei Katalogpositionen null (Preis kommt beim Einfügen aus dem Katalog). */
	einzelpreisCent: number | null;
	/** Aktueller Katalogpreis (Lohn + Material) – nur zur Anzeige, null bei freien Positionen. */
	katalogPreisCent: number | null;
};

export type AngebotVorlage = {
	id: string;
	name: string;
	einleitung: string | null;
	schluss: string | null;
	positionen: AngebotVorlagePosition[];
	angelegt: string;
	geaendert: string;
};

export type AngebotVorlageKurz = { id: string; name: string; anzahlPositionen: number; geaendert: string };

export type AngebotVorlageEingabe = {
	name?: unknown;
	einleitung?: unknown;
	schluss?: unknown;
	positionen?: unknown;
};

export const ANGEBOT_VORLAGE_FELDER = ['name', 'einleitung', 'schluss', 'positionen'] as const;

const nichtGefunden = () => new ApiFehler(404, 'Vorlage nicht gefunden.');

export function pruefeVorlageId(id: unknown): string {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden();
	return id.trim().toLowerCase();
}

function pruefeFelder(e: Record<string, unknown>): void {
	const unbekannt = Object.keys(e).filter((f) => !(ANGEBOT_VORLAGE_FELDER as readonly string[]).includes(f));
	if (unbekannt.length > 0) throw new ApiFehler(400, `Unbekanntes Feld: ${unbekannt[0]}`);
}

function nameFeld(w: unknown): string {
	const name = textFeld(w, 'Name', 100);
	if (name === null) throw new ApiFehler(400, 'Bitte einen Namen eingeben.');
	return name;
}

type Zeile = {
	katalog_position_id: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	menge: number;
	einheit: string;
	einzelpreis_cent: number | null;
};

/** Positionen prüfen; Katalogpositionen müssen zum Betrieb gehören (Vorschlag für Bezeichnung/Einheit aus dem Katalog). */
async function pruefePositionen(tx: TransactionSql, k: Kontext, eingabe: unknown): Promise<Zeile[]> {
	if (!Array.isArray(eingabe)) throw new ApiFehler(400, 'Positionen müssen eine Liste sein.');
	if (eingabe.length > MAX_POSITIONEN) throw new ApiFehler(400, `Höchstens ${MAX_POSITIONEN} Positionen je Vorlage.`);
	const ids = [
		...new Set(
			eingabe
				.map((p) => (p && typeof p === 'object' ? (p as PositionEingabe).katalogPositionId : null))
				.filter((x): x is string => typeof x === 'string' && x !== '')
		)
	];
	for (const id of ids) if (!UUID.test(id)) throw new ApiFehler(400, 'Katalogposition nicht gefunden.');
	const katalog = new Map<string, Record<string, any>>();
	if (ids.length > 0) {
		const z = await tx`
			select id, bezeichnung, beschreibung, einheit::text as einheit from app.katalog_positionen
			where betrieb_id = ${k.betriebId} and id = any(${ids.map((i) => i.toLowerCase())}::uuid[])`;
		for (const r of z) katalog.set(r.id, r);
	}
	return eingabe.map((roh, i) => {
		const fehler = (m: string) => new ApiFehler(400, `Position ${i + 1}: ${m}`);
		if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw fehler('ungültige Angabe.');
		const p = roh as PositionEingabe;
		const kid = typeof p.katalogPositionId === 'string' && p.katalogPositionId !== '' ? p.katalogPositionId.toLowerCase() : null;
		const kat = kid ? katalog.get(kid) : undefined;
		if (kid && !kat) throw fehler('Katalogposition nicht gefunden.');
		let bezeichnung: string | null;
		let beschreibung: string | null;
		let menge: number;
		let preis: number | null = null;
		try {
			bezeichnung = p.bezeichnung !== undefined && p.bezeichnung !== '' ? textFeld(p.bezeichnung, 'Bezeichnung', 200) : (kat?.bezeichnung ?? null);
			beschreibung = p.beschreibung !== undefined ? textFeld(p.beschreibung, 'Beschreibung', 2000) : (kat?.beschreibung ?? null);
			if (typeof p.menge !== 'string' && typeof p.menge !== 'number') throw new RangeError('Bitte eine Menge eingeben.');
			menge = leseMenge(p.menge);
			// Preis nur bei freien Positionen; bei Katalogpositionen gilt beim Einfügen der aktuelle Katalogpreis
			if (!kat && p.einzelpreis !== undefined && p.einzelpreis !== null && p.einzelpreis !== '') preis = leseEuroInCent(p.einzelpreis);
		} catch (e) {
			throw fehler((e as Error).message);
		}
		if (bezeichnung === null) throw fehler('Bitte eine Bezeichnung eingeben.');
		const einheit = p.einheit !== undefined && p.einheit !== '' ? p.einheit : kat?.einheit;
		if (!istEinheit(einheit)) throw fehler(`Bitte eine Einheit wählen (${EINHEITEN.join(', ')}).`);
		return { katalog_position_id: kid, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent: preis };
	});
}

async function positionenErsetzen(tx: TransactionSql, k: Kontext, id: string, zeilen: Zeile[]): Promise<void> {
	await tx`delete from app.angebot_vorlagen_positionen where vorlage_id = ${id} and betrieb_id = ${k.betriebId}`;
	if (zeilen.length === 0) return;
	await tx`
		insert into app.angebot_vorlagen_positionen ${tx(
			zeilen.map((z, i) => ({ betrieb_id: k.betriebId, vorlage_id: id, pos: i + 1, ...z })),
			'betrieb_id',
			'vorlage_id',
			'pos',
			'katalog_position_id',
			'bezeichnung',
			'beschreibung',
			'menge',
			'einheit',
			'einzelpreis_cent'
		)}`;
}

/** Positionen einer Vorlage samt aktuellem Katalogpreis (in der laufenden Transaktion; RLS grenzt auf den Betrieb ein). */
export async function ladeVorlagePositionen(tx: TransactionSql, k: Kontext, id: string): Promise<AngebotVorlagePosition[]> {
	const z = await tx`
		select p.pos, p.katalog_position_id, p.bezeichnung, p.beschreibung, p.menge::text as menge, p.einheit::text as einheit,
			p.einzelpreis_cent, k.lohn_cent + k.material_cent as katalog_preis
		from app.angebot_vorlagen_positionen p
		left join app.katalog_positionen k on k.id = p.katalog_position_id and k.betrieb_id = p.betrieb_id
		where p.vorlage_id = ${id} and p.betrieb_id = ${k.betriebId}
		order by p.pos`;
	return z.map((r) => ({
		pos: r.pos,
		katalogPositionId: r.katalog_position_id,
		bezeichnung: r.bezeichnung,
		beschreibung: r.beschreibung,
		menge: Number(r.menge),
		einheit: r.einheit,
		einzelpreisCent: r.einzelpreis_cent === null ? null : Number(r.einzelpreis_cent),
		katalogPreisCent: r.katalog_preis === null ? null : Number(r.katalog_preis)
	}));
}

async function ladeEine(tx: TransactionSql, k: Kontext, id: string): Promise<AngebotVorlage> {
	const [v] = await tx`
		select id, name, einleitung, schluss, angelegt, geaendert from app.angebot_vorlagen
		where id = ${id} and betrieb_id = ${k.betriebId}`;
	if (!v) throw nichtGefunden();
	return {
		id: v.id,
		name: v.name,
		einleitung: v.einleitung,
		schluss: v.schluss,
		positionen: await ladeVorlagePositionen(tx, k, id),
		angelegt: new Date(v.angelegt).toISOString(),
		geaendert: new Date(v.geaendert).toISOString()
	};
}

export async function listeAngebotVorlagen(k: Kontext): Promise<AngebotVorlageKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select v.id, v.name, v.geaendert,
				(select count(*)::int from app.angebot_vorlagen_positionen p where p.vorlage_id = v.id and p.betrieb_id = v.betrieb_id) as anzahl
			from app.angebot_vorlagen v where v.betrieb_id = ${k.betriebId}
			order by public.unaccent(lower(v.name)), v.id`;
		return z.map((r) => ({ id: r.id, name: r.name, anzahlPositionen: r.anzahl, geaendert: new Date(r.geaendert).toISOString() }));
	});
}

export async function holeAngebotVorlage(k: Kontext, id: string): Promise<AngebotVorlage> {
	const vid = pruefeVorlageId(id);
	return mitBetrieb(k, (tx) => ladeEine(tx, k, vid));
}

/** Neue Vorlage: `{ name, einleitung?, schluss?, positionen? }` (Positionen wie im Angebots-Editor). */
export async function legeAngebotVorlageAn(k: Kontext, e: AngebotVorlageEingabe): Promise<AngebotVorlage> {
	pruefeFelder(e as Record<string, unknown>);
	const name = nameFeld(e.name);
	const einleitung = textFeld(e.einleitung, 'Einleitung', 2000);
	const schluss = textFeld(e.schluss, 'Schlusstext', 2000);
	return mitBetrieb(k, async (tx) => {
		const zeilen = await pruefePositionen(tx, k, e.positionen ?? []);
		const [v] = await tx`
			insert into app.angebot_vorlagen (betrieb_id, name, einleitung, schluss)
			values (${k.betriebId}, ${name}, ${einleitung}, ${schluss}) returning id`;
		await positionenErsetzen(tx, k, v.id, zeilen);
		return ladeEine(tx, k, v.id);
	});
}

/** Ändern: angegebene Felder ersetzen die bisherigen; `positionen` ersetzt die ganze Liste. */
export async function aendereAngebotVorlage(k: Kontext, id: string, e: AngebotVorlageEingabe): Promise<AngebotVorlage> {
	const vid = pruefeVorlageId(id);
	pruefeFelder(e as Record<string, unknown>);
	const hat = (f: string) => Object.hasOwn(e, f);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select name, einleitung, schluss from app.angebot_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		const name = hat('name') ? nameFeld(e.name) : alt.name;
		const einleitung = hat('einleitung') ? textFeld(e.einleitung, 'Einleitung', 2000) : alt.einleitung;
		const schluss = hat('schluss') ? textFeld(e.schluss, 'Schlusstext', 2000) : alt.schluss;
		const zeilen = hat('positionen') ? await pruefePositionen(tx, k, e.positionen) : null;
		await tx`
			update app.angebot_vorlagen set name = ${name}, einleitung = ${einleitung}, schluss = ${schluss}
			where id = ${vid} and betrieb_id = ${k.betriebId}`;
		if (zeilen) await positionenErsetzen(tx, k, vid, zeilen);
		return ladeEine(tx, k, vid);
	});
}

export async function loescheAngebotVorlage(k: Kontext, id: string): Promise<void> {
	const vid = pruefeVorlageId(id);
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.angebot_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}
