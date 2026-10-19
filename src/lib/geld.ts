/**
 * Geld und Mengen – ohne Serverbezug, damit Oberfläche (Summenblock live) und Server (verbindliche Rechnung) dasselbe
 * rechnen. Geldbeträge sind immer ganze Cent (`number`, in der Datenbank `bigint`); Mengen haben höchstens drei
 * Nachkommastellen (`numeric(12,3)`). Gerechnet wird nie mit Gleitkomma-Zwischenergebnissen: Mengen werden in
 * Tausendstel umgerechnet und als ganze Zahlen (BigInt) multipliziert.
 *
 * Rundung kaufmännisch (0,5 auf, bei negativen Werten vom Nullpunkt weg):
 *   Positionssumme = round(Menge × Einzelpreis), Netto = Σ Positionssummen, MwSt = round(Netto × Satz / 100),
 *   Brutto = Netto + MwSt.
 *
 * Eingaben (Formulare, JSON) werden mit `leseMenge`/`leseEuroInCent` gelesen; beide werfen `RangeError` mit einer
 * deutschen Meldung, die der Server als 400 weitergibt.
 */

export const MWST_SAETZE = [0, 7, 19] as const;
export type MwstSatz = (typeof MWST_SAETZE)[number];

export const istMwstSatz = (w: unknown): w is MwstSatz => typeof w === 'number' && (MWST_SAETZE as readonly number[]).includes(w);

export const MAX_MENGE = 1_000_000;
/** Höchster Einzelpreis: 10 Mio. € (in Cent). */
export const MAX_CENT = 1_000_000_000;

/** Ganzzahlige Division mit kaufmännischer Rundung (0,5 vom Nullpunkt weg). */
function rundeDiv(zaehler: bigint, nenner: bigint): bigint {
	const negativ = zaehler < 0n;
	const betrag = negativ ? -zaehler : zaehler;
	const q = (betrag * 2n + nenner) / (2n * nenner);
	return negativ ? -q : q;
}

/** Menge → ganze Tausendstel (Menge hat höchstens 3 Nachkommastellen). */
const tausendstel = (menge: number) => BigInt(Math.round(menge * 1000));

/** round(Menge × Einzelpreis) in Cent – exakt, ohne Gleitkommafehler (0,1 × 3 × 10,00 € = 3,00 €, nicht 2,99 €). */
export function positionsSumme(menge: number, einzelpreisCent: number): number {
	return Number(rundeDiv(tausendstel(menge) * BigInt(Math.round(einzelpreisCent)), 1000n));
}

export type Summen = { nettoCent: number; mwstCent: number; bruttoCent: number };

export function summen(positionen: readonly { menge: number; einzelpreisCent: number }[], mwstSatz: MwstSatz): Summen {
	let netto = 0n;
	for (const p of positionen) netto += BigInt(positionsSumme(p.menge, p.einzelpreisCent));
	const mwst = rundeDiv(netto * BigInt(mwstSatz), 100n);
	return { nettoCent: Number(netto), mwstCent: Number(mwst), bruttoCent: Number(netto + mwst) };
}

export const KOMMA_HINWEIS = 'Bitte Betrag mit Komma angeben, z. B. 1.234,00';

/**
 * Zerlegt eine Zahl in deutscher oder englischer Schreibweise in Vor- und Nachkommastellen (nur Ziffern):
 * - mit Komma: Komma = Dezimaltrenner, Punkte nur als Tausendertrenner in Dreiergruppen („1.234,56“),
 * - ohne Komma: ein Punkt ist immer der Dezimaltrenner („2.5“, „0.125“, „2.250“ = 2,25).
 * Bei Beträgen ist „1.234“ (drei Stellen nach dem Punkt, ohne Komma) mehrdeutig und wird mit `KOMMA_HINWEIS`
 * abgelehnt, ebenso mehrere Punkte ohne Komma („1.234.567“).
 */
function zerlege(text: string, euro: boolean): { ganz: string; bruch: string } | null {
	const t = text.replace(/[\s\u00a0\u202f]/g, '');
	let m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d+)$/.exec(t);
	if (m) return { ganz: m[1].replaceAll('.', ''), bruch: m[2] };
	m = /^(\d+)(?:\.(\d+))?$/.exec(t);
	if (m) {
		if (euro && m[2]?.length === 3) throw new RangeError(KOMMA_HINWEIS);
		return { ganz: m[1], bruch: m[2] ?? '' };
	}
	if (euro && /^\d{1,3}(\.\d{3})+$/.test(t)) throw new RangeError(KOMMA_HINWEIS);
	return null;
}

/** Liest einen Wert als ganze Vielfache von 10^-stellen (z. B. Cent bei 2, Tausendstel bei 3) – oder `null`. */
function leseFestkomma(eingabe: string | number, stellen: number, euro: boolean): number | null {
	const faktor = 10 ** stellen;
	if (typeof eingabe === 'number') {
		if (!Number.isFinite(eingabe) || eingabe < 0) return null;
		const ganz = Math.round(eingabe * faktor);
		if (Math.abs(eingabe * faktor - ganz) > 1e-6) return null;
		return ganz;
	}
	if (typeof eingabe !== 'string') return null;
	const z = zerlege(eingabe, euro);
	if (!z || z.ganz.length > 12) return null;
	const bruch = z.bruch.replace(/0+$/, '');
	if (bruch.length > stellen) return null;
	return Number(z.ganz) * faktor + Number(bruch.padEnd(stellen, '0') || '0');
}

/** Menge aus „2,5“, „2.5“ oder 2.5: > 0, höchstens 1 000 000 und 3 Nachkommastellen (sonst `RangeError`). */
export function leseMenge(eingabe: string | number): number {
	const t = leseFestkomma(eingabe, 3, false);
	if (t === null) throw new RangeError('Bitte eine gültige Menge eingeben (höchstens 3 Nachkommastellen).');
	if (t <= 0) throw new RangeError('Die Menge muss größer als 0 sein.');
	if (t > MAX_MENGE * 1000) throw new RangeError('Die Menge ist zu groß (höchstens 1.000.000).');
	return t / 1000;
}

/** Euro-Betrag aus „1.234,56“, „1234,56“, „1234.56“ oder 1234.56 → 123456 Cent; ≥ 0, höchstens 2 Nachkommastellen. */
export function leseEuroInCent(eingabe: string | number): number {
	const ohneZeichen = typeof eingabe === 'string' ? eingabe.replace(/€/g, '') : eingabe;
	const cent = leseFestkomma(ohneZeichen, 2, true);
	if (cent === null) throw new RangeError('Bitte einen gültigen Betrag eingeben (z. B. 1.234,56; nicht negativ).');
	if (cent > MAX_CENT) throw new RangeError('Der Betrag ist zu hoch (höchstens 10.000.000,00 €).');
	return cent;
}

const gruppiere = (ziffern: string) => ziffern.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** „1.234,56 €“ (geschütztes Leerzeichen vor €). */
export function euro(cent: number): string {
	const c = Math.round(cent);
	const betrag = Math.abs(c);
	const vorzeichen = c < 0 ? '-' : '';
	return `${vorzeichen}${gruppiere(String(Math.floor(betrag / 100)))},${String(betrag % 100).padStart(2, '0')} €`;
}

/** Menge für die Anzeige: „2,5“, „1.000,125“, „3“. */
export function mengeText(menge: number): string {
	const t = Math.round(menge * 1000);
	const ganz = Math.floor(Math.abs(t) / 1000);
	const bruch = String(Math.abs(t) % 1000).padStart(3, '0').replace(/0+$/, '');
	return `${t < 0 ? '-' : ''}${gruppiere(String(ganz))}${bruch ? ',' + bruch : ''}`;
}

/** Cent als Text für ein Eingabefeld: „1234,56“ (ohne Tausenderpunkte und Zeichen). */
export function centAlsEingabe(cent: number): string {
	const c = Math.round(cent);
	const b = Math.abs(c);
	return `${c < 0 ? '-' : ''}${Math.floor(b / 100)},${String(b % 100).padStart(2, '0')}`;
}
