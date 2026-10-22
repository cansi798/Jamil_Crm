import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { UUID } from './kunden';
import { pruefeDateiInhalt } from './kundenakte';
import { speichereDatei } from './dateien';

/**
 * Dokumente und Notizen direkt im Auftrag (Wunsch Jamil, Talk msg 3070) – wie die Links: inline hinzufügen, Liste in
 * der Karte, je Eintrag „Im Kundenportal sichtbar“ (Freigabe über portal_dokumente, Art „datei“ bzw. „notiz“).
 *
 * Speicher und Grenzen wie die Dokumentation des Auftrags (app.dateien in der Datenbank, höchstens 10 MB, erlaubte
 * Typen; zusätzlich muss der Dateianfang zum Typ passen). Rechte prüft der Aufrufer wie bisher: Lesen = Auftrag
 * sichtbar, Anlegen = „Aufträge bearbeiten“, Portal-Freigabe = Modul + „Kundenportal verwalten“.
 * Löschen: eigene Einträge – oder mit „Einstellungen verwalten“ (Chef) alle.
 */

export type AuftragDokument = {
	id: string;
	name: string;
	typ: string;
	groesse: number;
	angelegt: string;
	vonId: string | null;
	vonName: string | null;
	imPortal: boolean;
};
export type AuftragNotiz = { id: string; text: string; angelegt: string; vonId: string | null; vonName: string | null; imPortal: boolean };

export const NOTIZ_MAX = 10000;

/** Dokumente und Notizen eines (sichtbaren) Auftrags, neueste zuerst. */
export async function auftragUnterlagen(k: Kontext, auftragId: string): Promise<{ dokumente: AuftragDokument[]; notizen: AuftragNotiz[] }> {
	return mitBetrieb(k, async (tx) => {
		const geteilt = await tx`select art, ref_id from app.portal_dokumente where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId} and art in ('datei', 'notiz')`;
		const ist = (art: string, id: string) => geteilt.some((g) => g.art === art && g.ref_id === id);
		const d = await tx`
			select d.id, d.name, d.typ, d.groesse, d.angelegt, d.von_benutzer_id, b.name as von_name
			from app.dateien d left join app.benutzer b on b.id = d.von_benutzer_id and b.betrieb_id = d.betrieb_id
			where d.betrieb_id = ${k.betriebId} and d.auftrag_id = ${auftragId} order by d.angelegt desc limit 200`;
		const n = await tx`
			select n.id, n.text, n.angelegt, n.von_benutzer_id, b.name as von_name
			from app.notizen n left join app.benutzer b on b.id = n.von_benutzer_id and b.betrieb_id = n.betrieb_id
			where n.betrieb_id = ${k.betriebId} and n.auftrag_id = ${auftragId} order by n.angelegt desc limit 200`;
		return {
			dokumente: d.map((x) => ({
				id: x.id,
				name: x.name,
				typ: x.typ,
				groesse: x.groesse,
				angelegt: new Date(x.angelegt).toISOString(),
				vonId: x.von_benutzer_id ?? null,
				vonName: x.von_name ?? null,
				imPortal: ist('datei', x.id)
			})),
			notizen: n.map((x) => ({
				id: x.id,
				text: x.text,
				angelegt: new Date(x.angelegt).toISOString(),
				vonId: x.von_benutzer_id ?? null,
				vonName: x.von_name ?? null,
				imPortal: ist('notiz', x.id)
			}))
		};
	});
}

/** Dokument hochladen (Typ und Dateianfang geprüft); merkt sich, wer es hochgeladen hat. */
export async function dokumentHochladen(k: Kontext, auftragId: string, datei: unknown): Promise<string> {
	if (!(datei instanceof File) || datei.size === 0) throw new ApiFehler(400, 'Bitte eine Datei auswählen.');
	const inhalt = new Uint8Array(await datei.arrayBuffer());
	pruefeDateiInhalt(datei.type, inhalt);
	const d = await speichereDatei(k, auftragId, datei.name.slice(0, 255), datei.type, datei.size, Buffer.from(inhalt), undefined, k.benutzerId);
	return d.id;
}

/** Notiz anlegen (1–10 000 Zeichen). */
export async function notizHinzufuegen(k: Kontext, auftragId: string, text: unknown): Promise<string> {
	const t = typeof text === 'string' ? text.replaceAll('\u0000', '').trim() : '';
	if (t === '') throw new ApiFehler(400, 'Bitte einen Text eingeben.');
	if ([...t].length > NOTIZ_MAX) throw new ApiFehler(400, `Die Notiz ist zu lang (höchstens ${NOTIZ_MAX} Zeichen).`);
	const [n] = await mitBetrieb(k, (tx) => tx`
		insert into app.notizen (betrieb_id, auftrag_id, text, von_benutzer_id) values (${k.betriebId}, ${auftragId}, ${t}, ${k.benutzerId}) returning id`);
	return n.id as string;
}

/** Löschen: nur eigene Einträge, mit `alle` (Chef) jeden – Eintrag muss zum Auftrag gehören (sonst 404). */
export async function unterlageLoeschen(k: Kontext, auftragId: string, art: 'datei' | 'notiz', id: unknown, alle: boolean): Promise<void> {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Nicht gefunden.');
	const tabelle = art === 'datei' ? 'app.dateien' : 'app.notizen';
	await mitBetrieb(k, async (tx) => {
		const [z] = await tx`select von_benutzer_id from ${tx.unsafe(tabelle)} where id = ${id} and auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId}`;
		if (!z) throw new ApiFehler(404, 'Nicht gefunden.');
		if (!alle && z.von_benutzer_id !== k.benutzerId) throw new ApiFehler(403, 'Nur eigene Einträge lassen sich hier löschen.');
		await tx`delete from ${tx.unsafe(tabelle)} where id = ${id} and betrieb_id = ${k.betriebId}`;
	});
}
