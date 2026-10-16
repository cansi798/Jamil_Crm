import { berlinTag } from './zeit';

/**
 * Offline-Kopie von „Meine Einsätze heute“ (Pflichtenheft Abschnitt 2: Termine des Tages bleiben bei schlechtem Netz
 * verfügbar). Liegt nur im `localStorage` des Geräts des Benutzers – nie im Service Worker –, gilt nur für den
 * heutigen Berliner Tag (ältere Kopien werden beim Lesen gelöscht) und wird beim Abmelden entfernt. Gespeichert
 * werden nur Zeit, Auftrag, Kunde, Ort und Notiz – keine Preise.
 *
 * Ohne `localStorage` (Server, gesperrter Speicher) tun alle Funktionen nichts bzw. liefern `null`.
 */

export const SCHLUESSEL = 'crm-heute-v1';

export type HeuteEinsatz = {
	id: string;
	beginn: string;
	ende: string;
	auftragId: string;
	auftragNummer: string;
	auftragTitel: string;
	kundeName: string;
	ort: string | null;
	notiz: string | null;
};

export type HeuteKopie = { benutzerId: string; tag: string; stand: string; einsaetze: HeuteEinsatz[] };

const FELDER = ['id', 'beginn', 'ende', 'auftragId', 'auftragNummer', 'auftragTitel', 'kundeName', 'ort', 'notiz'] as const;

function speicher(): Storage | null {
	try {
		return (globalThis as { localStorage?: Storage }).localStorage ?? null;
	} catch {
		return null; // z. B. gesperrter Speicher im Browser
	}
}

/** Nur die erlaubten Felder übernehmen (Positivliste). */
function bereinige(e: HeuteEinsatz): HeuteEinsatz {
	const sauber: Record<string, unknown> = {};
	for (const f of FELDER) sauber[f] = e[f] ?? null;
	return sauber as HeuteEinsatz;
}

export function speichere(benutzerId: string, tag: string, einsaetze: HeuteEinsatz[], jetzt: Date): void {
	const s = speicher();
	if (!s) return;
	const kopie: HeuteKopie = { benutzerId, tag, stand: jetzt.toISOString(), einsaetze: einsaetze.map(bereinige) };
	try {
		s.setItem(SCHLUESSEL, JSON.stringify(kopie));
	} catch {
		// Speicher voll oder gesperrt: dann eben ohne Offline-Kopie
	}
}

/** Die Kopie von heute (Berlin, bezogen auf `jetzt`) – sonst `null`; eine veraltete oder kaputte Kopie wird gelöscht. */
export function lade(jetzt: Date): HeuteKopie | null {
	const s = speicher();
	if (!s) return null;
	let kopie: HeuteKopie | null = null;
	try {
		const roh = s.getItem(SCHLUESSEL);
		if (roh === null) return null;
		const wert = JSON.parse(roh);
		if (
			wert &&
			typeof wert.benutzerId === 'string' &&
			typeof wert.tag === 'string' &&
			typeof wert.stand === 'string' &&
			Array.isArray(wert.einsaetze)
		) {
			kopie = { benutzerId: wert.benutzerId, tag: wert.tag, stand: wert.stand, einsaetze: wert.einsaetze };
		}
	} catch {
		kopie = null;
	}
	if (!kopie || kopie.tag !== berlinTag(jetzt)) {
		loesche();
		return null;
	}
	return kopie;
}

export function loesche(): void {
	try {
		speicher()?.removeItem(SCHLUESSEL);
	} catch {
		// nichts zu tun
	}
}
