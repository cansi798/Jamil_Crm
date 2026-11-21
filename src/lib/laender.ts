/**
 * Länder für Kundenadressen (ISO 3166 alpha-2, wie Lexware sie erwartet – Doku „FAQ → Country Codes“). Bewusst eine
 * kurze Liste: Deutschland, Nachbarländer, EU und die üblichen Nicht-EU-Länder im Handwerk. Erweiterbar ohne Migration
 * (die Datenbank prüft nur das Format).
 */
export const LAENDER = [
	['DE', 'Deutschland'],
	['AT', 'Österreich'],
	['CH', 'Schweiz'],
	['LI', 'Liechtenstein'],
	['LU', 'Luxemburg'],
	['NL', 'Niederlande'],
	['BE', 'Belgien'],
	['FR', 'Frankreich'],
	['DK', 'Dänemark'],
	['PL', 'Polen'],
	['CZ', 'Tschechien'],
	['IT', 'Italien'],
	['ES', 'Spanien'],
	['PT', 'Portugal'],
	['SE', 'Schweden'],
	['FI', 'Finnland'],
	['NO', 'Norwegen'],
	['IE', 'Irland'],
	['GR', 'Griechenland'],
	['HU', 'Ungarn'],
	['SK', 'Slowakei'],
	['SI', 'Slowenien'],
	['HR', 'Kroatien'],
	['RO', 'Rumänien'],
	['BG', 'Bulgarien'],
	['EE', 'Estland'],
	['LV', 'Lettland'],
	['LT', 'Litauen'],
	['MT', 'Malta'],
	['CY', 'Zypern'],
	['GB', 'Vereinigtes Königreich'],
	['TR', 'Türkei'],
	['US', 'Vereinigte Staaten']
] as const;

export type Land = (typeof LAENDER)[number][0];
const NAMEN = new Map<string, string>(LAENDER);

export const istLand = (w: unknown): w is Land => typeof w === 'string' && NAMEN.has(w);
export const landName = (code: string | null | undefined): string => (code ? (NAMEN.get(code) ?? code) : 'Deutschland');
