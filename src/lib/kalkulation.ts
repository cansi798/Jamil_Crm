/**
 * Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026): Was muss ein Mitarbeiter pro Stunde einbringen, damit die
 * Kosten gedeckt sind – und was, damit Gewinn bleibt? Reine Rechnung ohne Datenbank (Server und Oberfläche).
 *
 * Rechenweg (Anforderung von Jamil):
 *   1. Gesamtkosten = Bruttojahresgehalt + Arbeitgeber-Anteil + Gemeinkosten / Anzahl produktiver Mitarbeiter
 *   2. Arbeitstage  = Tage im Jahr − Wochenenden − Feiertage − Urlaub − Krankheit (nie unter 0)
 *      Stunden      = Arbeitstage × (Wochenarbeitszeit / 5)
 *      fakturierbar = Stunden × (1 − Puffer %)   bzw.   Stunden − Puffer-Stunden (nie unter 0)
 *   3. kostendeckender Satz = Gesamtkosten / fakturierbare Stunden            (Untergrenze)
 *      empfohlener Satz     = kostendeckender Satz × (1 + Gewinn % + Risiko %)
 *
 * Festlegungen:
 *   – Wochenenden und Tage im Jahr kommen aus dem tatsächlichen Kalenderjahr (2026: 104 Wochenendtage, 365 Tage; ein
 *     Schaltjahr, das an einem Samstag beginnt, hat 106). „Feiertage“ sind die Feiertage, die auf Werktage fallen.
 *   – Geld in ganzen Cent; Zwischenwerte ungerundet, Ergebnisse kaufmännisch auf Cent bzw. Stunden auf 2 Stellen.
 *   – Lässt sich ein Satz nicht sinnvoll berechnen (0 fakturierbare Stunden; Gemeinkosten, aber 0 produktive
 *     Mitarbeiter), ist er `null` und `warnungen` sagt warum – nie eine Division durch 0 oder ein negativer Wert.
 */

export type PufferArt = 'prozent' | 'stunden';
export type AgArt = 'prozent' | 'euro';

export type BetriebsWerte = {
	jahr: number;
	/** Betriebliche Fixkosten (Miete, Software, Versicherungen, Marketing …) pro Jahr. */
	gemeinkostenCent: number;
	/** Anzahl produktiver Mitarbeiter, auf die die Gemeinkosten verteilt werden (auch Teilzeit-Anteile, z. B. 3,5). */
	anzahlProduktiv: number;
	/** Gesetzliche Feiertage, die auf Werktage fallen. */
	feiertage: number;
	pufferArt: PufferArt;
	/** Prozent (0–100) bzw. Stunden pro Jahr. */
	pufferWert: number;
	gewinnProzent: number;
	risikoProzent: number;
	/** Optional: heute verlangter Stundensatz – zum Vergleich je Mitarbeiter. */
	aktuellerSatzCent: number | null;
};

export type MitarbeiterWerte = {
	bruttoCent: number;
	agArt: AgArt;
	agProzent: number | null;
	agEuroCent: number | null;
	wochenstunden: number;
	urlaubstage: number;
	krankheitstage: number;
};

export type Vergleich = 'unter_kosten' | 'kosten_gedeckt' | 'mit_gewinn';

export type MitarbeiterErgebnis = {
	tageImJahr: number;
	wochenendTage: number;
	feiertage: number;
	urlaubstage: number;
	krankheitstage: number;
	arbeitstage: number;
	stundenProTag: number;
	anwesenheitsStunden: number;
	pufferStunden: number;
	fakturierbareStunden: number;
	bruttoCent: number;
	agAnteilCent: number;
	personalkostenCent: number;
	/** null: Gemeinkosten vorhanden, aber 0 produktive Mitarbeiter. */
	gemeinkostenAnteilCent: number | null;
	gesamtkostenCent: number | null;
	kostendeckendCent: number | null;
	aufschlagProzent: number;
	empfohlenCent: number | null;
	vergleich: Vergleich | null;
	warnungen: string[];
};

const runde2 = (n: number) => Math.round(n * 100) / 100;

export function tageImJahr(jahr: number): number {
	return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0 ? 366 : 365;
}

/** Samstage und Sonntage im Kalenderjahr. */
export function wochenendTage(jahr: number): number {
	let n = 0;
	const tage = tageImJahr(jahr);
	for (let i = 0; i < tage; i++) {
		const wt = new Date(Date.UTC(jahr, 0, 1 + i)).getUTCDay();
		if (wt === 0 || wt === 6) n++;
	}
	return n;
}

export function berechneMitarbeiter(b: BetriebsWerte, m: MitarbeiterWerte): MitarbeiterErgebnis {
	const warnungen: string[] = [];
	// Schritt 2: produktive Stunden
	const tage = tageImJahr(b.jahr);
	const wochenende = wochenendTage(b.jahr);
	const arbeitstage = Math.max(0, tage - wochenende - b.feiertage - m.urlaubstage - m.krankheitstage);
	const stundenProTag = m.wochenstunden / 5;
	const anwesenheit = arbeitstage * stundenProTag;
	const puffer = b.pufferArt === 'prozent' ? anwesenheit * (b.pufferWert / 100) : Math.min(b.pufferWert, anwesenheit);
	const fakturierbar = Math.max(0, anwesenheit - puffer);
	if (arbeitstage === 0) warnungen.push('Nach Wochenenden, Feiertagen, Urlaub und Krankheit bleiben keine Arbeitstage.');

	// Schritt 1: Gesamtkosten
	const ag = m.agArt === 'prozent' ? Math.round(m.bruttoCent * ((m.agProzent ?? 0) / 100)) : (m.agEuroCent ?? 0);
	const personal = m.bruttoCent + ag;
	let gemeinkostenAnteil: number | null;
	if (b.gemeinkostenCent === 0) gemeinkostenAnteil = 0;
	else if (b.anzahlProduktiv > 0) gemeinkostenAnteil = Math.round(b.gemeinkostenCent / b.anzahlProduktiv);
	else {
		gemeinkostenAnteil = null;
		warnungen.push('Die Gemeinkosten lassen sich nicht verteilen: Bitte die Anzahl der produktiven Mitarbeiter angeben.');
	}
	const gesamt = gemeinkostenAnteil === null ? null : personal + gemeinkostenAnteil;

	// Schritt 3: Stundensätze (aus ungerundeten Zwischenwerten)
	const aufschlag = b.gewinnProzent + b.risikoProzent;
	let kostendeckend: number | null = null;
	let empfohlen: number | null = null;
	if (fakturierbar <= 0) {
		warnungen.push('Es bleiben keine fakturierbaren Stunden – ein Stundensatz lässt sich nicht berechnen.');
	} else if (gesamt !== null) {
		const satz = gesamt / fakturierbar;
		kostendeckend = Math.round(satz);
		empfohlen = Math.round(satz * (1 + aufschlag / 100));
	}

	let vergleich: Vergleich | null = null;
	if (b.aktuellerSatzCent !== null && kostendeckend !== null && empfohlen !== null) {
		vergleich = b.aktuellerSatzCent < kostendeckend ? 'unter_kosten' : b.aktuellerSatzCent < empfohlen ? 'kosten_gedeckt' : 'mit_gewinn';
	}

	return {
		tageImJahr: tage,
		wochenendTage: wochenende,
		feiertage: b.feiertage,
		urlaubstage: m.urlaubstage,
		krankheitstage: m.krankheitstage,
		arbeitstage: runde2(arbeitstage),
		stundenProTag: runde2(stundenProTag),
		anwesenheitsStunden: runde2(anwesenheit),
		pufferStunden: runde2(puffer),
		fakturierbareStunden: runde2(fakturierbar),
		bruttoCent: m.bruttoCent,
		agAnteilCent: ag,
		personalkostenCent: personal,
		gemeinkostenAnteilCent: gemeinkostenAnteil,
		gesamtkostenCent: gesamt,
		kostendeckendCent: kostendeckend,
		aufschlagProzent: aufschlag,
		empfohlenCent: empfohlen,
		vergleich,
		warnungen
	};
}

export type UebersichtZeile = {
	id: string;
	name: string;
	ergebnis: MitarbeiterErgebnis;
	/** Empfohlener Satz über/unter dem Firmenschnitt (null, wenn nicht berechenbar). */
	lage: 'ueber' | 'unter' | null;
};

export type Uebersicht = {
	mitarbeiter: UebersichtZeile[];
	fakturierbareStunden: number;
	gesamtkostenCent: number;
	/** Firmenschnitt: Summe der Kosten / Summe der fakturierbaren Stunden (nach Stunden gewichtet). */
	kostendeckendCent: number | null;
	empfohlenCent: number | null;
	hinweise: string[];
};

export function berechneUebersicht(b: BetriebsWerte, liste: { id: string; name: string; werte: MitarbeiterWerte }[]): Uebersicht {
	const zeilen = liste.map((m) => ({ id: m.id, name: m.name, ergebnis: berechneMitarbeiter(b, m.werte) }));
	const gueltig = zeilen.filter((z) => z.ergebnis.kostendeckendCent !== null);
	const kosten = gueltig.reduce((s, z) => s + (z.ergebnis.gesamtkostenCent ?? 0), 0);
	const stunden = gueltig.reduce((s, z) => s + z.ergebnis.fakturierbareStunden, 0);
	const satz = stunden > 0 ? kosten / stunden : null;
	const empfohlen = satz === null ? null : Math.round(satz * (1 + (b.gewinnProzent + b.risikoProzent) / 100));
	const hinweise: string[] = [];
	if (liste.length > 0 && b.anzahlProduktiv > 0 && b.anzahlProduktiv !== liste.length) {
		hinweise.push(
			`Die Gemeinkosten werden auf ${String(b.anzahlProduktiv).replace('.', ',')} produktive Mitarbeiter verteilt – ` +
				`erfasst sind ${liste.length}.`
		);
	}
	return {
		mitarbeiter: zeilen.map((z) => ({
			...z,
			lage:
				z.ergebnis.empfohlenCent === null || empfohlen === null ? null : z.ergebnis.empfohlenCent > empfohlen ? 'ueber' : 'unter'
		})),
		fakturierbareStunden: runde2(stunden),
		gesamtkostenCent: kosten,
		kostendeckendCent: satz === null ? null : Math.round(satz),
		empfohlenCent: empfohlen,
		hinweise
	};
}
