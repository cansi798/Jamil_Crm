import type { Kontext, TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { UUID } from './kunden';
import { berlinTag, berlinZeitpunkt, istTag, tagDeutsch } from '../zeit';
import { tagMitWochentag } from './lexware/belege';

/**
 * Drei Terminvorschläge für den Baubeginn (Merkpunkt 13.11., Jamil #6093 „ja“; Plan Abschnitt 6, Task T10).
 * Bis zu drei Tage (Zukunft) mit kurzem Hinweis je Angebot, nur im Entwurf änderbar (Datenbank-Trigger wie bei den
 * Positionen). Im Lexware-Beleg stehen sie als Text; maßgeblich für das Portal ist diese Tabelle.
 * Annahme (Portal, Büro, Sprache): einen Termin wählen oder „keiner passt“ (+ Freitext) → Auftrag `baubeginn`,
 * vorläufiger Einsatz „Baubeginn (reserviert)“ beim Zuständigen bzw. Aufgabe; „keiner passt“ → Aufgabe „Kunden anrufen“.
 */

export const MAX_TERMINE = 3;
export type Terminvorschlag = { id: string; pos: number; beginn: string; hinweis: string | null };
export type TerminEingabe = { beginn?: unknown; hinweis?: unknown };

export async function ladeTermine(tx: TransactionSql, k: Kontext, angebotId: string): Promise<Terminvorschlag[]> {
	const z = await tx`
		select id, pos, to_char(beginn, 'YYYY-MM-DD') as beginn, hinweis from app.angebot_terminvorschlaege
		where angebot_id = ${angebotId} and betrieb_id = ${k.betriebId} order by pos`;
	return z.map((r) => ({ id: r.id, pos: r.pos, beginn: r.beginn, hinweis: r.hinweis }));
}

/** Eingabe prüfen: höchstens drei, gültige Tage ab morgen (Berlin), keine doppelten, Hinweis ≤ 200 Zeichen. */
export function pruefeTermine(eingabe: unknown, heute = berlinTag(new Date())): { beginn: string; hinweis: string | null }[] {
	if (!Array.isArray(eingabe)) throw new ApiFehler(400, 'Terminvorschläge müssen eine Liste sein.');
	if (eingabe.length > MAX_TERMINE) throw new ApiFehler(400, `Höchstens ${MAX_TERMINE} Terminvorschläge.`);
	const liste = eingabe.map((roh, i) => {
		const e = (roh && typeof roh === 'object' ? roh : {}) as TerminEingabe;
		if (!istTag(e.beginn)) throw new ApiFehler(400, `Termin ${i + 1}: Bitte ein gültiges Datum wählen.`);
		if (e.beginn <= heute) throw new ApiFehler(400, `Termin ${i + 1}: Der Baubeginn muss in der Zukunft liegen.`);
		let hinweis: string | null = null;
		if (e.hinweis !== undefined && e.hinweis !== null && e.hinweis !== '') {
			if (typeof e.hinweis !== 'string') throw new ApiFehler(400, `Termin ${i + 1}: Ungültiger Hinweis.`);
			hinweis = e.hinweis.replaceAll('\u0000', '').trim().slice(0, 200) || null;
		}
		return { beginn: e.beginn, hinweis };
	});
	if (new Set(liste.map((t) => t.beginn)).size !== liste.length) throw new ApiFehler(400, 'Jeder Termin darf nur einmal vorkommen.');
	return liste.sort((a, b) => a.beginn.localeCompare(b.beginn));
}

/** Ersetzt die Vorschläge (Kopf muss gesperrt und ein Entwurf sein). */
export async function ersetzeTermine(tx: TransactionSql, k: Kontext, angebotId: string, liste: { beginn: string; hinweis: string | null }[]): Promise<void> {
	await tx`delete from app.angebot_terminvorschlaege where angebot_id = ${angebotId} and betrieb_id = ${k.betriebId}`;
	if (liste.length === 0) return;
	await tx`insert into app.angebot_terminvorschlaege ${tx(
		liste.map((t, i) => ({ betrieb_id: k.betriebId, angebot_id: angebotId, pos: i + 1, beginn: t.beginn, hinweis: t.hinweis })),
		'betrieb_id',
		'angebot_id',
		'pos',
		'beginn',
		'hinweis'
	)}`;
}

export type TerminWahl = { vorschlagId: string; beginn: string; wunsch: null } | { vorschlagId: null; beginn: null; wunsch: string | null; keiner: true };

/**
 * Wahl bei der Annahme auflösen: `termin` = Vorschlags-ID, Position „1“–„3“ oder „keiner“ (+ `wunsch`). Gibt es
 * Vorschläge und `pflicht` (Portal), muss gewählt werden (400). Ohne Vorschläge → null.
 */
export async function loeseTerminWahl(
	tx: TransactionSql,
	k: Kontext,
	angebotId: string,
	termin: unknown,
	wunsch: unknown,
	pflicht: boolean
): Promise<TerminWahl | null> {
	const liste = await ladeTermine(tx, k, angebotId);
	if (liste.length === 0) return null;
	const text = typeof wunsch === 'string' && wunsch.trim() !== '' ? wunsch.replaceAll('\u0000', '').trim().slice(0, 1000) : null;
	if (termin === 'keiner') return { vorschlagId: null, beginn: null, wunsch: text, keiner: true };
	if (termin === undefined || termin === null || termin === '') {
		if (pflicht) throw new ApiFehler(400, 'Bitte wählen Sie einen Termin für den Baubeginn – oder „Keiner passt“.');
		return null;
	}
	const t =
		typeof termin === 'string' && UUID.test(termin)
			? liste.find((x) => x.id === termin.toLowerCase())
			: liste.find((x) => String(x.pos) === String(termin) || x.beginn === termin);
	if (!t) throw new ApiFehler(400, 'Dieser Termin steht nicht zur Wahl.');
	return { vorschlagId: t.id, beginn: t.beginn, wunsch: null };
}

/**
 * Folgen der Wahl (in der Transaktion der Annahme): Auftrag `baubeginn`, vorläufiger Einsatz beim Zuständigen
 * (07:00–16:00) bzw. Aufgabe; „keiner passt“ → Aufgabe „Kunden anrufen“. Liefert einen Satz für den Verlauf.
 */
export async function uebernimmTerminWahl(
	tx: TransactionSql,
	k: Kontext,
	e: { auftragId: string | null; angebotNummer: string; wahl: TerminWahl; benutzerId: string | null }
): Promise<string> {
	const { zustaendig } = await import('./auftragsbestaetigung');
	const heute = berlinTag(new Date());
	if (!e.auftragId) return e.wahl.beginn ? `Baubeginn gewählt: ${tagMitWochentag(e.wahl.beginn)}` : 'Kein Baubeginn-Termin passt';
	if (e.wahl.beginn) {
		await tx`update app.auftraege set baubeginn = ${e.wahl.beginn} where id = ${e.auftragId} and betrieb_id = ${k.betriebId}`;
		// zuerst der Zuständige des Auftrags (er plant), sonst wer die Annahme eingetragen hat
		const wer = (await zustaendig(tx, k, null, e.auftragId)) ?? e.benutzerId;
		if (wer) {
			await tx`
				insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, titel, notiz)
				values (${k.betriebId}, ${e.auftragId}, ${wer}, ${berlinZeitpunkt(e.wahl.beginn, 7)}, ${berlinZeitpunkt(e.wahl.beginn, 16)},
					'Baubeginn (reserviert)', ${`Vom Kunden gewählter Baubeginn (Angebot ${e.angebotNummer}) – vorläufig, bitte Team und Zeiten bestätigen.`.slice(0, 500)})`;
		} else {
			await tx`
				insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, faellig)
				values (${k.betriebId}, ${e.auftragId}, ${`Baubeginn ${tagDeutsch(e.wahl.beginn)} einplanen`}, ${`Vom Kunden gewählt (Angebot ${e.angebotNummer}).`}, ${heute})`;
		}
		return `Baubeginn gewählt: ${tagMitWochentag(e.wahl.beginn)}`;
	}
	const wer = await zustaendig(tx, k, e.benutzerId, e.auftragId);
	await tx`
		insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
		values (${k.betriebId}, ${e.auftragId}, 'Kunden anrufen: kein Baubeginn-Termin passt',
			${`Angebot ${e.angebotNummer} angenommen, aber keiner der vorgeschlagenen Termine passt.${e.wahl.wunsch ? ` Wunsch des Kunden: „${e.wahl.wunsch}“` : ''}`.slice(0, 2000)},
			${wer}, ${heute})`;
	return `Kein vorgeschlagener Termin passt${e.wahl.wunsch ? ` (Wunsch: „${e.wahl.wunsch}“)` : ''}`;
}
