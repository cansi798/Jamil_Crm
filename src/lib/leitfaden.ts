/**
 * Leitfaden beim Termin (Wunsch Jamil, Talk msgs 4302/4304, Entscheidungen 4340: 1c / 2b / 3a / 4b).
 *
 * - EIN Leitfaden je Firma (3a), ein-/ausschaltbar, Schritte frei anpassbar.
 * - Erscheint bei den Terminen, deren Art bzw. Terminart in den Einstellungen angehakt ist (1c; Standard: Besichtigung).
 * - EINE Fläche: Der Experte trägt alles dort ein, das CRM legt es in Kundenakte, Dokumenten, Aufgaben, Notizen und
 *   Verlauf ab (4304).
 * - Fehlen Pflichtschritte, geht Abschließen nur mit Begründung – das Büro bekommt einen Hinweis (2b).
 * - Eingaben gehen auch offline und werden später nachgeschickt (4b): jede Eingabe hat eine eigene Kennung (`opId`,
 *   doppelt Gesendetes wirkt nur einmal) und einen Zeitpunkt (`zeit`, die spätere Eingabe je Schritt gewinnt).
 *
 * Reine Funktionen ohne Serverbezug – Server, Leitfaden-Seite und Offline-Seite rechnen gleich.
 */
import { istKontaktweg, KONTAKTWEG_NAMEN, type Kontaktweg } from './kontaktweg';

export const SCHRITT_TYPEN = ['hinweis', 'frage', 'kundendaten', 'abhaken', 'foto', 'aufgabe', 'notiz'] as const;
export type SchrittTyp = (typeof SCHRITT_TYPEN)[number];

export const SCHRITT_TYP_NAMEN: Record<SchrittTyp, string> = {
	hinweis: 'Hinweis (nur lesen)',
	frage: 'Frage an den Kunden',
	kundendaten: 'Kundendaten prüfen/ergänzen',
	abhaken: 'Abhaken',
	foto: 'Fotos',
	aufgabe: 'Aufgabe anlegen',
	notiz: 'Notiz'
};

export const ANTWORT_ARTEN = ['text', 'janein', 'auswahl'] as const;
export type AntwortArt = (typeof ANTWORT_ARTEN)[number];
export const ANTWORT_ART_NAMEN: Record<AntwortArt, string> = { text: 'Freitext', janein: 'Ja / Nein', auswahl: 'Auswahl' };

/** Welche Kundendaten ein Schritt prüft bzw. ergänzt – landet direkt in der Kundenakte. */
export const KUNDEN_FELDER = ['email', 'telefon', 'bevorzugter_kontakt', 'adresse'] as const;
export type KundenFeld = (typeof KUNDEN_FELDER)[number];
export const KUNDEN_FELD_NAMEN: Record<KundenFeld, string> = {
	email: 'E-Mail-Adresse',
	telefon: 'Telefonnummer',
	bevorzugter_kontakt: 'Bevorzugter Kontaktweg',
	adresse: 'Adresse'
};

export type Schritt = {
	/** kurze, stabile Kennung innerhalb der Vorlage (a–z, 0–9, -) */
	id: string;
	typ: SchrittTyp;
	titel: string;
	hilfe?: string;
	pflicht: boolean;
	/** frage */
	antwortArt?: AntwortArt;
	optionen?: string[];
	/** kundendaten */
	feld?: KundenFeld;
	/** foto: so viele Fotos mindestens */
	mindestens?: number;
	/** aufgabe: Vorschlag für den Titel der Aufgabe */
	aufgabeTitel?: string;
};

/** Kundendaten, wie sie der Leitfaden kennt (aktueller Stand der Kundenakte). */
export type LeitfadenKunde = {
	email: string | null;
	telefon: string | null;
	bevorzugter_kontakt: Kontaktweg | null;
	strasse: string | null;
	plz: string | null;
	ort: string | null;
};

export type Adresse = { strasse: string; plz: string; ort: string };
export type AufgabeWert = { anlegen: boolean; titel: string };

/** Antwort je Schritt: Wert + Zeitpunkt der Eingabe auf dem Gerät (ISO). Fotos: Liste der Datei-Kennungen. */
export type Antwort = { wert: unknown; zeit: string; von?: string | null };
export type Antworten = Record<string, Antwort>;

export const STATUS = ['offen', 'abgeschlossen', 'mit_begruendung'] as const;
export type LeitfadenStatus = (typeof STATUS)[number];
export const STATUS_NAMEN: Record<LeitfadenStatus, string> = {
	offen: 'offen',
	abgeschlossen: 'erledigt',
	mit_begruendung: 'erledigt mit Begründung'
};

export const MAX_SCHRITTE = 40;
export const MAX_TEXT = 2000;
export const MAX_BEGRUENDUNG = 1000;

/** Startvorlage (ab Werk): Besichtigung beim Kunden – Jamils Beispiele aus msg 4302. */
export const STARTVORLAGE: Schritt[] = [
	{ id: 'begruessung', typ: 'hinweis', titel: 'Begrüßen, vorstellen, Visitenkarte geben', hilfe: 'Kurz erklären, wie die Besichtigung abläuft.', pflicht: false },
	{ id: 'email', typ: 'kundendaten', feld: 'email', titel: 'E-Mail-Adresse des Kunden', hilfe: 'Für Angebot und Unterlagen. Fragen und eintragen.', pflicht: true },
	{ id: 'kontaktweg', typ: 'kundendaten', feld: 'bevorzugter_kontakt', titel: 'Wie möchte der Kunde am liebsten erreicht werden?', pflicht: true },
	{ id: 'telefon', typ: 'kundendaten', feld: 'telefon', titel: 'Telefonnummer', pflicht: false },
	{ id: 'vorhaben', typ: 'frage', antwortArt: 'text', titel: 'Was genau soll gemacht werden?', hilfe: 'Wünsche, Maße, Besonderheiten.', pflicht: true },
	{ id: 'zeitraum', typ: 'frage', antwortArt: 'auswahl', optionen: ['so bald wie möglich', 'in 1–3 Monaten', 'später / offen'], titel: 'Wann soll es losgehen?', pflicht: false },
	{ id: 'fotos', typ: 'foto', mindestens: 2, titel: 'Fotos vom Bereich (mindestens 2)', hilfe: 'Übersicht und Details, z. B. Anschlüsse, Zähler.', pflicht: true },
	{ id: 'zugang', typ: 'abhaken', titel: 'Zugang, Parken und Strom geklärt', pflicht: false },
	{ id: 'angebot', typ: 'aufgabe', aufgabeTitel: 'Angebot erstellen', titel: 'Aufgabe fürs Büro: Angebot erstellen', pflicht: false },
	{ id: 'sonstiges', typ: 'notiz', titel: 'Sonstiges / Notizen', pflicht: false }
];

const ID = /^[a-z0-9-]{1,40}$/;
const ist = <T extends string>(liste: readonly T[], w: unknown): w is T => typeof w === 'string' && (liste as readonly string[]).includes(w);

/** Text kürzen/säubern: Zeichenkette, ohne NUL, getrimmt, höchstens `max` Zeichen; sonst ''. */
export function text(w: unknown, max = MAX_TEXT): string {
	if (typeof w !== 'string') return '';
	return [...w.replaceAll('\u0000', '').trim()].slice(0, max).join('');
}

/** Prüft die Schritte einer Vorlage (Einstellungsseite). Wirft `Error` mit deutscher Meldung. */
export function pruefeSchritte(roh: unknown): Schritt[] {
	if (!Array.isArray(roh)) throw new Error('Die Schritte fehlen.');
	if (roh.length === 0) throw new Error('Der Leitfaden braucht mindestens einen Schritt.');
	if (roh.length > MAX_SCHRITTE) throw new Error(`Höchstens ${MAX_SCHRITTE} Schritte.`);
	const ids = new Set<string>();
	return roh.map((r, i) => {
		const nr = i + 1;
		if (!r || typeof r !== 'object') throw new Error(`Schritt ${nr} ist ungültig.`);
		const o = r as Record<string, unknown>;
		const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : '';
		if (!id) throw new Error(`Schritt ${nr}: ungültige Kennung.`);
		if (ids.has(id)) throw new Error(`Schritt ${nr}: Kennung „${id}“ kommt doppelt vor.`);
		ids.add(id);
		if (!ist(SCHRITT_TYPEN, o.typ)) throw new Error(`Schritt ${nr}: unbekannte Art.`);
		const titel = text(o.titel, 200);
		if (!titel) throw new Error(`Schritt ${nr}: Bitte einen Titel eingeben.`);
		const s: Schritt = { id, typ: o.typ, titel, pflicht: o.typ === 'hinweis' ? false : o.pflicht === true };
		const hilfe = text(o.hilfe, 500);
		if (hilfe) s.hilfe = hilfe;
		if (o.typ === 'frage') {
			s.antwortArt = ist(ANTWORT_ARTEN, o.antwortArt) ? o.antwortArt : 'text';
			if (s.antwortArt === 'auswahl') {
				const opt = Array.isArray(o.optionen) ? [...new Set(o.optionen.map((x) => text(x, 100)).filter(Boolean))].slice(0, 12) : [];
				if (opt.length < 2) throw new Error(`Schritt ${nr}: Eine Auswahl braucht mindestens zwei Antworten.`);
				s.optionen = opt;
			}
		}
		if (o.typ === 'kundendaten') {
			if (!ist(KUNDEN_FELDER, o.feld)) throw new Error(`Schritt ${nr}: Bitte wählen, welche Kundendaten geprüft werden.`);
			s.feld = o.feld;
		}
		if (o.typ === 'foto') {
			const n = Number(o.mindestens ?? 1);
			s.mindestens = Number.isInteger(n) && n >= 1 && n <= 20 ? n : 1;
		}
		if (o.typ === 'aufgabe') s.aufgabeTitel = text(o.aufgabeTitel, 200) || titel;
		return s;
	});
}

/** Neue, freie Kennung für einen Schritt (Einstellungsseite). */
export function neueSchrittId(vorhanden: Iterable<string>, typ: SchrittTyp): string {
	const belegt = new Set(vorhanden);
	for (let i = 1; ; i++) {
		const id = `${typ}-${i}`;
		if (!belegt.has(id)) return id;
	}
}

const leer = (w: string | null | undefined) => !w || w.trim() === '';

/** Wert eines Kundendaten-Schritts aus der Kundenakte (für Anzeige und Prüfung). */
export function kundenWert(feld: KundenFeld, k: LeitfadenKunde | null): string | Adresse | null {
	if (!k) return null;
	if (feld === 'adresse') return leer(k.strasse) && leer(k.plz) && leer(k.ort) ? null : { strasse: k.strasse ?? '', plz: k.plz ?? '', ort: k.ort ?? '' };
	const w = k[feld];
	return leer(w) ? null : (w as string);
}

/** Anzeige eines Kundendaten-Werts („E-Mail“, „Musterweg 1, 12345 Ort“). */
export function kundenWertText(feld: KundenFeld, w: unknown): string {
	if (w === null || w === undefined || w === '') return '–';
	if (feld === 'bevorzugter_kontakt') return istKontaktweg(w) ? KONTAKTWEG_NAMEN[w] : '–';
	if (feld === 'adresse' && typeof w === 'object') {
		const a = w as Adresse;
		return [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–';
	}
	return String(w);
}

/** Ist ein Schritt erledigt? Kundendaten zählen, sobald sie in der Kundenakte stehen (egal woher). */
export function istErledigt(s: Schritt, a: Antwort | undefined, kunde: LeitfadenKunde | null): boolean {
	switch (s.typ) {
		case 'hinweis':
			return true;
		case 'kundendaten':
			return kundenWert(s.feld!, kunde) !== null;
		case 'frage':
		case 'notiz':
			return typeof a?.wert === 'string' && a.wert.trim() !== '';
		case 'abhaken':
			return a?.wert === true;
		case 'foto':
			return Array.isArray(a?.wert) && a.wert.length >= (s.mindestens ?? 1);
		case 'aufgabe':
			return !!a && typeof a.wert === 'object' && a.wert !== null && typeof (a.wert as AufgabeWert).anlegen === 'boolean';
	}
}

/** Offene Pflichtschritte (in Reihenfolge). */
export function fehlendePflicht(schritte: Schritt[], antworten: Antworten, kunde: LeitfadenKunde | null): Schritt[] {
	return schritte.filter((s) => s.pflicht && !istErledigt(s, antworten[s.id], kunde));
}

/** Fortschritt: erledigte (ohne reine Hinweise) von allen. */
export function fortschritt(schritte: Schritt[], antworten: Antworten, kunde: LeitfadenKunde | null): { erledigt: number; gesamt: number } {
	const zaehlen = schritte.filter((s) => s.typ !== 'hinweis');
	return { erledigt: zaehlen.filter((s) => istErledigt(s, antworten[s.id], kunde)).length, gesamt: zaehlen.length };
}

/**
 * Prüft und bereinigt den Wert einer Eingabe für einen Schritt. Fotos laufen über einen eigenen Weg (Datei hochladen) –
 * hier nicht erlaubt. Wirft `Error` mit deutscher Meldung.
 */
export function pruefeWert(s: Schritt, w: unknown): unknown {
	switch (s.typ) {
		case 'hinweis':
			throw new Error('Ein Hinweis braucht keine Eingabe.');
		case 'foto':
			throw new Error('Fotos bitte über „Foto aufnehmen“ hinzufügen.');
		case 'abhaken':
			if (typeof w !== 'boolean') throw new Error('Bitte abhaken oder nicht.');
			return w;
		case 'notiz':
			return text(w);
		case 'frage': {
			if (s.antwortArt === 'janein') {
				if (w !== 'ja' && w !== 'nein' && w !== '') throw new Error('Bitte „Ja“ oder „Nein“ wählen.');
				return w;
			}
			if (s.antwortArt === 'auswahl') {
				if (w !== '' && !(s.optionen ?? []).includes(w as string)) throw new Error('Bitte eine der Antworten wählen.');
				return w;
			}
			return text(w);
		}
		case 'aufgabe': {
			const o = (w ?? {}) as Record<string, unknown>;
			if (typeof o.anlegen !== 'boolean') throw new Error('Bitte wählen, ob die Aufgabe angelegt wird.');
			return { anlegen: o.anlegen, titel: text(o.titel, 200) || s.aufgabeTitel || s.titel } satisfies AufgabeWert;
		}
		case 'kundendaten': {
			if (s.feld === 'adresse') {
				const o = (w ?? {}) as Record<string, unknown>;
				return { strasse: text(o.strasse, 200), plz: text(o.plz, 20), ort: text(o.ort, 200) } satisfies Adresse;
			}
			if (s.feld === 'bevorzugter_kontakt') {
				if (w !== '' && !istKontaktweg(w)) throw new Error('Bitte E-Mail, Chat oder Telefon wählen.');
				return w;
			}
			return text(w, s.feld === 'telefon' ? 50 : 200);
		}
	}
}

/**
 * Eine Eingabe in die Antworten übernehmen: Die spätere Eingabe (nach `zeit`) gewinnt; eine ältere, die erst später
 * ankommt (offline), ändert nichts. Gibt die neuen Antworten und ob sich etwas geändert hat zurück.
 */
export function uebernimm(antworten: Antworten, schrittId: string, wert: unknown, zeit: string, von: string | null = null): { antworten: Antworten; geaendert: boolean } {
	const alt = antworten[schrittId];
	if (alt && alt.zeit > zeit) return { antworten, geaendert: false };
	return { antworten: { ...antworten, [schrittId]: { wert, zeit, von } }, geaendert: true };
}

/** Termin-Art bzw. Terminart passt zu den Einstellungen (1c)? */
export function giltFuer(e: { aktiv: boolean; arten: string[]; terminarten: string[] }, termin: { art: string; terminartId: string | null; mitAuftrag: boolean }): boolean {
	if (!e.aktiv || !termin.mitAuftrag) return false;
	return e.arten.includes(termin.art) || (termin.terminartId !== null && e.terminarten.includes(termin.terminartId));
}

/** Zusammenfassung als Text (Notiz am Auftrag beim Abschluss). */
export function zusammenfassung(
	name: string,
	schritte: Schritt[],
	antworten: Antworten,
	kunde: LeitfadenKunde | null,
	begruendung: string | null
): string {
	const zeilen = [`${name} – Ergebnis`];
	for (const s of schritte) {
		if (s.typ === 'hinweis') continue;
		const a = antworten[s.id];
		let w: string;
		switch (s.typ) {
			case 'kundendaten':
				w = kundenWertText(s.feld!, kundenWert(s.feld!, kunde));
				break;
			case 'abhaken':
				w = a?.wert === true ? 'erledigt' : 'nicht abgehakt';
				break;
			case 'foto':
				w = `${Array.isArray(a?.wert) ? a.wert.length : 0} Foto(s)`;
				break;
			case 'aufgabe':
				w = a ? ((a.wert as AufgabeWert).anlegen ? `angelegt: ${(a.wert as AufgabeWert).titel}` : 'nicht angelegt') : '–';
				break;
			default:
				w = typeof a?.wert === 'string' && a.wert.trim() ? a.wert : '–';
		}
		zeilen.push(`• ${s.titel}: ${w}`);
	}
	if (begruendung) zeilen.push('', `Begründung für fehlende Pflichtschritte: ${begruendung}`);
	return zeilen.join('\n');
}
