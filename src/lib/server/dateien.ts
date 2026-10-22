import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';

/**
 * Dateien (Fotos, PDFs, Dokumente) zu Aufträgen. Gespeichert in der Datenbank als bytea, max. 10 MB.
 * Modul: `kunden` (Fotos gehören zum Auftrag, kein eigenes Modul). Recht: `auftraege.bearbeiten`.
 */

export type Datei = {
	id: string;
	auftragId: string;
	name: string;
	typ: string;
	groesse: number;
	beschreibung: string | null;
	angelegt: string;
};

export type DateiMitInhalt = Datei & {
	inhalt: Uint8Array;
};

const DATEI_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ERLAUBTE_TYPEN = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

/**
 * Speichert eine Datei zu einem Auftrag. Gibt die Metadaten zurück (ohne Inhalt).
 */
export async function speichereDatei(
	k: Kontext,
	auftragId: string,
	name: string,
	typ: string,
	groesse: number,
	inhalt: Buffer | Uint8Array,
	beschreibung?: string,
	/** wer hochlädt (Anzeige „von …“, Löschen eigener Einträge; Migration 106) */
	vonBenutzerId?: string
): Promise<Datei> {
	if (groesse > DATEI_MAX_BYTES) {
		throw new ApiFehler(413, 'Die Datei ist zu groß (max. 10 MB)');
	}
	if (!ERLAUBTE_TYPEN.has(typ)) {
		throw new ApiFehler(400, 'Dieser Dateityp ist nicht erlaubt');
	}
	if (!name || name.length > 255) {
		throw new ApiFehler(400, 'Dateiname fehlt oder ist zu lang');
	}
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id)
			values (${k.betriebId}, ${auftragId}, ${name}, ${typ}, ${groesse}, ${inhalt}, ${beschreibung ?? null}, ${vonBenutzerId ?? null})
			returning id, auftrag_id as "auftragId", name, typ, groesse, beschreibung, angelegt`;
		return z as Datei;
	});
}

/**
 * Liest eine Datei mit Inhalt (für Download). Gibt null zurück, wenn nicht gefunden.
 */
export async function liesDatei(k: Kontext, dateiId: string): Promise<DateiMitInhalt | null> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select id, auftrag_id as "auftragId", name, typ, groesse, beschreibung, angelegt, inhalt
			from app.dateien where id = ${dateiId}`;
		if (!z) return null;
		return z as DateiMitInhalt;
	});
}

/**
 * Löscht eine Datei.
 */
export async function loescheDatei(k: Kontext, dateiId: string): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		await tx`delete from app.dateien where id = ${dateiId}`;
	});
}

/**
 * Gibt alle Dateien eines Auftrags zurück (ohne Inhalt, nur Metadaten).
 */
export async function dateienFuerAuftrag(k: Kontext, auftragId: string): Promise<Datei[]> {
	return mitBetrieb(k, async (tx) => {
		const zeilen = await tx`
			select id, auftrag_id as "auftragId", name, typ, groesse, beschreibung, angelegt
			from app.dateien where auftrag_id = ${auftragId}
			order by angelegt desc`;
		return zeilen as unknown as Datei[];
	});
}