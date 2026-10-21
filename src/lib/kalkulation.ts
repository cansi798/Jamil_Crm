/**
 * Kalkulation v2 (Wunsch Jamil, msgs 2515/2516 – wie seine Excel „Gewinnkalkulation“). Reine Rechnung ohne Datenbank
 * (Server und Oberfläche).
 *
 *   Kosten pro Jahr     = Summe der aktiven Kostenzeilen (monatlich × 12, jährlich, einmalig anteilig abgeschrieben)
 *                         + Personalkosten (Bruttojahresgehalt + Arbeitgeber-Anteil) aller Mitarbeiter
 *   Produktive Stunden  = Summe über die Mitarbeiter: Tage im Jahr × verrechenbare Stunden pro Tag
 *                         (Standard des Betriebs, je Mitarbeiter überschreibbar)
 *   Kosten-Stundensatz  = Kosten pro Jahr / produktive Stunden            (kostendeckend, Untergrenze)
 *   Verrechnungssatz    = Kosten-Stundensatz × (1 + Wagnis % + Gewinn %)  (empfohlen)
 *   → das ist der Mischsatz (Durchschnitt aller Mitarbeiter).
 *
 * Je Mitarbeiter (Jamil msgs 2998/3000/3002):
 *   Gemeinkosten-Anteil = alle aktiven Kostenzeilen × (seine Stunden ÷ alle Stunden) – bei gleichen Stunden je Kopf
 *                         gleich. Auch Kostenzeilen der Kategorie „Personal“ (Löhne, die nicht beim Mitarbeiter
 *                         stehen, z. B. Büro oder Lohn als Kostenzeile wie in der Excel) zählen dazu: Sie lassen sich
 *                         keinem Mitarbeiter zuordnen, und nur so ergibt die Summe aller Mitarbeiter genau die
 *                         Gesamtkosten (Mischsatz bleibt gleich).
 *   Kostendeckender Tagessatz = (Personalkosten + Gemeinkosten-Anteil) ÷ seine produktiven Tage
 *   Kostendeckender Stundensatz = Tagessatz ÷ seine verrechenbaren Stunden pro Tag
 *   Verkaufs-Tages-/Stundensatz = kostendeckend × (1 + Wagnis % + Gewinn %)
 *
 * Geld in ganzen Cent, Ergebnisse kaufmännisch gerundet. Ohne produktive Stunden gibt es keinen Satz (`null`) und
 * `warnungen` sagt warum – nie eine Division durch 0.
 */

export type AgArt = 'prozent' | 'euro';
export const KATEGORIEN = ['fixkosten', 'fahrzeug', 'versicherung', 'software', 'personal', 'sonstiges'] as const;
export type Kategorie = (typeof KATEGORIEN)[number];
export const KATEGORIE_NAMEN: Record<Kategorie, string> = {
	fixkosten: 'Fixkosten',
	fahrzeug: 'Fahrzeug',
	versicherung: 'Versicherung',
	software: 'Software',
	personal: 'Personal',
	sonstiges: 'Sonstiges'
};
export const INTERVALLE = ['monatlich', 'jaehrlich', 'einmalig'] as const;
export type Intervall = (typeof INTERVALLE)[number];
export const INTERVALL_NAMEN: Record<Intervall, string> = { monatlich: 'monatlich', jaehrlich: 'jährlich', einmalig: 'einmalig' };

export type BetriebsWerte = {
	/** Produktive Tage im Jahr je Mitarbeiter (Standard, z. B. 210). */
	standardTage: number;
	/** Produktive Stunden pro Tag (Standard): was dem Kunden je Tag berechnet wird; Fehltage stecken in den produktiven Tagen. */
	standardStundenTag: number;
	/** Wagnis (Risiko) und Gewinn in Prozent – zusammen der Aufschlag auf den Kosten-Stundensatz. */
	risikoProzent: number;
	gewinnProzent: number;
	/** Optional: heute verlangter Stundensatz – zum Vergleich. */
	aktuellerSatzCent: number | null;
	/** Nachkalkulation: Kosten je gefahrenem km (fest) … */
	kmSatzCent?: number | null;
	/** … oder gefahrene km pro Jahr (km-Satz = Fahrzeugkosten ÷ km) */
	jahresKm?: number | null;
};

export type KostenZeile = {
	id: string;
	name: string;
	kategorie: Kategorie;
	betragCent: number;
	intervall: Intervall;
	/** Nur bei „einmalig“: Abschreibung über so viele Monate. */
	abschreibungMonate: number | null;
	aktiv: boolean;
};

export type MitarbeiterWerte = {
	bruttoCent: number;
	agArt: AgArt;
	agProzent: number | null;
	agEuroCent: number | null;
	/** leer = Standard des Betriebs */
	tageJahr: number | null;
	stundenTag: number | null;
};

export type Vergleich = 'unter_kosten' | 'kosten_gedeckt' | 'mit_gewinn';

const runde2 = (n: number) => Math.round(n * 100) / 100;

/** Betrag einer Kostenzeile pro Jahr (Cent). Einmalig: Anteil eines Jahres an der Abschreibung. */
export function jahresbetrag(z: Pick<KostenZeile, 'betragCent' | 'intervall' | 'abschreibungMonate'>): number {
	if (z.intervall === 'monatlich') return z.betragCent * 12;
	if (z.intervall === 'jaehrlich') return z.betragCent;
	const monate = Math.max(1, z.abschreibungMonate ?? 1);
	return Math.round((z.betragCent * Math.min(12, monate)) / monate);
}

export function agAnteil(m: Pick<MitarbeiterWerte, 'bruttoCent' | 'agArt' | 'agProzent' | 'agEuroCent'>): number {
	return m.agArt === 'prozent' ? Math.round(m.bruttoCent * ((m.agProzent ?? 0) / 100)) : (m.agEuroCent ?? 0);
}

export type MitarbeiterErgebnis = {
	id: string;
	name: string;
	tage: number;
	stundenTag: number;
	stunden: number;
	bruttoCent: number;
	agAnteilCent: number;
	personalkostenCent: number;
	/** Anteil an den Gemeinkosten (alle aktiven Kostenzeilen) nach seinem Anteil an den produktiven Stunden. */
	gemeinkostenCent: number;
	/** Personalkosten + Gemeinkosten-Anteil (pro Jahr). */
	kostenCent: number;
	/** null ohne Tage bzw. Stunden. */
	kostendeckendTagCent: number | null;
	kostendeckendStundeCent: number | null;
	verkaufTagCent: number | null;
	verkaufStundeCent: number | null;
};

export type Uebersicht = {
	kostenzeilen: { id: string; jahresCent: number }[];
	kategorien: { kategorie: Kategorie; jahresCent: number }[];
	/** Summe der aktiven Kostenzeilen pro Jahr. */
	kostenzeilenCent: number;
	/** Davon Kostenzeilen der Kategorie „Personal“ (zählen als Gemeinkosten, siehe oben). */
	personalZeilenCent: number;
	personalkostenCent: number;
	gesamtkostenCent: number;
	monatskostenCent: number;
	mitarbeiter: MitarbeiterErgebnis[];
	produktiveStunden: number;
	aufschlagProzent: number;
	/** Kosten-Stundensatz (kostendeckend). */
	kostendeckendCent: number | null;
	/** Verrechnungssatz (empfohlen). */
	empfohlenCent: number | null;
	vergleich: Vergleich | null;
	warnungen: string[];
};

export function berechneUebersicht(
	b: BetriebsWerte,
	zeilen: readonly KostenZeile[],
	liste: readonly { id: string; name: string; werte: MitarbeiterWerte }[]
): Uebersicht {
	const warnungen: string[] = [];
	const aktiv = zeilen.filter((z) => z.aktiv);
	const kostenzeilen = aktiv.map((z) => ({ id: z.id, jahresCent: jahresbetrag(z) }));
	const kostenzeilenCent = kostenzeilen.reduce((s, z) => s + z.jahresCent, 0);
	const kategorien = KATEGORIEN.map((kategorie) => ({
		kategorie,
		jahresCent: aktiv.filter((z) => z.kategorie === kategorie).reduce((s, z) => s + jahresbetrag(z), 0)
	})).filter((k) => k.jahresCent > 0);

	const mitarbeiter = liste.map((m): MitarbeiterErgebnis => {
		const tage = m.werte.tageJahr ?? b.standardTage;
		const stundenTag = m.werte.stundenTag ?? b.standardStundenTag;
		const ag = agAnteil(m.werte);
		return {
			id: m.id,
			name: m.name,
			tage,
			stundenTag,
			stunden: runde2(tage * stundenTag),
			bruttoCent: m.werte.bruttoCent,
			agAnteilCent: ag,
			personalkostenCent: m.werte.bruttoCent + ag,
			gemeinkostenCent: 0,
			kostenCent: m.werte.bruttoCent + ag,
			kostendeckendTagCent: null,
			kostendeckendStundeCent: null,
			verkaufTagCent: null,
			verkaufStundeCent: null
		};
	});
	const personalkostenCent = mitarbeiter.reduce((s, m) => s + m.personalkostenCent, 0);
	const stunden = mitarbeiter.reduce((s, m) => s + m.tage * m.stundenTag, 0);
	const gesamt = kostenzeilenCent + personalkostenCent;
	const aufschlag = b.risikoProzent + b.gewinnProzent;

	let kostendeckend: number | null = null;
	let empfohlen: number | null = null;
	if (liste.length === 0) warnungen.push('Bitte mindestens einen produktiven Mitarbeiter erfassen – sonst gibt es keine Stunden.');
	else if (stunden <= 0) warnungen.push('Es gibt keine produktiven Stunden – ein Stundensatz lässt sich nicht berechnen.');
	else {
		kostendeckend = Math.round(gesamt / stunden);
		empfohlen = Math.round((gesamt / stunden) * (1 + aufschlag / 100));
	}
	// Je Mitarbeiter: Gemeinkosten nach Stundenanteil, daraus Tages- und Stundensatz
	for (const m of mitarbeiter) {
		const eigeneStunden = m.tage * m.stundenTag;
		const anteil = stunden > 0 ? (kostenzeilenCent * eigeneStunden) / stunden : 0;
		m.gemeinkostenCent = Math.round(anteil);
		m.kostenCent = m.personalkostenCent + m.gemeinkostenCent;
		if (m.tage > 0 && m.stundenTag > 0) {
			const tag = (m.personalkostenCent + anteil) / m.tage;
			m.kostendeckendTagCent = Math.round(tag);
			m.kostendeckendStundeCent = Math.round(tag / m.stundenTag);
			m.verkaufTagCent = Math.round(tag * (1 + aufschlag / 100));
			m.verkaufStundeCent = Math.round((tag / m.stundenTag) * (1 + aufschlag / 100));
		} else if (m.personalkostenCent > 0) {
			warnungen.push(`${m.name}: ohne produktive Tage bzw. Stunden lässt sich kein eigener Satz berechnen – seine Personalkosten werden nur im Mischsatz von den anderen mitgetragen.`);
		}
	}

	let vergleich: Vergleich | null = null;
	if (b.aktuellerSatzCent !== null && kostendeckend !== null && empfohlen !== null) {
		vergleich = b.aktuellerSatzCent < kostendeckend ? 'unter_kosten' : b.aktuellerSatzCent < empfohlen ? 'kosten_gedeckt' : 'mit_gewinn';
	}
	return {
		kostenzeilen,
		kategorien,
		kostenzeilenCent,
		personalZeilenCent: aktiv.filter((z) => z.kategorie === 'personal').reduce((s, z) => s + jahresbetrag(z), 0),
		personalkostenCent,
		gesamtkostenCent: gesamt,
		monatskostenCent: Math.round(gesamt / 12),
		mitarbeiter,
		produktiveStunden: runde2(stunden),
		aufschlagProzent: aufschlag,
		kostendeckendCent: kostendeckend,
		empfohlenCent: empfohlen,
		vergleich,
		warnungen
	};
}

/**
 * Beispielwerte aus Jamils Excel (Screenshot vom 19.10.2026, Zeilen 3–15; Beträge netto pro Monat) und die
 * Arbeitszeit (3 Mitarbeiter × 210 Tage × 7 Stunden = 4.410 Stunden). Die Zeilen 16–28 waren im Screenshot nicht
 * zu sehen – daher ergibt sich hier ein niedrigerer Satz als die 48,01 € der Excel.
 */
export const BEISPIEL_KOSTEN: readonly { name: string; kategorie: Kategorie; betragCent: number }[] = [
	{ name: 'Lexoffice', kategorie: 'software', betragCent: 5450 },
	{ name: 'IONOS', kategorie: 'software', betragCent: 2500 },
	{ name: 'Relexable', kategorie: 'software', betragCent: 8000 },
	{ name: 'Buchhaltung', kategorie: 'fixkosten', betragCent: 56862 },
	{ name: 'MyHammer', kategorie: 'sonstiges', betragCent: 50000 },
	{ name: 'Microsoft', kategorie: 'software', betragCent: 2600 },
	{ name: 'Hummel Miete', kategorie: 'fixkosten', betragCent: 50000 },
	{ name: 'Lohn Gailan Albazi inkl. Arbeitgeberanteile und Lohnsteuer', kategorie: 'personal', betragCent: 400000 },
	{ name: 'KFZ Versicherung', kategorie: 'fahrzeug', betragCent: 14000 },
	{ name: 'KFZ Steuer', kategorie: 'fahrzeug', betragCent: 3000 },
	{ name: 'Spritkosten / Wartungskosten', kategorie: 'fahrzeug', betragCent: 130000 },
	{ name: 'Werkzeug Verschleiß', kategorie: 'sonstiges', betragCent: 20000 },
	{ name: 'Betriebshaftpflicht', kategorie: 'versicherung', betragCent: 12000 }
];
export const BEISPIEL_MITARBEITER = 3;
export const BEISPIEL_TAGE = 210;
export const BEISPIEL_STUNDEN_TAG = 7;

// ── Wirkung der Kalkulation in Katalog und Angeboten (Wunsch Jamil, msg 2476) ──

/** Arbeitszeit je Einheit in Minuten: angegeben – sonst 60 bei Einheit „h“ – sonst unbekannt (`null`). */
export function minutenJeEinheit(einheit: string, arbeitMinuten: number | null): number | null {
	if (arbeitMinuten !== null) return arbeitMinuten;
	return einheit === 'h' ? 60 : null;
}

/** Lohn je Einheit = Minuten ÷ 60 × Stundensatz (Cent, kaufmännisch gerundet). */
export function lohnAusMinuten(minuten: number, satzCent: number): number {
	return Math.round((minuten / 60) * satzCent);
}

/** Liegt der Lohn einer Katalogposition unter Minuten × kostendeckendem Satz? `null`, wenn die Arbeitszeit fehlt. */
export function unterKostendeckend(
	p: { einheit: string; arbeitMinuten: number | null; lohnCent: number },
	kostendeckendCent: number
): boolean | null {
	const minuten = minutenJeEinheit(p.einheit, p.arbeitMinuten);
	if (minuten === null) return null;
	return p.lohnCent < lohnAusMinuten(minuten, kostendeckendCent);
}

export type Firmensatz = { kostendeckendCent: number; empfohlenCent: number };
export type Ampel = 'rot' | 'gelb' | 'gruen';

export type AngebotsBewertung = {
	arbeitsstunden: number;
	nettoCent: number;
	materialCent: number;
	/** Kosten = Arbeitsstunden × kostendeckender Satz + Material. */
	kostenCent: number | null;
	/** Erwarteter Gewinn = Netto − Kosten (negativ = Verlust). */
	gewinnCent: number | null;
	/** Was eine Arbeitsstunde einbringt: (Netto − Material) ÷ Arbeitsstunden. */
	effektiverSatzCent: number | null;
	/** rot: unter kostendeckend (Verlust) · gelb: deckt nur die Kosten · grün: mit Gewinn (≥ empfohlener Satz). */
	ampel: Ampel | null;
	/** Positionen ohne bekannte Arbeitszeit (zählen nur mit Erlös und Material). */
	ohneArbeitszeit: number;
};

/**
 * Bewertet ein Angebot gegen den Firmensatz der Kalkulation. Arbeitszeit je Position = Menge × Minuten je Einheit
 * (siehe `minutenJeEinheit`), Material = Menge × Materialanteil je Einheit (aus dem Katalog; sonst 0).
 */
export function bewerteAngebot(
	positionen: readonly { menge: number; einzelpreisCent: number; einheit: string; arbeitMinuten: number | null; materialCent: number | null }[],
	satz: Firmensatz | null
): AngebotsBewertung {
	let minuten = 0;
	let netto = 0;
	let material = 0;
	let ohneArbeitszeit = 0;
	for (const p of positionen) {
		netto += Math.round(p.menge * p.einzelpreisCent);
		material += Math.round(p.menge * (p.materialCent ?? 0));
		const m = minutenJeEinheit(p.einheit, p.arbeitMinuten);
		if (m === null) ohneArbeitszeit++;
		else minuten += p.menge * m;
	}
	const stunden = runde2(minuten / 60);
	const kosten = satz ? Math.round((minuten / 60) * satz.kostendeckendCent) + material : null;
	const effektiv = minuten > 0 ? Math.round((netto - material) / (minuten / 60)) : null;
	let ampel: Ampel | null = null;
	if (satz && effektiv !== null) ampel = effektiv < satz.kostendeckendCent ? 'rot' : effektiv < satz.empfohlenCent ? 'gelb' : 'gruen';
	return {
		arbeitsstunden: stunden,
		nettoCent: netto,
		materialCent: material,
		kostenCent: kosten,
		gewinnCent: kosten === null ? null : netto - kosten,
		effektiverSatzCent: effektiv,
		ampel,
		ohneArbeitszeit
	};
}
