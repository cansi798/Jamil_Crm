import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { likeMuster, sucheWoerter, textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { darf, darfEines } from './tarif';
import { leseEuroInCent } from '../geld';
import { EINHEITEN, GEWERK_NAMEN, GEWERKE, istEinheit, istGewerk, type Gewerk } from '../katalog-werte';

/**
 * Leistungskatalog eines Betriebs (Modul `katalog`). Lesen: `katalog.bearbeiten` oder `angebote.bearbeiten`;
 * ändern: `katalog.bearbeiten`. Preisfelder (`lohnCent`, `materialCent`, `einzelpreisCent`) gibt es nur mit
 * `preise.sehen` – ohne das Recht fehlen sie in jeder Antwort (nicht `null`), und Preise lassen sich nicht setzen.
 * Einzelpreis = Lohn + Material. Startvorlagen (ohne Preise) werden mit Preis 0 übernommen.
 */

export type KatalogPosition = {
	id: string;
	gewerk: Gewerk | null;
	nummer: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	einheit: string;
	aktiv: boolean;
	vorlageId: string | null;
	/** Arbeitszeit je Einheit in Minuten (null: bei „h“ gelten 60, sonst unbekannt) – kein Preis. */
	arbeitMinuten: number | null;
	lohnCent?: number;
	materialCent?: number;
	einzelpreisCent?: number;
};

export type KatalogFilter = { suche?: string; gewerk?: string; nurAktive?: boolean };

export type VorlagenGewerk = {
	gewerk: Gewerk;
	name: string;
	/** Vorlagen insgesamt. */
	anzahl: number;
	/** Davon noch nicht in den eigenen Katalog übernommen. */
	offen: number;
	vorlagen: { id: string; bezeichnung: string; beschreibung: string | null; einheit: string; uebernommen: boolean }[];
};

export const MAX_KATALOG = 500;
export const KATALOG_FELDER = ['gewerk', 'nummer', 'bezeichnung', 'beschreibung', 'einheit', 'arbeitMinuten', 'lohn', 'material', 'aktiv'] as const;
const PREIS_FELDER = ['lohn', 'material'] as const;

/** Felder der Katalog-Formulare (ohne „aktiv“): ohne `preise.sehen` gibt es keine Preisfelder (sonst 403). */
export function katalogFormFelder(nutzer: Nutzer | null): string[] {
	const mitPreisen = !!nutzer && hatRecht(nutzer, 'preise.sehen');
	return KATALOG_FELDER.filter((f) => f !== 'aktiv' && (mitPreisen || (f !== 'lohn' && f !== 'material')));
}

const nichtGefunden = () => new ApiFehler(404, 'Position nicht gefunden.');

/** Lesen: Modul `katalog` + (`katalog.bearbeiten` oder `angebote.bearbeiten`); liefert, ob Preise sichtbar sind. */
export async function katalogLesen(locals: { nutzer: Nutzer | null }): Promise<{ mitPreisen: boolean }> {
	await darfEines(locals, 'katalog', ['katalog.bearbeiten', 'angebote.bearbeiten']);
	return { mitPreisen: hatRecht(locals.nutzer!, 'preise.sehen') };
}

/** Ändern: Modul `katalog` + `katalog.bearbeiten`; liefert, ob Preise sichtbar (und setzbar) sind. */
export async function katalogAendern(locals: { nutzer: Nutzer | null }): Promise<{ mitPreisen: boolean }> {
	await darf(locals, 'katalog', 'katalog.bearbeiten');
	return { mitPreisen: hatRecht(locals.nutzer!, 'preise.sehen') };
}

function zuPosition(z: Record<string, any>, mitPreisen: boolean): KatalogPosition {
	const p: KatalogPosition = {
		id: z.id,
		gewerk: z.gewerk,
		nummer: z.nummer,
		bezeichnung: z.bezeichnung,
		beschreibung: z.beschreibung,
		einheit: z.einheit,
		aktiv: z.aktiv,
		vorlageId: z.vorlage_id,
		arbeitMinuten: z.arbeit_minuten === null || z.arbeit_minuten === undefined ? null : Number(z.arbeit_minuten)
	};
	if (mitPreisen) {
		p.lohnCent = Number(z.lohn_cent);
		p.materialCent = Number(z.material_cent);
		p.einzelpreisCent = Number(z.lohn_cent) + Number(z.material_cent);
	}
	return p;
}

const SPALTEN = `p.id, p.gewerk, p.nummer, p.bezeichnung, p.beschreibung, p.einheit::text as einheit, p.aktiv, p.vorlage_id,
	p.lohn_cent, p.material_cent, p.arbeit_minuten`;

const pruefeId = (id: string) => {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	return id.toLowerCase();
};

function pruefeGewerkFilter(w: string | undefined): Gewerk | undefined {
	if (w === undefined || w === '') return undefined;
	if (!istGewerk(w)) throw new ApiFehler(400, 'Unbekanntes Gewerk.');
	return w;
}

export async function listeKatalog(k: Kontext, filter: KatalogFilter, mitPreisen: boolean): Promise<KatalogPosition[]> {
	const muster = sucheWoerter(filter.suche).map(likeMuster);
	const gewerk = pruefeGewerkFilter(filter.gewerk);
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(SPALTEN)}
			from app.katalog_positionen p
			left join app.katalog_vorlagen v on v.id = p.vorlage_id
			where p.betrieb_id = ${k.betriebId}
				${gewerk ? tx`and p.gewerk = ${gewerk}` : tx``}
				${filter.nurAktive ? tx`and p.aktiv` : tx``}
				and not exists (
					select 1 from unnest(${muster}::text[]) as s(m)
					where not (
						lower(coalesce(p.nummer, '')) like lower(s.m)
						or lower(p.bezeichnung) like lower(s.m)
						or lower(coalesce(p.beschreibung, '')) like lower(s.m)
					)
				)
			order by array_position(${[...GEWERKE]}::text[], p.gewerk) nulls last, p.nummer nulls last,
				coalesce(v.sortierung, 32767), public.unaccent(lower(p.bezeichnung)), p.id
			limit ${MAX_KATALOG}`;
		return z.map((r) => zuPosition(r, mitPreisen));
	});
}

async function ladeEine(tx: TransactionSql, k: Kontext, id: string, mitPreisen: boolean): Promise<KatalogPosition> {
	const [z] = await tx`
		select ${tx.unsafe(SPALTEN)} from app.katalog_positionen p where p.id = ${id} and p.betrieb_id = ${k.betriebId}`;
	if (!z) throw nichtGefunden();
	return zuPosition(z, mitPreisen);
}

export async function holePosition(k: Kontext, id: string, mitPreisen: boolean): Promise<KatalogPosition> {
	const pid = pruefeId(id);
	return mitBetrieb(k, (tx) => ladeEine(tx, k, pid, mitPreisen));
}

function euroFeld(w: unknown, name: string): number {
	if (w === undefined || w === null || w === '') return 0;
	if (typeof w !== 'string' && typeof w !== 'number') throw new ApiFehler(400, `${name}: Bitte einen Betrag eingeben.`);
	try {
		return leseEuroInCent(w);
	} catch (e) {
		throw new ApiFehler(400, `${name}: ${(e as Error).message}`);
	}
}

/** Arbeitszeit in Minuten je Einheit: leer → null, sonst 0–100.000 mit höchstens 2 Nachkommastellen („7,5“). */
function minutenFeld(w: unknown): number | null {
	if (w === undefined || w === null || w === '') return null;
	const t = typeof w === 'number' ? String(w) : typeof w === 'string' ? w.trim().replace(',', '.') : '';
	if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > 100000) {
		throw new ApiFehler(400, 'Arbeitszeit: Bitte Minuten je Einheit angeben (z. B. 30 oder 7,5).');
	}
	return Number(t);
}

function aktivFeld(w: unknown): boolean {
	if (typeof w === 'boolean') return w;
	if (w === 'on' || w === 'true' || w === '1') return true;
	if (w === 'false' || w === '0' || w === '' || w === undefined || w === null) return false;
	throw new ApiFehler(400, 'Ungültige Angabe für „aktiv“.');
}

type Werte = {
	gewerk: Gewerk | null;
	nummer: string | null;
	bezeichnung: string;
	beschreibung: string | null;
	einheit: string;
	arbeit_minuten: number | null;
	lohn_cent: number;
	material_cent: number;
	aktiv: boolean;
};

/** Prüft einen vollständigen Satz Werte (400 mit deutscher Meldung). */
function pruefeWerte(e: Record<string, unknown>, bisher?: Werte): Werte {
	const hat = (f: string) => Object.hasOwn(e, f);
	const bezeichnung = hat('bezeichnung') ? textFeld(e.bezeichnung, 'Bezeichnung', 200) : (bisher?.bezeichnung ?? null);
	if (bezeichnung === null) throw new ApiFehler(400, 'Bitte eine Bezeichnung eingeben.');
	const einheit = hat('einheit') ? e.einheit : bisher?.einheit;
	if (!istEinheit(einheit)) throw new ApiFehler(400, `Bitte eine Einheit wählen (${EINHEITEN.join(', ')}).`);
	let gewerk: Gewerk | null = bisher?.gewerk ?? null;
	if (hat('gewerk')) {
		if (e.gewerk === null || e.gewerk === '' || e.gewerk === undefined) gewerk = null;
		else if (istGewerk(e.gewerk)) gewerk = e.gewerk;
		else throw new ApiFehler(400, 'Unbekanntes Gewerk.');
	}
	return {
		gewerk,
		nummer: hat('nummer') ? textFeld(e.nummer, 'Nummer', 20) : (bisher?.nummer ?? null),
		bezeichnung,
		beschreibung: hat('beschreibung') ? textFeld(e.beschreibung, 'Beschreibung', 2000) : (bisher?.beschreibung ?? null),
		einheit,
		arbeit_minuten: hat('arbeitMinuten') ? minutenFeld(e.arbeitMinuten) : (bisher?.arbeit_minuten ?? null),
		lohn_cent: hat('lohn') ? euroFeld(e.lohn, 'Lohn') : (bisher?.lohn_cent ?? 0),
		material_cent: hat('material') ? euroFeld(e.material, 'Material') : (bisher?.material_cent ?? 0),
		aktiv: hat('aktiv') ? aktivFeld(e.aktiv) : (bisher?.aktiv ?? true)
	};
}

function pruefePreisRecht(e: Record<string, unknown>, mitPreisen: boolean): void {
	if (!mitPreisen && PREIS_FELDER.some((f) => Object.hasOwn(e, f))) {
		throw new ApiFehler(403, 'Keine Berechtigung für Preise');
	}
}

/** Neue Position: `{ bezeichnung, einheit, gewerk?, nummer?, beschreibung?, lohn?, material?, aktiv? }` (Beträge in Euro). */
export async function legePositionAn(k: Kontext, e: Record<string, unknown>, mitPreisen = true): Promise<KatalogPosition> {
	pruefePreisRecht(e, mitPreisen);
	const w = pruefeWerte(e);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			insert into app.katalog_positionen
				(betrieb_id, gewerk, nummer, bezeichnung, beschreibung, einheit, arbeit_minuten, lohn_cent, material_cent, aktiv)
			values (${k.betriebId}, ${w.gewerk}, ${w.nummer}, ${w.bezeichnung}, ${w.beschreibung}, ${w.einheit},
				${w.arbeit_minuten}, ${w.lohn_cent}, ${w.material_cent}, ${w.aktiv})
			returning id`;
		return ladeEine(tx, k, z.id, mitPreisen);
	});
}

/** Teiländerung (angegebene Felder ersetzen die bisherigen; geprüft wird das Ergebnis als Ganzes). */
export async function aenderePosition(
	k: Kontext,
	id: string,
	e: Record<string, unknown>,
	mitPreisen = true
): Promise<KatalogPosition> {
	const pid = pruefeId(id);
	if (!KATALOG_FELDER.some((f) => Object.hasOwn(e, f))) throw new ApiFehler(400, 'Nichts zu ändern.');
	pruefePreisRecht(e, mitPreisen);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select gewerk, nummer, bezeichnung, beschreibung, einheit::text as einheit, arbeit_minuten, lohn_cent, material_cent, aktiv
			from app.katalog_positionen where id = ${pid} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		const w = pruefeWerte(e, {
			...(alt as unknown as Werte),
			arbeit_minuten: alt.arbeit_minuten === null ? null : Number(alt.arbeit_minuten),
			lohn_cent: Number(alt.lohn_cent),
			material_cent: Number(alt.material_cent)
		});
		await tx`
			update app.katalog_positionen set gewerk = ${w.gewerk}, nummer = ${w.nummer}, bezeichnung = ${w.bezeichnung},
				beschreibung = ${w.beschreibung}, einheit = ${w.einheit}, arbeit_minuten = ${w.arbeit_minuten}, lohn_cent = ${w.lohn_cent},
				material_cent = ${w.material_cent}, aktiv = ${w.aktiv}
			where id = ${pid} and betrieb_id = ${k.betriebId}`;
		return ladeEine(tx, k, pid, mitPreisen);
	});
}

/**
 * „Löschen“ einer Katalogposition: Ist sie in einem Angebot verwendet, wird sie nur deaktiviert (`aktiv = false`,
 * erscheint nicht mehr in der Auswahl), sonst endgültig gelöscht.
 */
export async function deaktivierePosition(k: Kontext, id: string): Promise<'geloescht' | 'deaktiviert'> {
	const pid = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		// FOR UPDATE wartet auf gleichzeitige Angebotspositionen, die diese Zeile gerade (FOR KEY SHARE) verwenden
		const [da] = await tx`
			select id from app.katalog_positionen where id = ${pid} and betrieb_id = ${k.betriebId} for update`;
		if (!da) throw nichtGefunden();
		const [benutzt] = await tx`
			select 1 from app.angebot_positionen where katalog_position_id = ${pid} and betrieb_id = ${k.betriebId} limit 1`;
		if (benutzt) {
			await tx`update app.katalog_positionen set aktiv = false where id = ${pid} and betrieb_id = ${k.betriebId}`;
			return 'deaktiviert';
		}
		await tx`delete from app.katalog_positionen where id = ${pid} and betrieb_id = ${k.betriebId}`;
		return 'geloescht';
	});
}

/** Alle Startvorlagen je Gewerk, mit „schon übernommen“ für den Betrieb. */
export async function listeVorlagen(k: Kontext): Promise<VorlagenGewerk[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select v.id, v.gewerk, v.bezeichnung, v.beschreibung, v.einheit::text as einheit,
				exists (select 1 from app.katalog_positionen p where p.vorlage_id = v.id and p.betrieb_id = ${k.betriebId}) as uebernommen
			from app.katalog_vorlagen v
			order by v.gewerk, v.sortierung, v.bezeichnung`;
		return GEWERKE.map((g) => {
			const vorlagen = z
				.filter((r) => r.gewerk === g)
				.map((r) => ({ id: r.id, bezeichnung: r.bezeichnung, beschreibung: r.beschreibung, einheit: r.einheit, uebernommen: r.uebernommen }));
			return {
				gewerk: g,
				name: GEWERK_NAMEN[g],
				anzahl: vorlagen.length,
				offen: vorlagen.filter((v) => !v.uebernommen).length,
				vorlagen
			};
		});
	});
}

/** Übernimmt alle noch nicht übernommenen Vorlagen des Gewerks mit Preis 0 in den Katalog des Betriebs. */
export async function uebernimmVorlagen(k: Kontext, gewerk: unknown): Promise<{ gewerk: Gewerk; neu: number }> {
	if (!istGewerk(gewerk)) throw new ApiFehler(400, 'Unbekanntes Gewerk.');
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, beschreibung, einheit, vorlage_id)
			select ${k.betriebId}, v.gewerk, v.bezeichnung, v.beschreibung, v.einheit, v.id
			from app.katalog_vorlagen v
			where v.gewerk = ${gewerk}
			order by v.sortierung
			on conflict (betrieb_id, vorlage_id) do nothing
			returning id`;
		return { gewerk, neu: z.length };
	});
}
