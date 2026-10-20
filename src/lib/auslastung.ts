import { euro } from './geld';

/**
 * Auslastung je Mitarbeiter und Monat mit Break-even (Wunsch Jamil msg 2476, Punkte 4 und 5) – reine Rechnung.
 *
 *   Verfügbar   = produktive Jahresstunden aus der Kalkulation × (Werktage Mo–Fr im Monat ÷ Werktage im Jahr)
 *   Geplant     = Stunden der Einsätze (Plantafel) im Monat
 *   Auslastung  = Geplant ÷ Verfügbar
 *   Umsatz      = angenommene Angebote eines Auftrags, anteilig nach seinen Einsatzstunden in diesem Monat
 *                 (Rechnungen gibt es noch nicht – wie in der Quellen-Auswertung zählen angenommene Angebote)
 *   Ergebnis    = Umsatz − Material − Monatskosten (Kalkulation: alle Kosten inkl. Personal ÷ 12)
 *   Break-even erreicht, wenn das Ergebnis ≥ 0 ist.
 */

const runde1 = (n: number) => Math.round(n * 10) / 10;

export function istMonat(w: unknown): w is string {
	return typeof w === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(w);
}

export function monatPlus(monat: string, n: number): string {
	const [j, m] = monat.split('-').map(Number);
	const d = new Date(Date.UTC(j, m - 1 + n, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Erster Tag des Monats und erster Tag des Folgemonats (ausschließlich). */
export function monatsGrenzen(monat: string): { von: string; bis: string } {
	return { von: `${monat}-01`, bis: `${monatPlus(monat, 1)}-01` };
}

/** Werktage Montag–Freitag von `von` bis `bis` (ausschließlich), Tage als „JJJJ-MM-TT“. Feiertage zählen mit. */
export function werktage(von: string, bis: string): number {
	const start = Date.parse(`${von}T00:00:00Z`);
	const ende = Date.parse(`${bis}T00:00:00Z`);
	let n = 0;
	for (let t = start; t < ende; t += 86_400_000) {
		const w = new Date(t).getUTCDay();
		if (w !== 0 && w !== 6) n++;
	}
	return n;
}

export function verfuegbareStunden(jahresStunden: number, monat: string): number {
	const jahr = monat.slice(0, 4);
	const imJahr = werktage(`${jahr}-01-01`, `${Number(jahr) + 1}-01-01`);
	const { von, bis } = monatsGrenzen(monat);
	return imJahr > 0 ? runde1((jahresStunden * werktage(von, bis)) / imJahr) : 0;
}

export type AuslastungZeile = {
	verfuegbar: number | null;
	geplant: number;
	auslastungProzent: number | null;
	frei: number | null;
	ueberbucht: boolean;
};

/** `verfuegbar` null = nicht in der Kalkulation erfasst (keine Kapazität bekannt). */
export function auslastungZeile(verfuegbar: number | null, geplant: number): AuslastungZeile {
	const g = runde1(geplant);
	if (verfuegbar === null) return { verfuegbar: null, geplant: g, auslastungProzent: null, frei: null, ueberbucht: false };
	return {
		verfuegbar,
		geplant: g,
		auslastungProzent: verfuegbar > 0 ? Math.round((g / verfuegbar) * 100) : null,
		frei: runde1(Math.max(0, verfuegbar - g)),
		ueberbucht: g > verfuegbar
	};
}

export type AuftragsAnteil = { nettoCent: number; materialCent: number; stundenGesamt: number; stundenImMonat: number };

export type BreakEven = {
	kostenCent: number;
	umsatzCent: number;
	materialCent: number;
	deckungsbeitragCent: number;
	/** Gewinn (positiv) bzw. was bis zum Break-even fehlt (negativ). */
	ergebnisCent: number;
	erreicht: boolean;
	/** Deckungsbeitrag in Prozent der Monatskosten – null ohne Kosten. */
	deckungProzent: number | null;
};

export function breakEven(monatskostenCent: number, auftraege: readonly AuftragsAnteil[]): BreakEven {
	let umsatz = 0;
	let material = 0;
	for (const a of auftraege) {
		if (a.stundenGesamt <= 0 || a.stundenImMonat <= 0) continue;
		const anteil = Math.min(1, a.stundenImMonat / a.stundenGesamt);
		umsatz += Math.round(a.nettoCent * anteil);
		material += Math.round(a.materialCent * anteil);
	}
	const db = umsatz - material;
	const ergebnis = db - monatskostenCent;
	return {
		kostenCent: monatskostenCent,
		umsatzCent: umsatz,
		materialCent: material,
		deckungsbeitragCent: db,
		ergebnisCent: ergebnis,
		erreicht: ergebnis >= 0,
		deckungProzent: monatskostenCent > 0 ? Math.round((db / monatskostenCent) * 100) : null
	};
}

/** „118,3“ – Stunden mit Komma, ohne unnötige Nachkommastelle. */
export const stundenText = (h: number) => String(Math.round(h * 10) / 10).replace('.', ',');

/**
 * Satz für Start-Kachel und Sprachantwort: „4.000,00 € Gewinn verplant, 120 Stunden frei“ bzw. unter dem
 * Break-even „noch 3.000,00 € bis zum Break-even, …“. Ohne Kalkulation (frei = null) ohne Stunden.
 */
export function gewinnSatz(ergebnisCent: number, frei: number | null): string {
	const geld = ergebnisCent >= 0 ? `${euro(ergebnisCent)} Gewinn verplant` : `noch ${euro(-ergebnisCent)} bis zum Break-even`;
	return frei === null ? geld : `${geld}, ${stundenText(frei)} Stunden frei`;
}
