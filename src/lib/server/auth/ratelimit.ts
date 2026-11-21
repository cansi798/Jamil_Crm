/**
 * Schutz vor Durchprobieren: höchstens `max` Anmeldeversuche je Schlüssel (kleingeschriebene E-Mail)
 * innerhalb von `fensterMs`. Im Speicher des Serverprozesses – bei Neustart beginnt die Zählung neu.
 *
 * Jeder Versuch wird gezählt, bevor das Passwort geprüft wird (so zählen auch gleichzeitige Anfragen).
 * Ein Erfolg setzt den Zähler zurück. Abgelehnte Versuche werden nicht gezählt und verlängern die Sperre nicht.
 */

export type BegrenzungOptionen = {
	max?: number;
	fensterMs?: number;
	/** Ab dieser Zahl gemerkter Schlüssel werden abgelaufene Einträge aufgeräumt. */
	aufraeumenAb?: number;
};

export function erzeugeBegrenzung(opts: BegrenzungOptionen = {}) {
	const max = opts.max ?? 5;
	const fensterMs = opts.fensterMs ?? 15 * 60 * 1000;
	const aufraeumenAb = opts.aufraeumenAb ?? 1000;
	const versuche = new Map<string, number[]>();

	function aufraeumen(jetzt: number): void {
		for (const [schluessel, zeiten] of versuche) {
			if (!zeiten.some((t) => jetzt - t < fensterMs)) versuche.delete(schluessel);
		}
	}

	return {
		/** Zählt einen Versuch und sagt, ob er stattfinden darf. */
		pruefeVersuch(schluessel: string, jetzt: number = Date.now()): { erlaubt: boolean } {
			if (versuche.size >= aufraeumenAb) aufraeumen(jetzt);
			const aktuell = (versuche.get(schluessel) ?? []).filter((t) => jetzt - t < fensterMs);
			if (aktuell.length >= max) {
				versuche.set(schluessel, aktuell);
				return { erlaubt: false };
			}
			aktuell.push(jetzt);
			versuche.set(schluessel, aktuell);
			return { erlaubt: true };
		},
		/** Ist der Schlüssel zurzeit gesperrt? Zählt NICHT mit (für „nur Fehlversuche zählen“). */
		gesperrt(schluessel: string, jetzt: number = Date.now()): boolean {
			return (versuche.get(schluessel) ?? []).filter((t) => jetzt - t < fensterMs).length >= max;
		},
		/** Nach erfolgreicher Anmeldung. */
		zuruecksetzen(schluessel: string): void {
			versuche.delete(schluessel);
		},
		/** Verwirft alles (für Tests). */
		leeren(): void {
			versuche.clear();
		},
		groesse(): number {
			return versuche.size;
		}
	};
}

const standard = erzeugeBegrenzung();

export const pruefeVersuch = standard.pruefeVersuch;
export const zuruecksetzen = standard.zuruecksetzen;
export const leereVersuche = standard.leeren;

/**
 * Zweite Grenze je IP-Adresse gegen „Passwort-Sprühen“ (wenige Passwörter über sehr viele E-Mail-Adressen – die Grenze
 * je E-Mail greift dabei nie). Gezählt werden nur FEHLversuche: 50 je IP in 15 Minuten. Ein Büro hinter einer
 * gemeinsamen Adresse merkt davon nichts, erfolgreiche Anmeldungen zählen nicht.
 */
const jeIp = erzeugeBegrenzung({ max: 50 });
export const ipGesperrt = (ip: string) => jeIp.gesperrt(ip);
export const zaehleIpFehlversuch = (ip: string) => void jeIp.pruefeVersuch(ip);
export const leereIpVersuche = jeIp.leeren;
