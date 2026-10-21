import { minutenJeEinheit, type Ampel, type Firmensatz } from './kalkulation';

/**
 * Nachkalkulation (Wunsch Jamil, Talk msgs 2770–2774, Punkt 1) – reine Rechnung ohne Datenbank.
 *
 * Plan (aus den angenommenen Angeboten des Auftrags):
 *   Stunden   = Σ Menge × Minuten je Einheit (Katalog/Angebot; Einheit „h“ = 60 Min.) ÷ 60
 *   Material  = Σ Menge × Materialanteil je Einheit
 *   Erlös     = Σ Menge × Einzelpreis (netto)
 * Ist (aus der Zeiterfassung und dem erfassten Material):
 *   Stunden   = Arbeitszeit auf dem Auftrag (ohne Pausen); Fahrzeit getrennt
 *   Fahrt     = Fahrstunden × Kosten-Stundensatz + km × km-Satz
 *   Material  = Σ verbrauchte Menge × Preis (Einkauf, sonst Materialanteil der Angebotsposition)
 * Kosten     = Stunden × Kosten-Stundensatz (Kalkulation) + Material (+ Fahrt)
 * Deckungsbeitrag = Erlös − Material − km-Kosten (was für Lohn und Gemeinkosten übrig bleibt)
 * Gewinn     = Erlös − Kosten
 * Ampel (wie bei Angeboten): Was bringt eine Arbeitsstunde ein? (Erlös − Material − km-Kosten) ÷ (Arbeit + Fahrt)
 *   rot = unter kostendeckendem Satz (Verlust), gelb = deckt die Kosten, grün = mindestens empfohlener Satz.
 * Geld in ganzen Cent.
 */

export type PlanPosition = {
	katalogPositionId: string | null;
	bezeichnung: string;
	menge: number;
	einheit: string;
	arbeitMinuten: number | null;
	materialCent: number | null;
	einzelpreisCent: number;
	gewerk?: string | null;
};

export type NachkalkEingabe = {
	positionen: readonly PlanPosition[];
	istArbeitMin: number;
	istFahrtMin: number;
	istKm: number;
	/** null = noch kein Material erfasst (dann zählt der Plan) */
	istMaterialCent: number | null;
	satz: Firmensatz | null;
	kmSatzCent: number | null;
	/** Fremdleistungen (Subunternehmer-Rechnungen, Partner-Modul msg 2856), netto in Cent */
	istFremdCent?: number;
};

export type Seite = {
	stunden: number;
	materialCent: number;
	lohnkostenCent: number | null;
	kostenCent: number | null;
	erloesCent: number;
	deckungsbeitragCent: number;
	gewinnCent: number | null;
};

export type Nachkalkulation = {
	plan: Seite & { ohneArbeitszeit: number };
	ist: Seite & { fahrtStunden: number; km: number; fahrtkostenCent: number | null; kmKostenCent: number | null; effektiverSatzCent: number | null; materialGeschaetzt: boolean; fremdCent: number };
	/** Ist-Stunden gegenüber Plan in Prozent (+ = länger gebraucht) */
	stundenAbweichungProzent: number | null;
	ampel: Ampel | null;
	hinweise: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planWerte(positionen: readonly PlanPosition[]): { minuten: number; materialCent: number; erloesCent: number; ohneArbeitszeit: number } {
	let minuten = 0;
	let material = 0;
	let erloes = 0;
	let ohne = 0;
	for (const p of positionen) {
		erloes += Math.round(p.menge * p.einzelpreisCent);
		material += Math.round(p.menge * (p.materialCent ?? 0));
		const m = minutenJeEinheit(p.einheit, p.arbeitMinuten);
		if (m === null) ohne++;
		else minuten += p.menge * m;
	}
	return { minuten, materialCent: material, erloesCent: erloes, ohneArbeitszeit: ohne };
}

export function nachkalkuliere(e: NachkalkEingabe): Nachkalkulation {
	const hinweise: string[] = [];
	const p = planWerte(e.positionen);
	const satz = e.satz?.kostendeckendCent ?? null;
	if (satz === null) hinweise.push('Die Kalkulation ergibt noch keinen Kosten-Stundensatz – Kosten und Gewinn fehlen.');
	if (e.positionen.length === 0) hinweise.push('Kein angenommenes Angebot – es gibt keinen Plan und keinen Erlös.');
	if (p.ohneArbeitszeit > 0) hinweise.push(`${p.ohneArbeitszeit} Position(en) ohne Arbeitszeit je Einheit – im Plan ohne Stunden.`);

	const planStunden = p.minuten / 60;
	const planLohn = satz === null ? null : Math.round(planStunden * satz);
	const planKosten = planLohn === null ? null : planLohn + p.materialCent;

	const istStunden = e.istArbeitMin / 60;
	const fahrtStunden = e.istFahrtMin / 60;
	const materialGeschaetzt = e.istMaterialCent === null;
	const istMaterial = e.istMaterialCent ?? p.materialCent;
	if (materialGeschaetzt && p.materialCent > 0) hinweise.push('Material noch nicht erfasst – es zählt das geplante Material.');
	const kmKosten = e.kmSatzCent === null ? null : Math.round(e.istKm * e.kmSatzCent);
	if (e.istKm > 0 && e.kmSatzCent === null) hinweise.push('km-Satz fehlt in der Kalkulation – Kilometer ohne Kosten gerechnet.');
	const istLohn = satz === null ? null : Math.round(istStunden * satz);
	const fahrtLohn = satz === null ? null : Math.round(fahrtStunden * satz);
	const fahrtkosten = fahrtLohn === null ? null : fahrtLohn + (kmKosten ?? 0);
	const fremd = e.istFremdCent ?? 0;
	const istKosten = istLohn === null || fahrtkosten === null ? null : istLohn + fahrtkosten + istMaterial + fremd;
	const istDb = p.erloesCent - istMaterial - (kmKosten ?? 0) - fremd;
	const stundenGesamt = istStunden + fahrtStunden;
	const effektiv = stundenGesamt > 0 ? Math.round(istDb / stundenGesamt) : null;
	let ampel: Ampel | null = null;
	if (e.satz && effektiv !== null && p.erloesCent > 0) ampel = effektiv < e.satz.kostendeckendCent ? 'rot' : effektiv < e.satz.empfohlenCent ? 'gelb' : 'gruen';
	if (stundenGesamt === 0) hinweise.push('Noch keine Zeiten erfasst.');

	return {
		plan: {
			stunden: r2(planStunden),
			materialCent: p.materialCent,
			lohnkostenCent: planLohn,
			kostenCent: planKosten,
			erloesCent: p.erloesCent,
			deckungsbeitragCent: p.erloesCent - p.materialCent,
			gewinnCent: planKosten === null ? null : p.erloesCent - planKosten,
			ohneArbeitszeit: p.ohneArbeitszeit
		},
		ist: {
			stunden: r2(istStunden),
			fahrtStunden: r2(fahrtStunden),
			km: Math.round(e.istKm * 10) / 10,
			fahrtkostenCent: fahrtkosten,
			kmKostenCent: kmKosten,
			materialCent: istMaterial,
			lohnkostenCent: istLohn,
			kostenCent: istKosten,
			erloesCent: p.erloesCent,
			deckungsbeitragCent: istDb,
			gewinnCent: istKosten === null ? null : p.erloesCent - istKosten,
			effektiverSatzCent: effektiv,
			materialGeschaetzt,
			fremdCent: fremd
		},
		stundenAbweichungProzent: p.minuten > 0 ? Math.round(((e.istArbeitMin - p.minuten) / p.minuten) * 100) : null,
		ampel,
		hinweise
	};
}

/**
 * km-Satz: ausdrücklich eingetragen, sonst Fahrzeugkosten pro Jahr (Kalkulation, Kategorie „Fahrzeug“) ÷ gefahrene
 * km pro Jahr; ohne beides `null`.
 */
export function kmSatz(kmSatzCent: number | null, fahrzeugJahrCent: number, jahresKm: number | null): number | null {
	if (kmSatzCent !== null) return kmSatzCent;
	if (jahresKm && jahresKm > 0 && fahrzeugJahrCent > 0) return Math.round(fahrzeugJahrCent / jahresKm);
	return null;
}

// ——— Lernen: Minuten je Einheit aus gemessenen Aufträgen ———

export type LernProbe = { auftragId: string; positionen: readonly PlanPosition[]; istArbeitMin: number };

export type LernVorschlag = {
	katalogPositionId: string;
	bezeichnung: string;
	einheit: string;
	aktuellMin: number;
	vorschlagMin: number;
	n: number;
	/** Standardabweichung der Stichproben (Minuten je Einheit) */
	streuungMin: number;
	minMin: number;
	maxMin: number;
	abweichungProzent: number;
};

/**
 * Aus fertigen Aufträgen lernen: Die Ist-Arbeitszeit eines Auftrags wird anteilig nach den geplanten Minuten auf seine
 * Positionen verteilt (Faktor Ist ÷ Plan). Je Katalogposition ergibt das eine Stichprobe „Minuten je Einheit“ pro
 * Auftrag. Vorschlag = Mittelwert, nur ab `minN` Aufträgen und wenn er mehr als `schwelleProzent` vom heutigen Wert
 * abweicht. Grenze der Methode: Positionen im selben Auftrag bekommen denselben Faktor – je mehr Aufträge mit
 * unterschiedlicher Mischung, desto besser trennt sich das.
 */
export function lernVorschlaege(proben: readonly LernProbe[], opts: { minN?: number; schwelleProzent?: number } = {}): LernVorschlag[] {
	const minN = opts.minN ?? 3;
	const schwelle = opts.schwelleProzent ?? 10;
	const je = new Map<string, { bezeichnung: string; einheit: string; aktuell: number; werte: number[] }>();
	for (const pr of proben) {
		const plan = planWerte(pr.positionen).minuten;
		if (plan <= 0 || pr.istArbeitMin <= 0) continue;
		const faktor = pr.istArbeitMin / plan;
		const gesehen = new Set<string>();
		for (const p of pr.positionen) {
			const m = minutenJeEinheit(p.einheit, p.arbeitMinuten);
			if (!p.katalogPositionId || m === null || m <= 0 || gesehen.has(p.katalogPositionId)) continue;
			gesehen.add(p.katalogPositionId);
			const eintrag = je.get(p.katalogPositionId) ?? { bezeichnung: p.bezeichnung, einheit: p.einheit, aktuell: m, werte: [] };
			eintrag.werte.push(m * faktor);
			je.set(p.katalogPositionId, eintrag);
		}
	}
	const aus: LernVorschlag[] = [];
	for (const [id, e] of je) {
		const n = e.werte.length;
		if (n < minN) continue;
		const mittel = e.werte.reduce((s, w) => s + w, 0) / n;
		const streuung = Math.sqrt(e.werte.reduce((s, w) => s + (w - mittel) ** 2, 0) / (n > 1 ? n - 1 : 1));
		const abw = ((mittel - e.aktuell) / e.aktuell) * 100;
		if (Math.abs(abw) < schwelle) continue;
		aus.push({
			katalogPositionId: id,
			bezeichnung: e.bezeichnung,
			einheit: e.einheit,
			aktuellMin: e.aktuell,
			vorschlagMin: Math.round(mittel * 10) / 10,
			n,
			streuungMin: Math.round(streuung * 10) / 10,
			minMin: Math.round(Math.min(...e.werte) * 10) / 10,
			maxMin: Math.round(Math.max(...e.werte) * 10) / 10,
			abweichungProzent: Math.round(abw)
		});
	}
	return aus.sort((a, b) => Math.abs(b.abweichungProzent) - Math.abs(a.abweichungProzent));
}
