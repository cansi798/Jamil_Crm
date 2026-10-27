/**
 * Leistungen für Bestandskunden im Kundenportal (Jamil, Talk msg 3408 vom 27.10.): Der Betrieb legt selbst fest, ob die
 * Karte erscheint, wie sie heißt, was darin steht und welche Knöpfe mit welchen Links es gibt. Reines Wissen ohne
 * Serverbezug – Prüfung und Standardwerte stehen hier, damit Einstellungen, Portal und Tests dieselben Regeln nutzen.
 */

export type BestandSymbol = 'haus' | 'garten' | 'winter' | 'reparatur' | 'barrierefrei' | 'herz' | 'stern' | 'kalender' | 'telefon' | 'schluessel';

/** Strich-Symbole (24 × 24) im Stil des Portals; Schlüssel werden gespeichert, nie Pfade. */
export const BESTAND_SYMBOLE: Record<BestandSymbol, { name: string; pfad: string }> = {
	haus: { name: 'Haus', pfad: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5' },
	garten: { name: 'Pflanze', pfad: 'M12 20v-8M12 12c-4 0-6-3-6-7 4 0 6 3 6 7Zm0 0c4 0 6-3 6-7-4 0-6 3-6 7ZM5 20h14' },
	winter: { name: 'Schneeflocke', pfad: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5' },
	reparatur: { name: 'Werkzeug', pfad: 'M14.5 5.5a4 4 0 0 0 5 5L12 18l-3 1 1-3 7.5-7.5M4 20l5-5' },
	barrierefrei: { name: 'Handlauf', pfad: 'M7 4v16M7 9h10M17 9v11M12 9v4' },
	herz: { name: 'Herz', pfad: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z' },
	stern: { name: 'Stern', pfad: 'M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9Z' },
	kalender: { name: 'Kalender', pfad: 'M5 6h14v14H5ZM5 10h14M9 4v4M15 4v4' },
	telefon: { name: 'Telefon', pfad: 'M6 4h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 4 6a2 2 0 0 1 2-2Z' },
	schluessel: { name: 'Schlüssel', pfad: 'M14 10a4 4 0 1 1-1.2-2.8M13 11l7 7M17 15l2-2M15 17l2-2' }
};
export const BESTAND_SYMBOL_SCHLUESSEL = Object.keys(BESTAND_SYMBOLE) as BestandSymbol[];

export type BestandLeistung = { titel: string; text: string; symbol: BestandSymbol };
export type BestandKnopf = { text: string; url: string };
export type BestandEinstellung = { aktiv: boolean; titel: string; text: string; leistungen: BestandLeistung[]; knoepfe: BestandKnopf[] };

/** Grenzen (gleich in Formular, Prüfung und Datenbank – Migration 107). */
export const BESTAND_GRENZEN = { titel: 60, text: 240, leistungen: 10, leistungTitel: 60, leistungText: 160, knoepfe: 4, knopfText: 30, url: 500 } as const;

export const BESTAND_STANDARD_TITEL = 'Auch nach Abschluss für Sie da';
export const BESTAND_STANDARD_TEXT = 'Gerne unterstützen wir Sie auch künftig – sprechen Sie uns einfach an, wenn wir helfen können.';
export const BESTAND_STANDARD_LEISTUNGEN: BestandLeistung[] = [
	{ titel: 'Hausmeisterservice', text: '', symbol: 'haus' },
	{ titel: 'Garten- und Grundstückspflege', text: '', symbol: 'garten' },
	{ titel: 'Winterdienst', text: '', symbol: 'winter' },
	{ titel: 'Kleinreparaturen', text: '', symbol: 'reparatur' },
	{ titel: 'Altersgerechte Anpassungen', text: '', symbol: 'barrierefrei' },
	{ titel: 'Individuelle Unterstützung', text: '', symbol: 'herz' }
];

export const bestandStandard = (): BestandEinstellung => ({
	aktiv: true,
	titel: BESTAND_STANDARD_TITEL,
	text: BESTAND_STANDARD_TEXT,
	leistungen: BESTAND_STANDARD_LEISTUNGEN.map((l) => ({ ...l })),
	knoepfe: []
});

// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/g;
const bereinige = (w: unknown) => (typeof w === 'string' ? w.replace(STEUERZEICHEN, ' ').replace(/\s+/g, ' ').trim() : '');

export type LinkErgebnis = { ok: true; url: string } | { ok: false; fehler: string };

/**
 * Erlaubt sind nur `https://…`, `mailto:adresse` und `tel:nummer` – nie `javascript:`, `data:`, `http:` o. Ä.
 * Gibt die bereinigte Adresse zurück (Telefonnummer ohne Leerzeichen).
 */
export function pruefeLink(roh: unknown): LinkErgebnis {
	const w = typeof roh === 'string' ? roh.trim() : '';
	if (!w) return { ok: false, fehler: 'Bitte eine Adresse eintragen.' };
	if (w.length > BESTAND_GRENZEN.url) return { ok: false, fehler: `Die Adresse ist zu lang (höchstens ${BESTAND_GRENZEN.url} Zeichen).` };
	if (/[\s<>"'\\\u0000-\u001f\u007f]/.test(w)) return { ok: false, fehler: 'Die Adresse darf keine Leerzeichen oder Sonderzeichen wie < > " enthalten.' };
	const kleiner = w.toLowerCase();
	if (kleiner.startsWith('https://')) {
		try {
			const u = new URL(w);
			if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) throw new Error();
			return { ok: true, url: u.href };
		} catch {
			return { ok: false, fehler: 'Das ist keine gültige Internetadresse (z. B. https://www.ihre-firma.de/anfrage).' };
		}
	}
	if (kleiner.startsWith('mailto:')) {
		const adresse = w.slice(7);
		return /^[^@\s,;?&]+@[^@\s,;?&]+\.[^@\s,;?&]{2,}$/.test(adresse) ? { ok: true, url: `mailto:${adresse}` } : { ok: false, fehler: 'Das ist keine gültige E-Mail-Adresse (z. B. mailto:info@ihre-firma.de).' };
	}
	if (kleiner.startsWith('tel:')) {
		const nummer = w.slice(4).replace(/[()\-/.]/g, '');
		return /^\+?[0-9]{5,20}$/.test(nummer) ? { ok: true, url: `tel:${nummer}` } : { ok: false, fehler: 'Das ist keine gültige Telefonnummer (z. B. tel:+4940123456).' };
	}
	return { ok: false, fehler: 'Erlaubt sind nur Adressen mit https://, mailto: oder tel:.' };
}

export type BestandErgebnis = { ok: true; wert: BestandEinstellung } | { ok: false; fehler: string };

/** Prüft und bereinigt Eingaben (Formular, später auch API); gibt die erste verständliche Fehlermeldung zurück. */
export function pruefeBestand(roh: unknown): BestandErgebnis {
	const e = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
	const G = BESTAND_GRENZEN;
	const titel = bereinige(e.titel);
	if (titel.length > G.titel) return { ok: false, fehler: `Die Überschrift ist zu lang (höchstens ${G.titel} Zeichen).` };
	const text = bereinige(e.text);
	if (text.length > G.text) return { ok: false, fehler: `Der Einleitungstext ist zu lang (höchstens ${G.text} Zeichen).` };
	const l = Array.isArray(e.leistungen) ? e.leistungen : [];
	const k = Array.isArray(e.knoepfe) ? e.knoepfe : [];
	if (l.length > G.leistungen) return { ok: false, fehler: `Höchstens ${G.leistungen} Leistungen.` };
	if (k.length > G.knoepfe) return { ok: false, fehler: `Höchstens ${G.knoepfe} Knöpfe.` };
	const leistungen: BestandLeistung[] = [];
	for (const [i, x] of l.entries()) {
		const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
		const t = bereinige(o.titel);
		const tx = bereinige(o.text);
		if (!t) return { ok: false, fehler: `Leistung ${i + 1}: Bitte einen Titel eintragen.` };
		if (t.length > G.leistungTitel) return { ok: false, fehler: `Leistung ${i + 1}: Der Titel ist zu lang (höchstens ${G.leistungTitel} Zeichen).` };
		if (tx.length > G.leistungText) return { ok: false, fehler: `Leistung ${i + 1}: Der Text ist zu lang (höchstens ${G.leistungText} Zeichen).` };
		const symbol = BESTAND_SYMBOL_SCHLUESSEL.find((s) => s === o.symbol) ?? 'stern';
		leistungen.push({ titel: t, text: tx, symbol });
	}
	const knoepfe: BestandKnopf[] = [];
	for (const [i, x] of k.entries()) {
		const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
		const t = bereinige(o.text);
		if (!t) return { ok: false, fehler: `Knopf ${i + 1}: Bitte eine Beschriftung eintragen.` };
		if (t.length > G.knopfText) return { ok: false, fehler: `Knopf ${i + 1}: Die Beschriftung ist zu lang (höchstens ${G.knopfText} Zeichen).` };
		const link = pruefeLink(o.url);
		if (!link.ok) return { ok: false, fehler: `Knopf ${i + 1} („${t}“): ${link.fehler}` };
		knoepfe.push({ text: t, url: link.url });
	}
	return { ok: true, wert: { aktiv: e.aktiv === true || e.aktiv === 'ja' || e.aktiv === 'on', titel: titel || BESTAND_STANDARD_TITEL, text, leistungen, knoepfe } };
}

/** Karte, wie der Kunde sie sieht (ohne den Schalter). */
export type BestandKarte = Pick<BestandEinstellung, 'titel' | 'text' | 'leistungen' | 'knoepfe'>;

/**
 * Soll die Karte im Portal stehen? Nur wenn der Betrieb sie eingeschaltet hat, der Kunde Bestandskunde ist (ein Auftrag
 * abgeschlossen: „Projekt erfolgreich beendet“) und überhaupt etwas darin steht. Sonst `null`.
 */
export function bestandKarteFuer(e: BestandEinstellung, bestandskunde: boolean): BestandKarte | null {
	if (!e.aktiv || !bestandskunde) return null;
	if (e.leistungen.length === 0 && e.knoepfe.length === 0 && !e.text) return null;
	return { titel: e.titel, text: e.text, leistungen: e.leistungen, knoepfe: e.knoepfe };
}

/** Aus der Datenbank (jsonb) gelesene Werte → gültige Einstellung; kaputte oder fehlende Werte fallen auf den Standard zurück. */
export function bestandAusDatenbank(z: { bestand_aktiv?: unknown; bestand_titel?: unknown; bestand_text?: unknown; bestand_leistungen?: unknown; bestand_knoepfe?: unknown } | undefined): BestandEinstellung {
	const std = bestandStandard();
	if (!z) return std;
	const r = pruefeBestand({
		aktiv: z.bestand_aktiv !== false,
		titel: z.bestand_titel ?? std.titel,
		text: z.bestand_text ?? std.text,
		leistungen: z.bestand_leistungen ?? std.leistungen,
		knoepfe: z.bestand_knoepfe ?? std.knoepfe
	});
	return r.ok ? r.wert : { ...std, aktiv: z.bestand_aktiv !== false };
}
