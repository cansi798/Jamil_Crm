/**
 * Plantafel als Kalender (Wunsch Jamil msg 2676, Vorbild Outlook-Monatsansicht): reine Rechnung ohne Datenbank.
 *
 * - `termineAus`: Einsätze → Kalendertermine. Ein mehrtägiger Termin bzw. eine Kolonnen-Planung (gemeinsame Gruppe)
 *   ist EIN Termin über alle Tage und Personen; ein einzelner Einsatz ist ein Termin an seinem Tag.
 * - `monatsWochen`: Wochen (Mo–So), die den Monat abdecken.
 * - `balkenDerWoche`: Balken einer Woche mit Spur (Zeile), damit sich nichts überlappt; mehrtägige Termine laufen
 *   als durchgehender Balken über die Tage (und mit „geht weiter“ über die Wochengrenze).
 */
import { FARB_PALETTE } from './farben';
import { STATUS_FARBEN } from './route';
import { berlinTag, berlinUhrzeit, tagPlus, wocheVon } from './zeit';

export const ANSICHTEN = ['monat', 'woche', 'tag', 'team'] as const;
export type Ansicht = (typeof ANSICHTEN)[number];
export const ANSICHT_NAMEN: Record<Ansicht, string> = { monat: 'Monat', woche: 'Woche', tag: 'Tag', team: 'Team' };
export const istAnsicht = (w: unknown): w is Ansicht => typeof w === 'string' && (ANSICHTEN as readonly string[]).includes(w);

export type KalEinsatz = {
	id: string;
	auftragId: string | null;
	auftragNummer: string;
	auftragTitel: string;
	kundeName: string;
	ort: string | null;
	benutzerId: string;
	benutzerName: string;
	beginn: string;
	ende: string;
	art: string;
	/** Terminart (Jamil msg 3074), optional */
	terminart?: { id: string; name: string; farbe: string } | null;
	auftragStatus: string;
	warnungen: unknown[];
	gruppe: { id: string; vonTag: string; bisTag: string } | null;
	kolonne: { id: string; name: string } | null;
};

export type KalTermin<E extends KalEinsatz = KalEinsatz> = {
	/** Gruppen-ID bzw. Einsatz-ID */
	id: string;
	gruppeId: string | null;
	auftragId: string | null;
	auftragNummer: string;
	titel: string;
	kundeName: string;
	ort: string | null;
	vonTag: string;
	bisTag: string;
	/** „07:30–16:00“ (erster geladener Tag) */
	zeit: string;
	personen: { id: string; name: string }[];
	kolonne: { id: string; name: string } | null;
	art: string;
	terminart: { id: string; name: string; farbe: string } | null;
	status: string;
	warnung: boolean;
	/** Geladene Einsätze dieses Termins (zum Bearbeiten) */
	einsaetze: E[];
};

const zeitVon = (e: KalEinsatz) => `${berlinUhrzeit(new Date(e.beginn))}–${berlinUhrzeit(new Date(e.ende))}`;

export function termineAus<E extends KalEinsatz>(einsaetze: readonly E[]): KalTermin<E>[] {
	const nachSchluessel = new Map<string, KalTermin<E>>();
	const sortiert = [...einsaetze].sort((a, b) => a.beginn.localeCompare(b.beginn) || a.benutzerName.localeCompare(b.benutzerName, 'de'));
	for (const e of sortiert) {
		const tag = berlinTag(new Date(e.beginn));
		const schluessel = e.gruppe?.id ?? e.id;
		let t = nachSchluessel.get(schluessel);
		if (!t) {
			t = {
				id: schluessel,
				gruppeId: e.gruppe?.id ?? null,
				auftragId: e.auftragId,
				auftragNummer: e.auftragNummer,
				titel: e.auftragTitel,
				kundeName: e.kundeName,
				ort: e.ort,
				vonTag: e.gruppe?.vonTag ?? tag,
				bisTag: e.gruppe?.bisTag ?? tag,
				zeit: zeitVon(e),
				personen: [],
				kolonne: e.kolonne,
				art: e.art,
				terminart: e.terminart ?? null,
				status: e.auftragStatus,
				warnung: false,
				einsaetze: []
			};
			nachSchluessel.set(schluessel, t);
		}
		t.einsaetze.push(e);
		if (!t.personen.some((p) => p.id === e.benutzerId)) t.personen.push({ id: e.benutzerId, name: e.benutzerName });
		if (e.warnungen.length > 0) t.warnung = true;
		if (tag < t.vonTag) t.vonTag = tag;
		if (tag > t.bisTag) t.bisTag = tag;
	}
	return [...nachSchluessel.values()].sort(
		(a, b) => a.vonTag.localeCompare(b.vonTag) || b.bisTag.localeCompare(a.bisTag) || a.zeit.localeCompare(b.zeit) || a.id.localeCompare(b.id)
	);
}

/** Wochen (Mo–So) über den Monat `JJJJ-MM` – 4 bis 6 Wochen. */
export function monatsWochen(monat: string): string[][] {
	const erster = `${monat}-01`;
	const wochen: string[][] = [];
	let montag = wocheVon(erster)[0];
	while (true) {
		const woche = wocheVon(montag);
		wochen.push(woche);
		montag = tagPlus(montag, 7);
		if (montag.slice(0, 7) !== monat) break;
	}
	return wochen;
}

export type Balken<T> = { termin: T; start: number; laenge: number; spur: number; weiterLinks: boolean; weiterRechts: boolean };

/** Balken einer Woche: Spalte (0 = Montag), Länge in Tagen, Spur (erste freie Zeile). */
export function balkenDerWoche<T extends { vonTag: string; bisTag: string }>(woche: readonly string[], termine: readonly T[]): Balken<T>[] {
	const erster = woche[0];
	const letzter = woche[woche.length - 1];
	const belegt: boolean[][] = [];
	const ergebnis: Balken<T>[] = [];
	const imZeitraum = termine
		.filter((t) => t.vonTag <= letzter && t.bisTag >= erster)
		.sort((a, b) => (a.vonTag < erster ? erster : a.vonTag).localeCompare(b.vonTag < erster ? erster : b.vonTag) || b.bisTag.localeCompare(a.bisTag));
	for (const t of imZeitraum) {
		const start = woche.indexOf(t.vonTag < erster ? erster : t.vonTag);
		const ende = woche.indexOf(t.bisTag > letzter ? letzter : t.bisTag);
		let spur = 0;
		while (belegt[spur]?.slice(start, ende + 1).some(Boolean)) spur++;
		belegt[spur] ??= Array(woche.length).fill(false);
		for (let i = start; i <= ende; i++) belegt[spur][i] = true;
		ergebnis.push({ termin: t, start, laenge: ende - start + 1, spur, weiterLinks: t.vonTag < erster, weiterRechts: t.bisTag > letzter });
	}
	return ergebnis;
}

export const termineAm = <T extends { vonTag: string; bisTag: string }>(tag: string, termine: readonly T[]) =>
	termine.filter((t) => t.vonTag <= tag && t.bisTag >= tag);

export type FarbModus = 'person' | 'status';

/** Farbe eines Termins: nach Kolonne/Mitarbeiter (feste Reihenfolge) oder nach Auftragsstatus. */
export function terminFarbe(
	t: Pick<KalTermin, 'kolonne' | 'personen' | 'status'>,
	modus: FarbModus,
	reihenfolge: { personen: readonly string[]; kolonnen: readonly string[] }
): string {
	if (modus === 'status') return (STATUS_FARBEN as Record<string, string>)[t.status] ?? '#605e5c';
	if (t.kolonne) {
		const i = reihenfolge.kolonnen.indexOf(t.kolonne.id);
		return FARB_PALETTE[(FARB_PALETTE.length - 1 - Math.max(0, i)) % FARB_PALETTE.length];
	}
	const i = reihenfolge.personen.indexOf(t.personen[0]?.id ?? '');
	return FARB_PALETTE[Math.max(0, i) % FARB_PALETTE.length];
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monatName = (monat: string) => `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}`;

/** Monat aus Name oder Nummer („November“, „nov“, „11“) relativ zu heute: nächstes Vorkommen (laufender Monat zählt). */
export function monatAusName(wort: string, heute: string): string | null {
	const w = wort.trim().toLowerCase();
	let nr = /^\d{1,2}$/.test(w) ? Number(w) : MONATE.findIndex((m) => m.toLowerCase().startsWith(w.slice(0, 3)) && w.length >= 3) + 1;
	if (w === 'märz' || w === 'maerz') nr = 3;
	if (!(nr >= 1 && nr <= 12)) return null;
	const jahr = Number(heute.slice(0, 4));
	const jetzt = Number(heute.slice(5, 7));
	return `${nr < jetzt ? jahr + 1 : jahr}-${String(nr).padStart(2, '0')}`;
}
