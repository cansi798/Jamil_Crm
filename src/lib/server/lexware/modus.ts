import { mitBetrieb, type Kontext } from '../db';

/** Führt Lexware die Belege dieses Betriebs (Schalter an und einmal verbunden)? Wie der Datenbank-Trigger (Migration 121). */
export async function lexwareBelegModus(k: Kontext): Promise<boolean> {
	const [z] = await mitBetrieb(k, (tx) => tx`select app.lexware_beleg_modus(${k.betriebId}::uuid) as an`);
	return z?.an === true;
}
