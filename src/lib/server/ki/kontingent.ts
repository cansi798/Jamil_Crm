import { mitBetrieb, type Kontext } from '../db';
import { ApiFehler } from '../fehler';

/**
 * KI-Kontingent je Betrieb und Kalendermonat (Europe/Berlin) gegen `grenzen.ki_pro_monat` des Tarifs. Jede
 * KI-Anfrage (Aktion aus Text, Angebotsentwurf) verbraucht vorher einen Platz; die Spracherkennung allein zählt nicht.
 * Gezählt wird atomar in der Datenbank (`app.ki_verbrauche`, Migration 016) – auch bei parallelen Anfragen wird die
 * Grenze nie überschritten. Fehlt die Grenze im Tarif, ist das ein Konfigurationsfehler (500), nie „unbegrenzt“.
 */

export type KiArt = 'aktion' | 'entwurf';

export const MELDUNG_KONTINGENT = 'KI-Kontingent dieses Monats aufgebraucht';

/** Verbraucht eine KI-Anfrage; 429, wenn das Kontingent erreicht ist (dann wird nichts gezählt). */
export async function verbrauche(k: Kontext, _art: KiArt): Promise<void> {
	const stand = await mitBetrieb(k, async (tx) => {
		const [z] = await tx<{ stand: number | null }[]>`select app.ki_verbrauche() as stand`;
		return z?.stand ?? null;
	});
	if (stand === null) throw new ApiFehler(429, MELDUNG_KONTINGENT);
}

/** Verbrauch des laufenden Monats und Grenze (`null` = unbegrenzt) – z. B. für Anzeigen. */
export async function kiVerbrauch(k: Kontext): Promise<{ anzahl: number; grenze: number | null }> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select coalesce((
					select n.anzahl from app.ki_nutzung n
					where n.betrieb_id = b.id and n.monat = date_trunc('month', now() at time zone 'Europe/Berlin')::date
				), 0) as anzahl,
				t.grenzen -> 'ki_pro_monat' as grenze
			from app.betriebe b join app.tarife t on t.id = b.tarif_id
			where b.id = ${k.betriebId}`;
		const grenze = z?.grenze;
		return { anzahl: Number(z?.anzahl ?? 0), grenze: typeof grenze === 'number' ? grenze : null };
	});
}
