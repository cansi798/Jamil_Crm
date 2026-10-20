import { ApiFehler } from '../fehler';
import { angeboteZugriff } from '../angebote';
import { darf, darfEines, pruefeModul } from '../tarif';
import type { AktionsName } from './aktionen';

/**
 * Rechte je Sprachaktion – dieselben Module und Rollen-Rechte wie in der Oberfläche:
 * - Kunde anlegen: Modul `kunden` + `kunden.bearbeiten`
 * - Auftrag anlegen: Modul `auftraege` + `auftraege.bearbeiten` und Kunden suchen (`kunden.lesen`); mit eingeplanten
 *   Mitarbeitern zusätzlich Modul `plantafel` + `plantafel.bearbeiten`
 * - To-do anlegen: Modul `auftraege` + `auftraege.bearbeiten`
 * - Termin einplanen/verschieben: Modul `plantafel` + `plantafel.bearbeiten`
 * - Angebotsentwurf: Modul `ki_angebote` und `angebote` + `angebote.bearbeiten` + `preise.sehen`
 * - Protokoll: Vorlage starten (Formular) Modul `protokolle` + `protokolle.ausfuellen` oder `protokolle.bearbeiten`;
 *   Baustellen-Protokoll (feste Typen) `protokolle.bearbeiten`
 * - Mitarbeiter zuweisen, Status ändern: Modul `auftraege` + `auftraege.bearbeiten`
 * - To-do abhaken: Modul `auftraege`; abhaken darf, wer bearbeiten darf, sonst nur eigene To-dos (beim Ausführen)
 * - Anlage anlegen: Modul `kunden` + `kunden.bearbeiten`
 * - Nachfassen pausieren: wie Angebote (`angebote.bearbeiten` + `preise.sehen`)
 * - Tagesplan abfragen (nur lesend): Modul `auftraege` und irgendein Auftragsrecht; andere Personen nur mit
 *   „Alle To-dos ansehen“ (geprüft beim Beantworten)
 */

export const MELDUNG_RECHTE = 'Dafür fehlt Ihnen die Berechtigung';
export const MELDUNG_TARIF = 'Im aktuellen Tarif nicht enthalten';

export async function pruefeAktionsRechte(
	locals: { nutzer: Nutzer | null },
	aktion: AktionsName,
	opts: { mitEinsaetzen?: boolean; formular?: boolean } = {}
): Promise<void> {
	switch (aktion) {
		case 'kunde_anlegen':
			return darf(locals, 'kunden', 'kunden.bearbeiten');
		case 'auftrag_anlegen':
			await darf(locals, 'auftraege', 'auftraege.bearbeiten');
			await darf(locals, 'kunden', 'kunden.lesen');
			if (opts.mitEinsaetzen) await darf(locals, 'plantafel', 'plantafel.bearbeiten');
			return;
		case 'todo_anlegen':
			return darf(locals, 'auftraege', 'auftraege.bearbeiten');
		case 'einsatz_anlegen':
		case 'einsatz_verschieben':
			return darf(locals, 'plantafel', 'plantafel.bearbeiten');
		case 'angebot_entwurf':
			await angeboteZugriff(locals);
			await pruefeModul(locals, 'ki_angebote');
			return;
		case 'protokoll_ausfuellen':
			if (opts.formular === false) return darf(locals, 'protokolle', 'protokolle.bearbeiten');
			return darfEines(locals, 'protokolle', ['protokolle.ausfuellen', 'protokolle.bearbeiten']);
		case 'mitarbeiter_zuweisen':
		case 'status_aendern':
			return darf(locals, 'auftraege', 'auftraege.bearbeiten');
		case 'todo_abhaken':
		case 'abfrage_tagesplan':
			return darfEines(locals, 'auftraege', ['auftraege.bearbeiten', 'auftraege.lesen', 'auftraege.alle_lesen']);
		case 'anlage_anlegen':
			return darf(locals, 'kunden', 'kunden.bearbeiten');
		case 'nachfassen_pausieren':
			await angeboteZugriff(locals);
			return;
	}
}

/** Wie `pruefeAktionsRechte`, aber als Meldung für die Karte (`null` = darf). 401 bleibt ein Fehler. */
export async function rechteHinweis(
	locals: { nutzer: Nutzer | null },
	aktion: AktionsName,
	opts: { mitEinsaetzen?: boolean; formular?: boolean } = {}
): Promise<string | null> {
	try {
		await pruefeAktionsRechte(locals, aktion, opts);
		return null;
	} catch (e) {
		if (e instanceof ApiFehler && e.status === 403) return MELDUNG_RECHTE;
		if (e instanceof ApiFehler && e.status === 402) return MELDUNG_TARIF;
		throw e;
	}
}
