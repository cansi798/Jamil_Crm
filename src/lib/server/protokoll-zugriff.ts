import type { Kontext } from './db';
import { auftragsSicht, type Sicht } from './auftraege';
import { betriebKontext, hatRecht } from './rechte';
import { darf, darfEines, hatModul } from './tarif';

/**
 * Rechte der frei gestaltbaren Protokolle (Modul `protokolle`):
 * - Vorlagen gestalten: `protokolle.vorlagen_bearbeiten` (Chef, Büro)
 * - Protokolle starten und ausfüllen: `protokolle.ausfuellen` oder `protokolle.bearbeiten` (Monteur und höher)
 * - ansehen (auch abgeschlossene, PDF): zusätzlich `protokolle.lesen`
 * Immer dazu: Aufträge lesen (eigene oder alle) – die Sicht entscheidet, welche Protokolle man sieht (404 sonst).
 */

export const AUSFUELLEN = ['protokolle.ausfuellen', 'protokolle.bearbeiten'] as const;
export const LESEN = ['protokolle.lesen', 'protokolle.ausfuellen', 'protokolle.bearbeiten'] as const;

export type ProtokollZugriff = { k: Kontext; sicht: Sicht };

export async function zugriffVorlagen(locals: { nutzer: Nutzer | null }): Promise<Kontext> {
	await darf(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
	return betriebKontext(locals);
}

export async function zugriffAusfuellen(locals: { nutzer: Nutzer | null }): Promise<ProtokollZugriff> {
	await darfEines(locals, 'protokolle', [...AUSFUELLEN]);
	return { sicht: await auftragsSicht(locals), k: betriebKontext(locals) };
}

export async function zugriffLesen(locals: { nutzer: Nutzer | null }): Promise<ProtokollZugriff> {
	await darfEines(locals, 'protokolle', [...LESEN]);
	return { sicht: await auftragsSicht(locals), k: betriebKontext(locals) };
}

/** Für Seiten (ohne Fehler): Was darf der Nutzer bei Protokollen? */
export async function protokollRechte(nutzer: Nutzer): Promise<{ lesen: boolean; ausfuellen: boolean; vorlagen: boolean }> {
	if (!nutzer.betriebId || !(await hatModul(nutzer.betriebId, 'protokolle'))) return { lesen: false, ausfuellen: false, vorlagen: false };
	return {
		lesen: LESEN.some((r) => hatRecht(nutzer, r)),
		ausfuellen: AUSFUELLEN.some((r) => hatRecht(nutzer, r)),
		vorlagen: hatRecht(nutzer, 'protokolle.vorlagen_bearbeiten')
	};
}
