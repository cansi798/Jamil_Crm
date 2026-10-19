import { ApiFehler } from '../fehler';
import { angeboteZugriff } from '../angebote';
import { darf, pruefeModul } from '../tarif';
import type { AktionsName } from './aktionen';

/**
 * Rechte je Sprachaktion – dieselben Module und Rollen-Rechte wie in der Oberfläche:
 * - Kunde anlegen: Modul `kunden` + `kunden.bearbeiten`
 * - Auftrag anlegen: Modul `auftraege` + `auftraege.bearbeiten` und Kunden suchen (`kunden.lesen`); mit eingeplanten
 *   Mitarbeitern zusätzlich Modul `plantafel` + `plantafel.bearbeiten`
 * - To-do anlegen: Modul `auftraege` + `auftraege.bearbeiten`
 * - Termin einplanen/verschieben: Modul `plantafel` + `plantafel.bearbeiten`
 * - Angebotsentwurf: Modul `ki_angebote` und `angebote` + `angebote.bearbeiten` + `preise.sehen`
 * - Protokoll ausfüllen: Modul `protokolle` + `protokolle.bearbeiten`
 */

export const MELDUNG_RECHTE = 'Dafür fehlt Ihnen die Berechtigung';
export const MELDUNG_TARIF = 'Im aktuellen Tarif nicht enthalten';

export async function pruefeAktionsRechte(
	locals: { nutzer: Nutzer | null },
	aktion: AktionsName,
	opts: { mitEinsaetzen?: boolean } = {}
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
			return darf(locals, 'protokolle', 'protokolle.bearbeiten');
	}
}

/** Wie `pruefeAktionsRechte`, aber als Meldung für die Karte (`null` = darf). 401 bleibt ein Fehler. */
export async function rechteHinweis(
	locals: { nutzer: Nutzer | null },
	aktion: AktionsName,
	opts: { mitEinsaetzen?: boolean } = {}
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
