import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { UUID } from './kunden';
import { holeAuftrag, kundeNameAus, type Sicht } from './auftraege';
import { pruefeBild } from './bildpruefung';
import { bereinigeDateiname } from './kundenakte';
import { holeLogo, holeProfil } from './betriebsprofil';
import { formularProtokollPdf, type PdfBild } from './pdf/formular-protokoll-pdf';
import {
	alleFelder,
	auswerten,
	berechne,
	expandiere,
	bereinigeAntworten,
	dateiIds,
	fehlendeFelder,
	GRENZEN,
	pruefeSchema,
	SchemaFehler,
	type Antworten,
	type Feld,
	type Schema
} from '../protokoll-formular';
import { STARTVORLAGEN } from '../protokoll-startvorlagen';
import { berlinTag } from '../zeit';
import type { VerlaufZeile } from '../verlauf';

/**
 * Frei gestaltbare Protokolle (Wunsch Jamil, Talk msg 2649; Migration 040).
 *
 * Vorlagen sind versioniert: Jede Zeile in `app.protokoll_vorlagen` ist eine unveränderliche Version; „Speichern“ legt
 * die nächste Version derselben Gruppe an. Ausgefüllte Protokolle zeigen auf ihre Version und bleiben so lesbar, auch
 * wenn die Vorlage später geändert wird.
 *
 * Rechte prüfen die Aufrufer (Seiten/API): Vorlagen gestalten `protokolle.vorlagen_bearbeiten`, Protokolle ausfüllen
 * `protokolle.ausfuellen` (oder `protokolle.bearbeiten`), ansehen zusätzlich `protokolle.lesen`. Sichtbarkeit wie der
 * Auftrag (`Sicht`): Wer nur eigene Aufträge sieht, sieht nur deren Protokolle – sonst 404.
 */

export const FOTO_MAX_BYTES = 10 * 1024 * 1024;
export const UNTERSCHRIFT_MAX_BYTES = 512 * 1000;

/** Art einer Vorlage: Protokoll oder Aufmaß (msg 2842). */
export const VORLAGEN_ARTEN = ['protokoll', 'aufmass'] as const;
export type VorlagenArt = (typeof VORLAGEN_ARTEN)[number];
export const istVorlagenArt = (w: unknown): w is VorlagenArt => typeof w === 'string' && (VORLAGEN_ARTEN as readonly string[]).includes(w);

export type VorlageKurz = {
	id: string;
	art: VorlagenArt;
	gruppeId: string;
	version: number;
	name: string;
	beschreibung: string | null;
	archiviert: boolean;
	geaendert: string;
	seiten: number;
	felder: number;
	protokolle: number;
};

export type Vorlage = VorlageKurz & { schema: Schema; aktuell: boolean };

export type ProtokollKurz = {
	id: string;
	titel: string;
	vorlageId: string;
	version: number;
	status: 'entwurf' | 'abgeschlossen';
	auftragId: string | null;
	angelegt: string;
	geaendert: string;
	abgeschlossen: string | null;
	vonName: string | null;
	abgeschlossenVonName: string | null;
	unterschriebenVon: string | null;
	pdfDateiId: string | null;
};

export type ProtokollDatei = { id: string; feldId: string; art: 'foto' | 'unterschrift'; name: string; typ: string; groesse: number };

export type Protokoll = ProtokollKurz & {
	/** Art der Vorlage (Aufmaß: Mengen fürs Angebot, msg 2842) */
	art: VorlagenArt;
	schema: Schema;
	antworten: Antworten;
	schritt: number;
	objektId: string | null;
	anlageId: string | null;
	auftrag: { id: string; nummer: string; titel: string; kundeName: string } | null;
	dateien: ProtokollDatei[];
};

const nichtGefunden = (was = 'Protokoll') => new ApiFehler(404, `${was} nicht gefunden.`);

function idFeld(id: unknown, was: string): string {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden(was);
	return id.trim().toLowerCase();
}

function textFeld(w: unknown, was: string, max: number, pflicht: boolean): string | null {
	if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) {
		if (pflicht) throw new ApiFehler(400, `${was} fehlt.`);
		return null;
	}
	if (typeof w !== 'string') throw new ApiFehler(400, `${was}: ungültig.`);
	const t = w.replaceAll('\u0000', '').trim();
	if ([...t].length > max) throw new ApiFehler(400, `${was} ist zu lang (höchstens ${max} Zeichen).`);
	return t;
}

/** Schema prüfen; Fehler als 400 mit der Meldung für den Baukasten. */
export function pruefeVorlagenSchema(roh: unknown): Schema {
	try {
		return pruefeSchema(roh);
	} catch (e) {
		if (e instanceof SchemaFehler) throw new ApiFehler(400, e.message);
		throw e;
	}
}

/** JSON mit sortierten Schlüsseln (jsonb ordnet Schlüssel um) – zum Vergleichen. */
const geordnet = (w: unknown): string =>
	JSON.stringify(w, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

const zaehle = (s: Schema) => ({ seiten: s.seiten.length, felder: alleFelder(s).length });

function zuVorlage(z: Record<string, any>): Vorlage {
	const schema = z.schema as Schema;
	return {
		id: z.id,
		art: z.art ?? 'protokoll',
		gruppeId: z.gruppe_id,
		version: z.version,
		name: z.name,
		beschreibung: z.beschreibung,
		archiviert: z.archiviert,
		aktuell: z.aktuell,
		geaendert: new Date(z.geaendert).toISOString(),
		protokolle: Number(z.protokolle ?? 0),
		schema,
		...zaehle(schema)
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Vorlagen

/** Aktuelle Version jeder Vorlage (ohne archivierte, außer `archivierte`), nach Name. */
export async function listeVorlagen(k: Kontext, opts: { archivierte?: boolean; art?: VorlagenArt } = {}): Promise<VorlageKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select v.*, (select count(*) from app.protokolle p join app.protokoll_vorlagen pv on pv.id = p.vorlage_id
				where pv.gruppe_id = v.gruppe_id and p.betrieb_id = v.betrieb_id) as protokolle
			from app.protokoll_vorlagen v
			where v.betrieb_id = ${k.betriebId} and v.aktuell ${opts.archivierte ? tx`` : tx`and not v.archiviert`}
				${opts.art ? tx`and v.art = ${opts.art}` : tx``}
			order by v.archiviert, lower(v.name), v.id`;
		return z.map((r) => {
			const { schema: _s, aktuell: _a, ...kurz } = zuVorlage(r);
			return kurz;
		});
	});
}

/** Eine Version (auch ältere – für ausgefüllte Protokolle). */
export async function holeVorlage(k: Kontext, id: unknown): Promise<Vorlage> {
	const vid = idFeld(id, 'Vorlage');
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select v.*, (select count(*) from app.protokolle p join app.protokoll_vorlagen pv on pv.id = p.vorlage_id
				where pv.gruppe_id = v.gruppe_id and p.betrieb_id = v.betrieb_id) as protokolle
			from app.protokoll_vorlagen v where v.id = ${vid} and v.betrieb_id = ${k.betriebId}`;
		if (!z) throw nichtGefunden('Vorlage');
		return zuVorlage(z);
	});
}

type VorlagenEingabe = { name?: unknown; beschreibung?: unknown; schema?: unknown; art?: unknown };

function pruefeVorlagenEingabe(e: VorlagenEingabe) {
	if (e.art !== undefined && e.art !== null && e.art !== '' && !istVorlagenArt(e.art)) throw new ApiFehler(400, 'Unbekannte Art der Vorlage.');
	return {
		art: (istVorlagenArt(e.art) ? e.art : 'protokoll') as VorlagenArt,
		name: textFeld(e.name, 'Name', 200, true)!,
		beschreibung: textFeld(e.beschreibung, 'Beschreibung', 1000, false),
		schema: pruefeVorlagenSchema(e.schema)
	};
}

async function fuegeEin(tx: TransactionSql, k: Kontext, gruppeId: string | null, version: number, w: ReturnType<typeof pruefeVorlagenEingabe>) {
	const [z] = await tx`
		insert into app.protokoll_vorlagen (betrieb_id, gruppe_id, version, name, beschreibung, schema, von_benutzer_id, art)
		values (${k.betriebId}, ${gruppeId ?? tx`gen_random_uuid()`}, ${version}, ${w.name}, ${w.beschreibung},
			${tx.json(w.schema as never)}, ${k.benutzerId}, ${w.art})
		returning id`;
	return z.id as string;
}

/** Neue Vorlage (Version 1). */
export async function legeVorlageAn(k: Kontext, e: VorlagenEingabe): Promise<Vorlage> {
	const w = pruefeVorlagenEingabe(e);
	const id = await mitBetrieb(k, (tx) => fuegeEin(tx, k, null, 1, w));
	return holeVorlage(k, id);
}

/**
 * Speichert Änderungen als neue Version. `id` muss die aktuelle Version sein (sonst 409: Jemand hat inzwischen
 * gespeichert). Unverändert → keine neue Version.
 */
export async function speichereVorlage(k: Kontext, id: unknown, e: VorlagenEingabe): Promise<Vorlage> {
	const vid = idFeld(id, 'Vorlage');
	const w = pruefeVorlagenEingabe(e);
	const neueId = await mitBetrieb(k, async (tx) => {
		const [alt] = await tx`
			select id, gruppe_id, version, name, beschreibung, schema, aktuell, archiviert, art from app.protokoll_vorlagen
			where id = ${vid} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden('Vorlage');
		// Die Art bleibt über alle Versionen gleich
		w.art = alt.art;
		if (!alt.aktuell) throw new ApiFehler(409, 'Diese Version ist nicht mehr aktuell – bitte die Seite neu laden.');
		if (alt.name === w.name && alt.beschreibung === w.beschreibung && geordnet(alt.schema) === geordnet(w.schema)) {
			return alt.id as string;
		}
		const [{ max }] = await tx`select max(version) as max from app.protokoll_vorlagen where gruppe_id = ${alt.gruppe_id} and betrieb_id = ${k.betriebId}`;
		await tx`update app.protokoll_vorlagen set aktuell = false where id = ${alt.id}`;
		const id = await fuegeEin(tx, k, alt.gruppe_id, Number(max) + 1, w);
		if (alt.archiviert) await tx`update app.protokoll_vorlagen set archiviert = true where id = ${id}`;
		return id;
	});
	return holeVorlage(k, neueId);
}

/** Kopie als neue Vorlage („… (Kopie)“, Version 1). */
export async function dupliziereVorlage(k: Kontext, id: unknown): Promise<Vorlage> {
	const v = await holeVorlage(k, id);
	const name = [...`${v.name} (Kopie)`].slice(0, 200).join('');
	return legeVorlageAn(k, { name, beschreibung: v.beschreibung, schema: v.schema, art: v.art });
}

/** Archivieren bzw. wiederherstellen (aktuelle Version). Archivierte Vorlagen lassen sich nicht mehr starten. */
export async function archiviereVorlage(k: Kontext, id: unknown, archiviert: boolean): Promise<void> {
	const vid = idFeld(id, 'Vorlage');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			update app.protokoll_vorlagen set archiviert = ${archiviert}
			where id = ${vid} and betrieb_id = ${k.betriebId} and aktuell returning id`;
		if (z.length === 0) throw nichtGefunden('Vorlage');
	});
}

/** Beispielvorlagen übernehmen (nur die, deren Name es im Betrieb noch nicht gibt). Liefert die Anzahl neuer. */
export async function uebernimmStartvorlagen(k: Kontext, schluessel?: string[]): Promise<number> {
	return mitBetrieb(k, async (tx) => {
		let neu = 0;
		for (const s of STARTVORLAGEN) {
			if (schluessel && !schluessel.includes(s.schluessel)) continue;
			const [da] = await tx`select 1 from app.protokoll_vorlagen where betrieb_id = ${k.betriebId} and lower(name) = lower(${s.name})`;
			if (da) continue;
			await fuegeEin(tx, k, null, 1, { name: s.name, beschreibung: s.beschreibung, schema: pruefeSchema(s.schema), art: s.art ?? 'protokoll' });
			neu++;
		}
		return neu;
	});
}

// ---------------------------------------------------------------------------------------------------------------
// Protokolle

const PROTOKOLL_SPALTEN = `
	p.id, p.titel, p.vorlage_id, v.version, p.status, p.auftrag_id, p.objekt_id, p.anlage_id, p.angelegt, p.geaendert,
	p.abgeschlossen, p.unterschrieben_von, p.pdf_datei_id, p.schritt, b1.name as von_name, b2.name as abgeschlossen_von_name`;
const PROTOKOLL_VON = `
	app.protokolle p
	join app.protokoll_vorlagen v on v.id = p.vorlage_id and v.betrieb_id = p.betrieb_id
	left join app.benutzer b1 on b1.id = p.von_benutzer_id and b1.betrieb_id = p.betrieb_id
	left join app.benutzer b2 on b2.id = p.abgeschlossen_von and b2.betrieb_id = p.betrieb_id`;

function zuKurz(z: Record<string, any>): ProtokollKurz {
	return {
		id: z.id,
		titel: z.titel,
		vorlageId: z.vorlage_id,
		version: z.version,
		status: z.status,
		auftragId: z.auftrag_id,
		angelegt: new Date(z.angelegt).toISOString(),
		geaendert: new Date(z.geaendert).toISOString(),
		abgeschlossen: z.abgeschlossen ? new Date(z.abgeschlossen).toISOString() : null,
		vonName: z.von_name ?? null,
		abgeschlossenVonName: z.abgeschlossen_von_name ?? null,
		unterschriebenVon: z.unterschrieben_von ?? null,
		pdfDateiId: z.pdf_datei_id ?? null
	};
}

/** Protokolle eines Auftrags (der Aufrufer hat die Sichtbarkeit des Auftrags geprüft), neueste zuerst. */
export async function listeProtokolle(k: Kontext, filter: { auftragId: string }): Promise<ProtokollKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select ${tx.unsafe(PROTOKOLL_SPALTEN)} from ${tx.unsafe(PROTOKOLL_VON)}
			where p.betrieb_id = ${k.betriebId} and p.auftrag_id = ${filter.auftragId}
			order by p.angelegt desc, p.id`;
		return z.map(zuKurz);
	});
}

/** Sichtbarkeit: mit Auftrag wie der Auftrag (404), ohne Auftrag nur, wer alle Aufträge sieht. */
async function pruefeSicht(k: Kontext, sicht: Sicht, auftragId: string | null): Promise<void> {
	if (auftragId) {
		try {
			await holeAuftrag(k, sicht, auftragId);
		} catch (e) {
			if (e instanceof ApiFehler && e.status === 404) throw nichtGefunden();
			throw e;
		}
	} else if (!sicht.alle) throw nichtGefunden();
}

/** Ein Protokoll mit Vorlage (seiner Version), Antworten, Auftrag und Dateien (ohne Inhalt). */
export async function holeProtokoll(k: Kontext, sicht: Sicht, id: unknown): Promise<Protokoll> {
	const pid = idFeld(id, 'Protokoll');
	const p = await mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select ${tx.unsafe(PROTOKOLL_SPALTEN)}, p.antworten, v.schema, v.art
			from ${tx.unsafe(PROTOKOLL_VON)} where p.id = ${pid} and p.betrieb_id = ${k.betriebId}`;
		if (!z) throw nichtGefunden();
		const dateien = await tx`
			select id, feld_id, art, name, typ, groesse from app.protokoll_dateien
			where protokoll_id = ${pid} and betrieb_id = ${k.betriebId} order by angelegt, id`;
		let auftrag: Protokoll['auftrag'] = null;
		if (z.auftrag_id) {
			const [a] = await tx`
				select a.id, a.nummer, a.titel, k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname,
					k.nachname as kunde_nachname, a.einmal_name
				from app.auftraege a left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
				where a.id = ${z.auftrag_id} and a.betrieb_id = ${k.betriebId}`;
			if (a) auftrag = { id: a.id, nummer: a.nummer, titel: a.titel, kundeName: kundeNameAus(a) };
		}
		return {
			...zuKurz(z),
			art: z.art ?? 'protokoll',
			schema: z.schema as Schema,
			antworten: (z.antworten ?? {}) as Antworten,
			schritt: z.schritt,
			objektId: z.objekt_id,
			anlageId: z.anlage_id,
			auftrag,
			dateien: dateien.map((d) => ({ id: d.id, feldId: d.feld_id, art: d.art, name: d.name, typ: d.typ, groesse: d.groesse }))
		} satisfies Protokoll;
	});
	await pruefeSicht(k, sicht, p.auftragId);
	return p;
}

/** Heutiges Datum in leere Datumsfelder der ersten Seite (Bequemlichkeit beim Start). */
function vorbelegen(schema: Schema): Antworten {
	const a: Antworten = {};
	for (const { feld, seite } of alleFelder(schema)) {
		if (seite === 0 && feld.typ === 'datum' && !feld.bedingung) a[feld.id] = berlinTag(new Date());
	}
	return a;
}

/**
 * Startet ein Protokoll aus der aktuellen Version einer (nicht archivierten) Vorlage zu einem Auftrag, den der Nutzer
 * sieht. Objekt und Anlage übernimmt es vom Auftrag.
 */
export async function starteProtokoll(k: Kontext, sicht: Sicht, e: { vorlageId: unknown; auftragId: unknown }): Promise<ProtokollKurz> {
	const vid = idFeld(e.vorlageId, 'Vorlage');
	const aid = idFeld(e.auftragId, 'Auftrag');
	const auftrag = await holeAuftrag(k, sicht, aid);
	const id = await mitBetrieb(k, async (tx) => {
		const [v] = await tx`
			select id, name, schema, aktuell, archiviert from app.protokoll_vorlagen
			where id = ${vid} and betrieb_id = ${k.betriebId} for key share`;
		if (!v) throw nichtGefunden('Vorlage');
		if (!v.aktuell || v.archiviert) throw new ApiFehler(400, 'Diese Vorlage ist archiviert oder veraltet.');
		const [z] = await tx`
			insert into app.protokolle (betrieb_id, vorlage_id, titel, auftrag_id, objekt_id, anlage_id, antworten, von_benutzer_id)
			values (${k.betriebId}, ${v.id}, ${v.name}, ${auftrag.id}, ${auftrag.objektId}, ${auftrag.anlageId},
				${tx.json(vorbelegen(v.schema) as never)}, ${k.benutzerId})
			returning id`;
		return z.id as string;
	});
	const [kurz] = (await listeProtokolle(k, { auftragId: auftrag.id })).filter((p) => p.id === id);
	return kurz;
}

/** Zeile sperren und prüfen: gibt es, sichtbar, noch Entwurf. */
async function sperreEntwurf(tx: TransactionSql, k: Kontext, pid: string) {
	const [z] = await tx`
		select p.id, p.status, p.antworten, p.auftrag_id, v.schema from app.protokolle p
		join app.protokoll_vorlagen v on v.id = p.vorlage_id and v.betrieb_id = p.betrieb_id
		where p.id = ${pid} and p.betrieb_id = ${k.betriebId} for update of p`;
	if (!z) throw nichtGefunden();
	if (z.status !== 'entwurf') throw new ApiFehler(409, 'Das Protokoll ist abgeschlossen und kann nicht mehr geändert werden.');
	return { schema: z.schema as Schema, antworten: (z.antworten ?? {}) as Antworten };
}

async function sichtVonProtokoll(k: Kontext, sicht: Sicht, pid: string): Promise<void> {
	const [z] = await mitBetrieb(k, (tx) => tx`select auftrag_id from app.protokolle where id = ${pid} and betrieb_id = ${k.betriebId}`);
	if (!z) throw nichtGefunden();
	await pruefeSicht(k, sicht, z.auftrag_id);
}

/** Zwischenspeichern (Autospeichern des Assistenten): Antworten bereinigt, Dateien-Felder bleiben vom Server. */
export async function speichereAntworten(k: Kontext, sicht: Sicht, id: unknown, roh: unknown, schritt?: unknown): Promise<Antworten> {
	const pid = idFeld(id, 'Protokoll');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const { schema, antworten } = await sperreEntwurf(tx, k, pid);
		const neu = bereinigeAntworten(schema, roh, antworten);
		const s = typeof schritt === 'number' && Number.isInteger(schritt) && schritt >= 0 && schritt < schema.seiten.length ? schritt : null;
		await tx`update app.protokolle set antworten = ${tx.json(neu as never)} ${s === null ? tx`` : tx`, schritt = ${s}`} where id = ${pid}`;
		return neu;
	});
}

function feldVon(schema: Schema, feldId: unknown, typ: Feld['typ']): Feld {
	const f = alleFelder(schema).find((x) => x.feld.id === feldId)?.feld;
	if (!f || f.typ !== typ) throw new ApiFehler(400, 'Unbekanntes Feld.');
	return f;
}

/** Foto zu einem Fotofeld (JPEG/PNG, vollständig geprüft, max. 10 MB, höchstens 20 je Feld). */
export async function speichereFoto(
	k: Kontext,
	sicht: Sicht,
	id: unknown,
	feldId: unknown,
	datei: { name: string; inhalt: Uint8Array }
): Promise<{ datei: ProtokollDatei; antworten: Antworten }> {
	const pid = idFeld(id, 'Protokoll');
	if (datei.inhalt.byteLength === 0) throw new ApiFehler(400, 'Das Foto ist leer.');
	if (datei.inhalt.byteLength > FOTO_MAX_BYTES) throw new ApiFehler(413, 'Das Foto ist zu groß (höchstens 10 MB).');
	const bild = pruefeBild(datei.inhalt);
	if (!bild) throw new ApiFehler(400, 'Bitte ein Foto als JPEG oder PNG senden.');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const { schema, antworten } = await sperreEntwurf(tx, k, pid);
		const feld = feldVon(expandiere(schema, antworten), feldId, 'foto');
		const bisher = dateiIds(feld, antworten[feld.id]);
		if (bisher.length >= GRENZEN.fotos) throw new ApiFehler(400, `Höchstens ${GRENZEN.fotos} Fotos je Feld.`);
		const [d] = await tx`
			insert into app.protokoll_dateien (betrieb_id, protokoll_id, feld_id, art, name, typ, groesse, inhalt, von_benutzer_id)
			values (${k.betriebId}, ${pid}, ${feld.id}, 'foto', ${bereinigeDateiname(datei.name || 'foto.jpg')}, ${bild.typ},
				${datei.inhalt.byteLength}, ${Buffer.from(datei.inhalt)}, ${k.benutzerId})
			returning id, feld_id, art, name, typ, groesse`;
		const neu = { ...antworten, [feld.id]: [...bisher, d.id] };
		await tx`update app.protokolle set antworten = ${tx.json(neu as never)} where id = ${pid}`;
		return { datei: { id: d.id, feldId: d.feld_id, art: d.art, name: d.name, typ: d.typ, groesse: d.groesse }, antworten: neu };
	});
}

/** Foto bzw. Unterschrift wieder entfernen (nur im Entwurf). */
export async function loescheProtokollDatei(k: Kontext, sicht: Sicht, id: unknown, dateiId: unknown): Promise<Antworten> {
	const pid = idFeld(id, 'Protokoll');
	const did = idFeld(dateiId, 'Datei');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const { schema, antworten } = await sperreEntwurf(tx, k, pid);
		const [d] = await tx`delete from app.protokoll_dateien where id = ${did} and protokoll_id = ${pid} and betrieb_id = ${k.betriebId} returning feld_id`;
		if (!d) throw nichtGefunden('Datei');
		const feld = alleFelder(expandiere(schema, antworten)).find((x) => x.feld.id === d.feld_id)?.feld;
		const neu = { ...antworten };
		if (feld?.typ === 'foto') {
			const rest = dateiIds(feld, neu[feld.id]).filter((x) => x !== did);
			if (rest.length > 0) neu[feld.id] = rest;
			else delete neu[feld.id];
		} else if (feld) delete neu[feld.id];
		await tx`update app.protokolle set antworten = ${tx.json(neu as never)} where id = ${pid}`;
		return neu;
	});
}

/** Unterschrift (PNG vom Unterschriftsfeld, max. 500 KB) mit Namen; ersetzt eine frühere im selben Feld. */
export async function speichereUnterschrift(
	k: Kontext,
	sicht: Sicht,
	id: unknown,
	feldId: unknown,
	png: Uint8Array,
	nameRoh: unknown
): Promise<Antworten> {
	const pid = idFeld(id, 'Protokoll');
	if (png.byteLength > UNTERSCHRIFT_MAX_BYTES) throw new ApiFehler(413, 'Die Unterschrift ist zu groß (max. 500 KB).');
	if (pruefeBild(png)?.typ !== 'image/png') throw new ApiFehler(400, 'Die Unterschrift ist kein gültiges Bild.');
	const name = textFeld(nameRoh, 'Name', 200, true)!;
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const { schema, antworten } = await sperreEntwurf(tx, k, pid);
		const feld = feldVon(expandiere(schema, antworten), feldId, 'unterschrift');
		await tx`delete from app.protokoll_dateien where protokoll_id = ${pid} and betrieb_id = ${k.betriebId} and feld_id = ${feld.id}`;
		const [d] = await tx`
			insert into app.protokoll_dateien (betrieb_id, protokoll_id, feld_id, art, name, typ, groesse, inhalt, von_benutzer_id)
			values (${k.betriebId}, ${pid}, ${feld.id}, 'unterschrift', 'unterschrift.png', 'image/png', ${png.byteLength},
				${Buffer.from(png)}, ${k.benutzerId})
			returning id`;
		const neu = { ...antworten, [feld.id]: { dateiId: d.id, name, zeit: new Date().toISOString() } };
		await tx`update app.protokolle set antworten = ${tx.json(neu as never)} where id = ${pid}`;
		return neu;
	});
}

/** Foto/Unterschrift mit Inhalt (Anzeige im Assistenten, PDF). */
export async function holeProtokollDatei(k: Kontext, sicht: Sicht, id: unknown, dateiId: unknown): Promise<ProtokollDatei & { inhalt: Uint8Array }> {
	const pid = idFeld(id, 'Protokoll');
	const did = idFeld(dateiId, 'Datei');
	await sichtVonProtokoll(k, sicht, pid);
	const [d] = await mitBetrieb(k, (tx) => tx`
		select id, feld_id, art, name, typ, groesse, inhalt from app.protokoll_dateien
		where id = ${did} and protokoll_id = ${pid} and betrieb_id = ${k.betriebId}`);
	if (!d) throw nichtGefunden('Datei');
	return { id: d.id, feldId: d.feld_id, art: d.art, name: d.name, typ: d.typ, groesse: d.groesse, inhalt: d.inhalt };
}

const dateiName = (titel: string, tag: string) =>
	`Protokoll ${titel} ${tag.split('-').reverse().join('.')}.pdf`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 200);

/** Daten fürs PDF in der laufenden Transaktion sammeln und das PDF erzeugen. */
async function erzeugePdf(tx: TransactionSql, k: Kontext, pid: string): Promise<{ pdf: Uint8Array; titel: string; auftragId: string | null; abgeschlossen: Date }> {
	const [p] = await tx`
		select ${tx.unsafe(PROTOKOLL_SPALTEN)}, p.antworten, v.schema,
			a.nummer as auftrag_nummer, a.titel as auftrag_titel, a.einmal_name,
			k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
			o.bezeichnung as objekt_bezeichnung, an.bezeichnung as anlage_bezeichnung
		from ${tx.unsafe(PROTOKOLL_VON)}
		left join app.auftraege a on a.id = p.auftrag_id and a.betrieb_id = p.betrieb_id
		left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
		left join app.objekte o on o.id = p.objekt_id and o.betrieb_id = p.betrieb_id
		left join app.anlagen an on an.id = p.anlage_id and an.betrieb_id = p.betrieb_id
		where p.id = ${pid} and p.betrieb_id = ${k.betriebId}`;
	if (!p) throw nichtGefunden();
	const dateien = await tx`
		select id, typ, inhalt from app.protokoll_dateien where protokoll_id = ${pid} and betrieb_id = ${k.betriebId}`;
	const bilder = new Map<string, PdfBild>(dateien.map((d) => [d.id as string, { typ: d.typ, bytes: d.inhalt as Uint8Array }]));
	const abgeschlossen = p.abgeschlossen ? new Date(p.abgeschlossen) : new Date();
	const pdf = await formularProtokollPdf({
		profil: await holeProfil(k),
		logo: await holeLogo(k),
		titel: p.titel,
		version: p.version,
		nummer: pid.slice(0, 8).toUpperCase(),
		status: p.status,
		abgeschlossen: abgeschlossen.toISOString(),
		abgeschlossenVon: p.abgeschlossen_von_name ?? null,
		angaben: [
			...(p.auftrag_nummer ? [['Auftrag', `${p.auftrag_nummer} – ${p.auftrag_titel}`] as [string, string]] : []),
			...(p.auftrag_nummer ? [['Kunde', kundeNameAus(p)] as [string, string]] : []),
			...(p.objekt_bezeichnung ? [['Objekt', p.objekt_bezeichnung] as [string, string]] : []),
			...(p.anlage_bezeichnung ? [['Anlage', p.anlage_bezeichnung] as [string, string]] : []),
			['Erstellt von', p.von_name ?? '–']
		],
		// Aufmaß (msg 2842): Räume aufgeklappt, berechnete Werte frisch gerechnet
		schema: expandiere(p.schema as Schema, (p.antworten ?? {}) as Antworten),
		antworten: berechne(p.schema as Schema, (p.antworten ?? {}) as Antworten),
		bilder
	});
	return { pdf, titel: p.titel, auftragId: p.auftrag_id, abgeschlossen };
}

/**
 * Abschließen: alle sichtbaren Pflichtfelder erfüllt (sonst 400 mit der Liste), dann gesperrt mit Zeit und Benutzer,
 * PDF erzeugt und – bei einem Auftrag – in dessen Dokumenten (app.dateien) abgelegt. Alles in einer Transaktion.
 */
export async function schliesseAb(k: Kontext, sicht: Sicht, id: unknown): Promise<{ pdfDateiId: string | null }> {
	const pid = idFeld(id, 'Protokoll');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const { schema, antworten } = await sperreEntwurf(tx, k, pid);
		const fehlend = fehlendeFelder(schema, antworten);
		if (fehlend.length > 0) {
			throw new ApiFehler(400, `Noch nicht fertig: ${fehlend.slice(0, 5).map((f) => `${f.label} (${f.grund})`).join(', ')}${fehlend.length > 5 ? ' …' : ''}`, {
				fehlend
			});
		}
		// Name der Kunden-Unterschrift fürs Protokoll
		const zustand = auswerten(schema, antworten);
		const kunde = alleFelder(expandiere(schema, antworten)).find(({ feld }) => feld.typ === 'unterschrift' && feld.wer === 'kunde' && zustand.get(feld.id)?.sichtbar && antworten[feld.id]);
		const unterschrieben = kunde ? ((antworten[kunde.feld.id] as { name?: string }).name ?? null) : null;
		await tx`
			update app.protokolle set status = 'abgeschlossen', abgeschlossen = now(), abgeschlossen_von = ${k.benutzerId},
				unterschrieben_von = ${unterschrieben}
			where id = ${pid}`;
		const { pdf, titel, auftragId, abgeschlossen } = await erzeugePdf(tx, k, pid);
		if (!auftragId) return { pdfDateiId: null };
		const [d] = await tx`
			insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung)
			values (${k.betriebId}, ${auftragId}, ${dateiName(titel, berlinTag(abgeschlossen))}, 'application/pdf', ${pdf.byteLength},
				${Buffer.from(pdf)}, ${'Protokoll (abgeschlossen, unterschrieben)'})
			returning id`;
		await tx`update app.protokolle set pdf_datei_id = ${d.id} where id = ${pid}`;
		return { pdfDateiId: d.id as string };
	});
}

/** PDF eines Protokolls: abgelegtes PDF (abgeschlossen), sonst frisch erzeugt (Entwurf, als Vorschau). */
export async function protokollPdf(k: Kontext, sicht: Sicht, id: unknown): Promise<{ pdf: Uint8Array; name: string }> {
	const pid = idFeld(id, 'Protokoll');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select p.pdf_datei_id, d.name, d.inhalt from app.protokolle p
			left join app.dateien d on d.id = p.pdf_datei_id and d.betrieb_id = p.betrieb_id
			where p.id = ${pid} and p.betrieb_id = ${k.betriebId}`;
		if (z?.inhalt) return { pdf: z.inhalt as Uint8Array, name: z.name as string };
		const { pdf, titel, abgeschlossen } = await erzeugePdf(tx, k, pid);
		return { pdf, name: dateiName(titel, berlinTag(abgeschlossen)) };
	});
}

/** Entwurf löschen (abgeschlossene bleiben – sie sind unterschrieben). */
export async function loescheEntwurf(k: Kontext, sicht: Sicht, id: unknown): Promise<string | null> {
	const pid = idFeld(id, 'Protokoll');
	await sichtVonProtokoll(k, sicht, pid);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			delete from app.protokolle where id = ${pid} and betrieb_id = ${k.betriebId} and status = 'entwurf' returning auftrag_id`;
		if (!z) throw new ApiFehler(409, 'Abgeschlossene Protokolle können nicht gelöscht werden.');
		return z.auftrag_id as string | null;
	});
}

// ---------------------------------------------------------------------------------------------------------------
// Verlauf des Auftrags

const zeitFormat = new Intl.DateTimeFormat('de-DE', {
	timeZone: 'Europe/Berlin',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

/**
 * Einträge des Änderungsprotokolls zu den Protokollen eines Auftrags als Verlaufszeilen: gestartet, abgeschlossen
 * (mit Unterschrift), PDF in Dokumenten abgelegt, Entwurf gelöscht. `zeit` (ISO) zum Einsortieren.
 */
export async function protokollVerlauf(k: Kontext, auftragId: string): Promise<{ iso: string; zeile: VerlaufZeile }[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select a.id::text as id, a.zeit, a.aktion, a.vorher, a.nachher, a.quelle, b.name as benutzer_name
			from app.aenderungen a left join app.benutzer b on b.id = a.benutzer_id
			where a.betrieb_id = ${k.betriebId} and a.tabelle = 'protokolle'
				and coalesce(a.nachher ->> 'auftrag_id', a.vorher ->> 'auftrag_id') = ${auftragId}
			order by a.id desc limit 100`;
		const aus: { iso: string; zeile: VerlaufZeile }[] = [];
		for (const e of z) {
			const titel = (e.nachher ?? e.vorher)?.titel ?? 'Protokoll';
			let text: string | null = null;
			if (e.aktion === 'angelegt') text = `Protokoll „${titel}“ gestartet`;
			else if (e.aktion === 'geloescht') text = `Protokoll „${titel}“ (Entwurf) gelöscht`;
			else if (e.vorher?.status !== 'abgeschlossen' && e.nachher?.status === 'abgeschlossen') {
				text = `Protokoll „${titel}“ abgeschlossen${e.nachher.unterschrieben_von ? ` – unterschrieben von ${e.nachher.unterschrieben_von}` : ''}`;
			} else if (!e.vorher?.pdf_datei_id && e.nachher?.pdf_datei_id) text = `Protokoll „${titel}“ als PDF in den Dokumenten abgelegt`;
			if (!text) continue;
			const iso = new Date(e.zeit).toISOString();
			aus.push({
				iso,
				zeile: {
					id: `p${e.id}`,
					zeit: zeitFormat.format(new Date(e.zeit)),
					wer: `${e.benutzer_name ?? 'System'}${e.quelle === 'sprache' ? ' (per Sprache)' : ''}`,
					titel: text,
					aenderungen: []
				}
			});
		}
		return aus;
	});
}
