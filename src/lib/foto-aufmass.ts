/**
 * Foto-Aufmaß mit KI (Wunsch Jamil, Talk msgs 2770–2774 Punkt 8, Änderung msg 2780) – reine Rechnung ohne Datenbank.
 *
 * Der Nutzer gibt die BEKANNTEN Werte ein (Wandfläche, Bodenfläche, Raumhöhe, Anzahl WC/Dusche/…); die KI schätzt nur
 * den REST daraus und aus den Fotos: Abdichtungsfläche, Kantenlängen, Silikonfugen, Fliesenkleber, Fugenmörtel und
 * Positionsvorschläge aus dem Katalog. Jede Schätzung wird mit dem gespeichert, was der Nutzer am Ende übernommen hat,
 * und – sobald vorhanden – dem tatsächlichen Verbrauch (Zeiterfassung/Material). Daraus entstehen Kalibrierfaktoren
 * je Menge (Median von „gemessen ÷ geschätzt“, mit n) und Beispiele für die KI (Few-Shot) – ohne Kundendaten.
 */

export const RAUMARTEN = ['bad', 'gaeste_wc', 'kueche', 'flur', 'wohnraum', 'sonstiges'] as const;
export type Raumart = (typeof RAUMARTEN)[number];
export const RAUMART_NAMEN: Record<Raumart, string> = {
	bad: 'Bad',
	gaeste_wc: 'Gäste-WC',
	kueche: 'Küche',
	flur: 'Flur',
	wohnraum: 'Wohnraum',
	sonstiges: 'Sonstiges'
};

export const OBJEKTE = ['wc', 'dusche', 'badewanne', 'waschtisch', 'fenster', 'tueren'] as const;
export type Objekt = (typeof OBJEKTE)[number];
export const OBJEKT_NAMEN: Record<Objekt, string> = {
	wc: 'WC',
	dusche: 'Dusche',
	badewanne: 'Badewanne',
	waschtisch: 'Waschtisch',
	fenster: 'Fenster',
	tueren: 'Türen'
};

/** Mengen, die die KI schätzt (nie Wand-/Bodenfläche – die gibt der Nutzer vor). */
export const MENGEN = {
	abdichtung_m2: { name: 'Abdichtungsfläche', einheit: 'm²' },
	dichtband_lfm: { name: 'Dichtband (Ecken, Übergänge)', einheit: 'lfm' },
	silikon_lfm: { name: 'Silikonfugen', einheit: 'lfm' },
	sockel_lfm: { name: 'Kantenlänge Boden/Wand (Sockel)', einheit: 'lfm' },
	kantenschutz_lfm: { name: 'Außenkanten (Kantenschutzschiene)', einheit: 'lfm' },
	fliesenkleber_kg: { name: 'Fliesenkleber', einheit: 'kg' },
	fugenmoertel_kg: { name: 'Fugenmörtel', einheit: 'kg' }
} as const;
export type MengenSchluessel = keyof typeof MENGEN;
export const MENGEN_SCHLUESSEL = Object.keys(MENGEN) as MengenSchluessel[];

export type Eingaben = {
	raumart: Raumart;
	wandM2: number;
	bodenM2: number;
	hoeheM: number | null;
	objekte: Partial<Record<Objekt, number>>;
	/** z. B. „Türhöhe 2,00 m“ – nur als Hinweis an die KI */
	referenz: string | null;
};

export type KiMengen = Partial<Record<MengenSchluessel, number>>;

/**
 * Faustformeln als Vergleich und Rückfall (DIN 18534 / Herstellerangaben, grob): Abdichtung = Boden + Spritzwasser-
 * bereiche (Dusche 2 Wände × 1,2 m × 2,0 m, Wanne 0,4 m² je lfm Rand …), Kleber ≈ 4 kg/m², Fugenmörtel ≈ 0,5 kg/m².
 */
export function regelSchaetzung(e: Eingaben): Required<KiMengen> {
	const o = (k: Objekt) => Math.max(0, e.objekte[k] ?? 0);
	const umfang = e.bodenM2 > 0 ? 4 * Math.sqrt(e.bodenM2) : 0; // quadratischer Raum als Annahme
	const nass = e.raumart === 'bad' || e.raumart === 'gaeste_wc';
	const abdichtung = nass ? e.bodenM2 + o('dusche') * 4.8 + o('badewanne') * 1.6 + o('waschtisch') * 0.6 : 0;
	const r1 = (n: number) => Math.round(n * 10) / 10;
	const fliesen = e.wandM2 + e.bodenM2;
	return {
		abdichtung_m2: r1(abdichtung),
		dichtband_lfm: r1(nass ? umfang + o('dusche') * 6 + o('badewanne') * 4 : 0),
		silikon_lfm: r1(umfang * (nass ? 1 : 0.5) + o('dusche') * 6 + o('badewanne') * 4.5 + o('waschtisch') * 1.2 + o('wc') * 1.5),
		sockel_lfm: r1(Math.max(0, umfang - o('tueren') * 0.9)),
		kantenschutz_lfm: r1(o('fenster') * 3 + o('dusche') * 1),
		fliesenkleber_kg: Math.round(fliesen * 4),
		fugenmoertel_kg: Math.round(fliesen * 0.5)
	};
}

export type Historie = {
	eingaben: Eingaben;
	ki: KiMengen;
	/** vom Nutzer übernommen (korrigiert oder bestätigt) */
	final: KiMengen;
	/** tatsächlicher Verbrauch, sobald bekannt */
	ist: KiMengen | null;
	/** Positionen: Katalog-ID → [KI-Menge, übernommene Menge] */
	positionen?: Record<string, [number, number]>;
};

export type Faktor = { faktor: number; n: number };

const median = (l: number[]) => {
	const s = [...l].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Kalibrierfaktoren je Menge (und je Katalogposition `pos:<id>`): Median von Ziel ÷ KI über die Historie; Ziel ist der
 * tatsächliche Verbrauch, sonst der übernommene Wert. Erst ab `minN` Fällen, begrenzt auf 0,5–2.
 */
export function kalibrierung(historie: readonly Historie[], minN = 2): Record<string, Faktor> {
	const quoten = new Map<string, number[]>();
	const add = (k: string, ki: number | undefined, ziel: number | undefined) => {
		if (ki === undefined || ziel === undefined || !(ki > 0) || !(ziel >= 0)) return;
		const l = quoten.get(k) ?? [];
		l.push(ziel / ki);
		quoten.set(k, l);
	};
	for (const h of historie) {
		for (const k of MENGEN_SCHLUESSEL) add(k, h.ki[k], h.ist?.[k] ?? h.final[k]);
		for (const [id, [ki, fin]] of Object.entries(h.positionen ?? {})) add(`pos:${id}`, ki, fin);
	}
	const aus: Record<string, Faktor> = {};
	for (const [k, l] of quoten) {
		if (l.length < minN) continue;
		aus[k] = { faktor: Math.round(Math.min(2, Math.max(0.5, median(l))) * 100) / 100, n: l.length };
	}
	return aus;
}

/** KI-Wert × Faktor (falls vorhanden), auf 0,1 gerundet (kg ganzzahlig). */
export function kalibriert(schluessel: string, wert: number, f: Record<string, Faktor>): number {
	const x = wert * (f[schluessel]?.faktor ?? 1);
	return schluessel.endsWith('_kg') ? Math.round(x) : Math.round(x * 10) / 10;
}

/** Mittlere absolute prozentuale Abweichung (für die Genauigkeitsmessung). */
export function mape(paare: readonly [number, number][]): number | null {
	const g = paare.filter(([soll]) => soll > 0);
	if (g.length === 0) return null;
	return Math.round((g.reduce((s, [soll, ist]) => s + Math.abs(ist - soll) / soll, 0) / g.length) * 1000) / 10;
}
