import type { Kontext } from './db';
import { ApiFehler } from './fehler';
import { betriebKontext, hatRecht } from './rechte';
import { darf, hatModul } from './tarif';

/**
 * Rechte für Rechnungen und Mahnungen (Lexware Phase 3, Plan Entscheidung 9): Modul `lexware` plus
 * `rechnungen.sehen` (Liste, Status, PDF), `rechnungen.erstellen` (Dialog, Senden), `mahnungen.verwalten`
 * (Mahnstufen, Freigabe, Pause). Beträge nur zusätzlich mit `preise.sehen` – ein Monteur sieht nie Beträge.
 */
export type RechnungZugriff = { k: Kontext; preise: boolean; erstellen: boolean; mahnen: boolean };

export async function rechnungenZugriff(locals: { nutzer: Nutzer | null }): Promise<RechnungZugriff> {
	await darf(locals, 'lexware', 'rechnungen.sehen');
	const n = locals.nutzer!;
	const preise = hatRecht(n, 'preise.sehen');
	return { k: betriebKontext(locals), preise, erstellen: preise && hatRecht(n, 'rechnungen.erstellen'), mahnen: hatRecht(n, 'mahnungen.verwalten') };
}

/** Ohne Fehler: darf die Person Rechnungen sehen? (für Seiten, die Rechnungen nur zusätzlich zeigen) */
export async function siehtRechnungen(nutzer: Nutzer | null): Promise<boolean> {
	return !!nutzer?.betriebId && hatRecht(nutzer, 'rechnungen.sehen') && (await hatModul(nutzer.betriebId, 'lexware'));
}

export function pruefeErstellen(z: RechnungZugriff): void {
	if (!z.erstellen) throw new ApiFehler(403, 'Keine Berechtigung (Rechnungen erstellen und Preise sehen).');
}
export function pruefeMahnen(z: RechnungZugriff): void {
	if (!z.mahnen) throw new ApiFehler(403, 'Keine Berechtigung (Mahnungen verwalten).');
}
