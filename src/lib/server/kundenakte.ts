import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';

/**
 * Kundenakte (Wunsch Jamil, 19.10.2026): Notizen und Dokumente je Kunde (Migration 023). Lesen: `kunden.lesen`,
 * Schreiben/Löschen: `kunden.bearbeiten` – geprüft von den Aufrufern (Seite /kunden/[id], Download-Route).
 * Fremde oder unbekannte Kunden, Notizen und Dokumente sind immer ein 404.
 *
 * Dokumente: höchstens 5 MB, nur PDF, Bilder (JPEG, PNG, WebP, HEIC) und Word/Excel (docx/xlsx); der Inhalt muss zum
 * angegebenen Typ passen (Dateianfang), damit z. B. keine HTML-Datei als „PDF“ hochgeladen wird.
 */

export const KUNDEN_DATEI_MAX = 5 * 1024 * 1024;
export const KUNDEN_NOTIZ_MAX = 10000;

export type KundenNotiz = { id: string; text: string; vonName: string | null; angelegt: string };
export type KundenDatei = {
	id: string;
	name: string;
	typ: string;
	groesse: number;
	beschreibung: string | null;
	vonName: string | null;
	angelegt: string;
};
export type KundenDateiMitInhalt = KundenDatei & { inhalt: Uint8Array };

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const beginntMit = (b: Uint8Array, kopf: number[], ab = 0) => kopf.every((x, i) => b[ab + i] === x);
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Erlaubte Typen mit Prüfung des Dateianfangs („magic bytes“). */
const TYPEN: Record<string, (b: Uint8Array) => boolean> = {
	'application/pdf': (b) => beginntMit(b, bytes('%PDF-')),
	'image/png': (b) => beginntMit(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	'image/jpeg': (b) => beginntMit(b, [0xff, 0xd8, 0xff]),
	'image/webp': (b) => beginntMit(b, bytes('RIFF')) && beginntMit(b, bytes('WEBP'), 8),
	'image/heic': (b) => beginntMit(b, bytes('ftyp'), 4) && ['heic', 'heix', 'mif1', 'msf1'].some((m) => beginntMit(b, bytes(m), 8)),
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => beginntMit(b, ZIP),
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => beginntMit(b, ZIP)
};

export const KUNDEN_DATEI_TYPEN = Object.keys(TYPEN);

const nichtGefunden = (was = 'Kunde') => new ApiFehler(404, `${was} nicht gefunden.`);

function idFeld(id: unknown, was: string): string {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden(was);
	return id.trim().toLowerCase();
}

/** Kunde muss im Betrieb existieren (sonst 404). */
async function pruefeKunde(tx: TransactionSql, k: Kontext, kundeId: string): Promise<void> {
	const [z] = await tx`select 1 from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
	if (!z) throw nichtGefunden();
}

/** Nur der Dateiname (ohne Pfad), ohne Steuerzeichen, höchstens 255 Zeichen. */
export function bereinigeDateiname(roh: string): string {
	const ohnePfad = roh.split(/[\\/]/).pop() ?? '';
	const sauber = ohnePfad.replace(/\p{Cc}/gu, '').trim();
	return [...(sauber || 'Dokument')].slice(-255).join('');
}

export async function listeKundenNotizen(k: Kontext, kundeId: string): Promise<KundenNotiz[]> {
	const kid = idFeld(kundeId, 'Kunde');
	return mitBetrieb(k, async (tx) => {
		await pruefeKunde(tx, k, kid);
		const z = await tx`
			select n.id, n.text, n.angelegt, b.name as von_name
			from app.kunden_notizen n left join app.benutzer b on b.id = n.von_benutzer_id and b.betrieb_id = n.betrieb_id
			where n.kunde_id = ${kid} and n.betrieb_id = ${k.betriebId}
			order by n.angelegt desc, n.id`;
		return z.map((r) => ({ id: r.id, text: r.text, vonName: r.von_name ?? null, angelegt: new Date(r.angelegt).toISOString() }));
	});
}

export async function legeKundenNotizAn(k: Kontext, kundeId: string, text: unknown): Promise<KundenNotiz> {
	const kid = idFeld(kundeId, 'Kunde');
	const t = textFeld(text, 'Notiz', KUNDEN_NOTIZ_MAX);
	if (t === null) throw new ApiFehler(400, 'Bitte einen Text für die Notiz eingeben.');
	return mitBetrieb(k, async (tx) => {
		await pruefeKunde(tx, k, kid);
		const [z] = await tx`
			insert into app.kunden_notizen (betrieb_id, kunde_id, text, von_benutzer_id)
			values (${k.betriebId}, ${kid}, ${t}, ${k.benutzerId}) returning id, text, angelegt`;
		const [b] = await tx`select name from app.benutzer where id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`;
		return { id: z.id, text: z.text, vonName: b?.name ?? null, angelegt: new Date(z.angelegt).toISOString() };
	});
}

export async function loescheKundenNotiz(k: Kontext, kundeId: string, notizId: unknown): Promise<void> {
	const kid = idFeld(kundeId, 'Kunde');
	const nid = idFeld(notizId, 'Notiz');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			delete from app.kunden_notizen where id = ${nid} and kunde_id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Notiz');
	});
}

const DATEI_SPALTEN = `d.id, d.name, d.typ, d.groesse, d.beschreibung, d.angelegt, b.name as von_name`;
const DATEI_VON = `app.kunden_dateien d left join app.benutzer b on b.id = d.von_benutzer_id and b.betrieb_id = d.betrieb_id`;

function zuDatei(r: Record<string, any>): KundenDatei {
	return {
		id: r.id,
		name: r.name,
		typ: r.typ,
		groesse: Number(r.groesse),
		beschreibung: r.beschreibung ?? null,
		vonName: r.von_name ?? null,
		angelegt: new Date(r.angelegt).toISOString()
	};
}

export async function listeKundenDateien(k: Kontext, kundeId: string): Promise<KundenDatei[]> {
	const kid = idFeld(kundeId, 'Kunde');
	return mitBetrieb(k, async (tx) => {
		await pruefeKunde(tx, k, kid);
		const z = await tx`
			select ${tx.unsafe(DATEI_SPALTEN)} from ${tx.unsafe(DATEI_VON)}
			where d.kunde_id = ${kid} and d.betrieb_id = ${k.betriebId}
			order by d.angelegt desc, d.id`;
		return z.map(zuDatei);
	});
}

export async function speichereKundenDatei(
	k: Kontext,
	kundeId: string,
	e: { name: string; typ: string; inhalt: Uint8Array; beschreibung?: unknown }
): Promise<KundenDatei> {
	const kid = idFeld(kundeId, 'Kunde');
	if (e.inhalt.byteLength > KUNDEN_DATEI_MAX) throw new ApiFehler(413, 'Die Datei ist zu groß (höchstens 5 MB).');
	if (e.inhalt.byteLength === 0) throw new ApiFehler(400, 'Die Datei ist leer.');
	const pruefe = TYPEN[e.typ];
	if (!pruefe) throw new ApiFehler(400, 'Dieser Dateityp ist nicht erlaubt (PDF, Bilder, Word, Excel).');
	if (!pruefe(e.inhalt)) throw new ApiFehler(400, 'Der Inhalt der Datei passt nicht zum Dateityp.');
	const name = bereinigeDateiname(e.name);
	const beschreibung = textFeld(e.beschreibung, 'Beschreibung', 500);
	return mitBetrieb(k, async (tx) => {
		await pruefeKunde(tx, k, kid);
		const [z] = await tx`
			insert into app.kunden_dateien (betrieb_id, kunde_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id)
			values (${k.betriebId}, ${kid}, ${name}, ${e.typ}, ${e.inhalt.byteLength}, ${Buffer.from(e.inhalt)}, ${beschreibung},
				${k.benutzerId})
			returning id`;
		const [r] = await tx`select ${tx.unsafe(DATEI_SPALTEN)} from ${tx.unsafe(DATEI_VON)} where d.id = ${z.id}`;
		return zuDatei(r);
	});
}

export async function holeKundenDatei(k: Kontext, kundeId: string, dateiId: unknown): Promise<KundenDateiMitInhalt> {
	const kid = idFeld(kundeId, 'Kunde');
	const did = idFeld(dateiId, 'Dokument');
	return mitBetrieb(k, async (tx) => {
		const [r] = await tx`
			select ${tx.unsafe(DATEI_SPALTEN)}, d.inhalt from ${tx.unsafe(DATEI_VON)}
			where d.id = ${did} and d.kunde_id = ${kid} and d.betrieb_id = ${k.betriebId}`;
		if (!r) throw nichtGefunden('Dokument');
		return { ...zuDatei(r), inhalt: new Uint8Array(r.inhalt) };
	});
}

export async function loescheKundenDatei(k: Kontext, kundeId: string, dateiId: unknown): Promise<void> {
	const kid = idFeld(kundeId, 'Kunde');
	const did = idFeld(dateiId, 'Dokument');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			delete from app.kunden_dateien where id = ${did} and kunde_id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden('Dokument');
	});
}
