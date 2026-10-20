import { berlinTag } from './zeit';

/**
 * Offline-Kopie von „Meine Einsätze heute“ (Pflichtenheft Abschnitt 2: Termine des Tages bleiben bei schlechtem Netz
 * verfügbar). Liegt nur im `localStorage` des Geräts des Benutzers – nie im Service Worker –, gilt nur für den
 * heutigen Berliner Tag (ältere Kopien werden beim Lesen gelöscht) und wird beim Abmelden entfernt. Gespeichert
 * werden nur Zeit, Auftrag, Kunde, Ort und Notiz – keine Preise.
 *
 * Die Kopie gehört genau einem Benutzer: Jede App-Seite merkt sich eine Kennung des angemeldeten Benutzers (Hash der
 * ID, `merkeNutzer`) und löscht dabei die Kopie eines anderen; `lade` gibt sie nur für diese Kennung heraus. So sieht
 * auf einem geteilten Gerät niemand die Einsätze des Vorgängers – auch wenn dessen Sitzung nur abgelaufen ist.
 *
 * Ohne `localStorage` (Server, gesperrter Speicher) tun alle Funktionen nichts bzw. liefern `null`.
 */

export const SCHLUESSEL = 'crm-heute-v1';
/** Kennung (Hash) des zuletzt angemeldeten Benutzers dieses Geräts – keine Klartext-ID. */
export const NUTZER_SCHLUESSEL = 'crm-nutzer-v1';

export type HeuteEinsatz = {
	id: string;
	beginn: string;
	ende: string;
	auftragId: string | null;
	auftragNummer: string;
	auftragTitel: string;
	kundeName: string;
	ort: string | null;
	notiz: string | null;
	/** Links am Auftrag (Jamil msg 2850) – nur Titel, Adresse, Domain. */
	links?: { titel: string; url: string; domain: string }[] | null;
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
	// Links nur, wenn vorhanden: Titel, Adresse (nur http/https), Domain – nichts sonst
	if (Array.isArray(e.links)) {
		sauber.links = e.links
			.filter((l) => typeof l?.url === 'string' && /^https?:\/\//i.test(l.url))
			.slice(0, 10)
			.map((l) => ({ titel: String(l.titel ?? '').slice(0, 200), url: l.url.slice(0, 2000), domain: String(l.domain ?? '').slice(0, 200) }));
	}
	return sauber as HeuteEinsatz;
}

/** Nicht umkehrbare, kurze Kennung einer Benutzer-ID (FNV-1a, zweimal 32 Bit) – nur zum Vergleichen. */
export function nutzerKennung(benutzerId: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < benutzerId.length; i++) {
		const c = benutzerId.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = Math.imul(b ^ c ^ (i & 0xff), 0x811c9dc5) >>> 0;
	}
	return `n${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Die gemerkte Kennung des Benutzers dieses Geräts (oder `null`). */
export function gemerkterNutzer(): string | null {
	try {
		return speicher()?.getItem(NUTZER_SCHLUESSEL) ?? null;
	} catch {
		return null;
	}
}

/**
 * Merkt sich den angemeldeten Benutzer (Kennung aus `nutzerKennung`). Gehört die vorhandene Kopie jemand anderem,
 * wird sie sofort gelöscht.
 */
export function merkeNutzer(kennung: string): void {
	const s = speicher();
	if (!s) return;
	try {
		const roh = s.getItem(SCHLUESSEL);
		if (roh !== null) {
			const kopie = JSON.parse(roh);
			if (typeof kopie?.benutzerId !== 'string' || nutzerKennung(kopie.benutzerId) !== kennung) loesche();
		}
	} catch {
		loesche();
	}
	try {
		s.setItem(NUTZER_SCHLUESSEL, kennung);
	} catch {
		// gesperrter Speicher
	}
}

export function speichere(benutzerId: string, tag: string, einsaetze: HeuteEinsatz[], jetzt: Date): void {
	const s = speicher();
	if (!s) return;
	merkeNutzer(nutzerKennung(benutzerId));
	const kopie: HeuteKopie = { benutzerId, tag, stand: jetzt.toISOString(), einsaetze: einsaetze.map(bereinige) };
	try {
		s.setItem(SCHLUESSEL, JSON.stringify(kopie));
	} catch {
		// Speicher voll oder gesperrt: dann eben ohne Offline-Kopie
	}
}

/**
 * Die Kopie von heute (Berlin, bezogen auf `jetzt`) für den Benutzer mit der Kennung `aktuellerNutzer` – sonst
 * `null`. Eine veraltete, kaputte oder fremde Kopie (anderer bzw. unbekannter Benutzer) wird gelöscht.
 */
export function lade(jetzt: Date, aktuellerNutzer: string | null): HeuteKopie | null {
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
	if (
		!kopie ||
		kopie.tag !== berlinTag(jetzt) ||
		aktuellerNutzer === null ||
		nutzerKennung(kopie.benutzerId) !== aktuellerNutzer
	) {
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
