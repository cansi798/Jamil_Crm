import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { UUID } from './kunden';
import { holeAuftrag, sichtVon, type Auftrag, type Sicht } from './auftraege';
import { betriebKontext } from './rechte';
import { darf, darfEines } from './tarif';

/**
 * Zugriff auf die Dokumentation eines Auftrags (Stufe 2a: Fotos/Dateien, Notizen, Baustellen-Protokolle) – für die
 * JSON-Endpunkte unter /api/dateien, /api/notizen, /api/protokolle (vorher ohne jede Prüfung).
 *
 * Regeln (Plan 2a): Der Auftrag muss für den Nutzer sichtbar sein (wie /auftraege/[id]: alle oder eigene) – sonst
 * 404. Dateien und Notizen lesen: Aufträge lesen; anlegen/ändern/löschen: `auftraege.bearbeiten`. Protokolle lesen:
 * `protokolle.lesen` oder `protokolle.bearbeiten`; anlegen/ändern/unterschreiben/versenden: `protokolle.bearbeiten`.
 * Modul jeweils `auftraege`.
 */

export type DokuArt = 'dateien' | 'notizen' | 'protokolle';

export type DokuZugriff = { k: Kontext; sicht: Sicht; auftrag: Auftrag };

async function pruefeRechte(locals: { nutzer: Nutzer | null }, art: DokuArt, schreiben: boolean): Promise<void> {
	if (art === 'protokolle') {
		if (schreiben) await darf(locals, 'auftraege', 'protokolle.bearbeiten');
		else await darfEines(locals, 'auftraege', ['protokolle.lesen', 'protokolle.bearbeiten']);
		return;
	}
	if (schreiben) await darf(locals, 'auftraege', 'auftraege.bearbeiten');
	else await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
}

/** Rechte + sichtbarer Auftrag (unbekannt, fremd, unsichtbar, kaputte ID → 404). */
export async function zugriffAuftrag(
	locals: { nutzer: Nutzer | null },
	auftragId: unknown,
	art: DokuArt,
	schreiben: boolean
): Promise<DokuZugriff> {
	await pruefeRechte(locals, art, schreiben);
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	const k = betriebKontext(locals);
	const sicht = sichtVon(locals.nutzer!);
	const auftrag = await holeAuftrag(k, sicht, auftragId);
	return { k, sicht, auftrag };
}

const TABELLE = { dateien: 'app.dateien', notizen: 'app.notizen', protokolle: 'app.baustellen_protokolle' } as const;
const NAME = { dateien: 'Datei', notizen: 'Notiz', protokolle: 'Protokoll' } as const;

/** Wie `zugriffAuftrag`, aber über eine Datei/Notiz/ein Protokoll (dessen Auftrag zählt). */
export async function zugriffEintrag(
	locals: { nutzer: Nutzer | null },
	id: unknown,
	art: DokuArt,
	schreiben: boolean
): Promise<DokuZugriff & { id: string }> {
	await pruefeRechte(locals, art, schreiben);
	const nichtGefunden = new ApiFehler(404, `${NAME[art]} nicht gefunden.`);
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden;
	const k = betriebKontext(locals);
	const [z] = await mitBetrieb(k, (tx) => tx`
		select auftrag_id from ${tx.unsafe(TABELLE[art])} where id = ${id} and betrieb_id = ${k.betriebId}`);
	if (!z) throw nichtGefunden;
	try {
		return { ...(await zugriffAuftrag(locals, z.auftrag_id, art, schreiben)), id };
	} catch (e) {
		// Eintrag eines unsichtbaren Auftrags: wie unbekannt
		if (e instanceof ApiFehler && e.status === 404) throw nichtGefunden;
		throw e;
	}
}

/** Content-Disposition mit sicherem ASCII-Namen und UTF-8-Variante (RFC 6266). */
export function dateiKopf(art: 'inline' | 'attachment', name: string): string {
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	return `${art}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
