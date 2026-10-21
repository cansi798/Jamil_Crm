import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { pruefeRecht } from './rechte';
import { darf } from './tarif';
import { leseEuroInCent } from '../geld';
import {
	BEISPIEL_KOSTEN,
	BEISPIEL_MITARBEITER,
	BEISPIEL_STUNDEN_TAG,
	BEISPIEL_TAGE,
	berechneUebersicht,
	INTERVALLE,
	KATEGORIEN,
	type AgArt,
	type BetriebsWerte,
	type Intervall,
	type Kategorie,
	type KostenZeile,
	type MitarbeiterWerte,
	type Uebersicht
} from '../kalkulation';

/**
 * Kalkulation v2 (Wünsche Jamil, msgs 2515/2516; Migrationen 027 + 041): Kostenzeilen, Mitarbeiter mit Tagen/Stunden,
 * Wagnis und Gewinn – rechnen mit src/lib/kalkulation.ts. Gehälter sind vertraulich: Zugriff nur mit „Preise sehen“
 * UND „Einstellungen“ (Chef/Admin), Modul `katalog` (Preisbildung).
 */

export type KalkMitarbeiter = { id: string; name: string; benutzerId: string | null; werte: MitarbeiterWerte };

export type KalkulationDaten = {
	betrieb: BetriebsWerte;
	kosten: KostenZeile[];
	mitarbeiter: KalkMitarbeiter[];
	uebersicht: Uebersicht;
};

export const FIRMA_FELDER = ['standardTage', 'standardStundenTag', 'risikoProzent', 'gewinnProzent', 'aktuellerSatz', 'kmSatz', 'jahresKm'] as const;
export const KOSTEN_FELDER = ['name', 'kategorie', 'betrag', 'intervall', 'abschreibungMonate', 'aktiv'] as const;
export const MITARBEITER_FELDER = ['name', 'benutzerId', 'brutto', 'agArt', 'agProzent', 'agEuro', 'tageJahr', 'stundenTag'] as const;

export async function kalkulationZugriff(locals: { nutzer: Nutzer | null }): Promise<void> {
	pruefeRecht(locals, 'preise.sehen');
	pruefeRecht(locals, 'einstellungen');
	await darf(locals, 'katalog', 'preise.sehen');
}

/** Zahl aus „1.234,5“, „1234,5“ oder „1234.5“ (ohne Komma ist der Punkt das Dezimalzeichen). */
function zahl(w: unknown, name: string, min: number, max: number, stellen = 2, pflicht = true): number | null {
	if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) {
		if (pflicht) throw new ApiFehler(400, `${name}: Bitte einen Wert eingeben.`);
		return null;
	}
	let n: number;
	if (typeof w === 'number') n = w;
	else if (typeof w === 'string') {
		const t = w.trim().replace(/\s/g, '');
		const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
		if (!/^\d+(\.\d+)?$/.test(normal)) throw new ApiFehler(400, `${name}: Bitte eine Zahl eingeben.`);
		n = Number(normal);
	} else throw new ApiFehler(400, `${name}: Bitte eine Zahl eingeben.`);
	if (!Number.isFinite(n) || n < min || n > max) {
		throw new ApiFehler(400, `${name}: Bitte einen Wert von ${String(min).replace('.', ',')} bis ${String(max).replace('.', ',')} eingeben.`);
	}
	if (Math.abs(n * 10 ** stellen - Math.round(n * 10 ** stellen)) > 1e-6) {
		throw new ApiFehler(400, `${name}: höchstens ${stellen} Nachkommastellen.`);
	}
	return n;
}

function euro(w: unknown, name: string, pflicht = true): number | null {
	if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) {
		if (pflicht) throw new ApiFehler(400, `${name}: Bitte einen Betrag eingeben.`);
		return null;
	}
	if (typeof w !== 'string' && typeof w !== 'number') throw new ApiFehler(400, `${name}: Bitte einen Betrag eingeben.`);
	// Jahresbeträge schreibt man mit Tausenderpunkt („42.000“) – hier immer ganze Euro (anders als bei Preisen im
	// Angebot, wo „42.000“ mehrdeutig wäre und eine Rückfrage auslöst).
	const ganzeEuro = typeof w === 'string' && /^\s*\d{1,3}(\.\d{3})+\s*(€)?\s*$/.test(w) ? w.replace(/[.\s€]/g, '') : w;
	try {
		return leseEuroInCent(ganzeEuro);
	} catch (e) {
		throw new ApiFehler(400, `${name}: ${(e as Error).message}`);
	}
}

export function pruefeBetriebswerte(e: Record<string, unknown>): BetriebsWerte {
	return {
		standardTage: zahl(e.standardTage, 'Produktive Tage im Jahr', 0, 366, 1)!,
		standardStundenTag: zahl(e.standardStundenTag, 'Verrechenbare Stunden pro Tag', 0.25, 24)!,
		risikoProzent: zahl(e.risikoProzent, 'Wagnis', 0, 1000)!,
		gewinnProzent: zahl(e.gewinnProzent, 'Gewinn', 0, 1000)!,
		aktuellerSatzCent: euro(e.aktuellerSatz, 'Aktueller Stundensatz', false),
		kmSatzCent: euro(e.kmSatz, 'Kosten je km', false),
		jahresKm: zahl(e.jahresKm, 'Gefahrene km pro Jahr', 1, 10_000_000, 0, false)
	};
}

type KostenWerte = Omit<KostenZeile, 'id'>;

export function pruefeKosten(e: Record<string, unknown>): KostenWerte {
	const name = textFeld(e.name, 'Bezeichnung', 200);
	if (name === null) throw new ApiFehler(400, 'Bezeichnung: Bitte einen Namen eingeben (z. B. Miete).');
	if (!(KATEGORIEN as readonly unknown[]).includes(e.kategorie)) throw new ApiFehler(400, 'Kategorie: Bitte eine Kategorie wählen.');
	if (!(INTERVALLE as readonly unknown[]).includes(e.intervall)) throw new ApiFehler(400, 'Intervall: Bitte monatlich, jährlich oder einmalig wählen.');
	const intervall = e.intervall as Intervall;
	const aktiv = e.aktiv === undefined || e.aktiv === null || e.aktiv === '' ? true : e.aktiv === true || e.aktiv === 'on' || e.aktiv === 'true' || e.aktiv === '1';
	return {
		name,
		kategorie: e.kategorie as Kategorie,
		betragCent: euro(e.betrag, 'Betrag (netto)')!,
		intervall,
		abschreibungMonate: intervall === 'einmalig' ? zahl(e.abschreibungMonate, 'Abschreibung (Monate)', 1, 600, 0) : null,
		aktiv
	};
}

function pruefeMitarbeiter(e: Record<string, unknown>): { name: string; benutzerId: string | null; werte: MitarbeiterWerte } {
	const name = textFeld(e.name, 'Name', 200);
	if (name === null) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben.');
	const agArt = e.agArt;
	if (agArt !== 'prozent' && agArt !== 'euro') throw new ApiFehler(400, 'Arbeitgeber-Anteil: Bitte „Prozent“ oder „Euro“ wählen.');
	const benutzer = e.benutzerId;
	let benutzerId: string | null = null;
	if (benutzer !== undefined && benutzer !== null && benutzer !== '') {
		if (typeof benutzer !== 'string' || !UUID.test(benutzer)) throw new ApiFehler(400, 'Benutzer: ungültige Auswahl.');
		benutzerId = benutzer.toLowerCase();
	}
	return {
		name,
		benutzerId,
		werte: {
			bruttoCent: euro(e.brutto, 'Bruttojahresgehalt', false) ?? 0,
			agArt: agArt as AgArt,
			agProzent: agArt === 'prozent' ? (zahl(e.agProzent, 'Arbeitgeber-Anteil (%)', 0, 100, 2, false) ?? 0) : null,
			agEuroCent: agArt === 'euro' ? (euro(e.agEuro, 'Arbeitgeber-Anteil (€)', false) ?? 0) : null,
			tageJahr: zahl(e.tageJahr, 'Produktive Tage', 0, 366, 1, false),
			stundenTag: zahl(e.stundenTag, 'Stunden pro Tag', 0.25, 24, 2, false)
		}
	};
}

const STANDARD: BetriebsWerte = { standardTage: 210, standardStundenTag: 7, risikoProzent: 5, gewinnProzent: 10, aktuellerSatzCent: null };

function zuBetrieb(z: Record<string, any> | undefined): BetriebsWerte {
	if (!z) return { ...STANDARD };
	return {
		standardTage: Number(z.standard_tage),
		standardStundenTag: Number(z.standard_stunden_tag),
		risikoProzent: Number(z.risiko_prozent),
		gewinnProzent: Number(z.gewinn_prozent),
		aktuellerSatzCent: z.aktueller_satz_cent === null ? null : Number(z.aktueller_satz_cent),
		kmSatzCent: z.km_satz_cent === null || z.km_satz_cent === undefined ? null : Number(z.km_satz_cent),
		jahresKm: z.jahres_km === null || z.jahres_km === undefined ? null : Number(z.jahres_km)
	};
}

const zahlOderNull = (w: unknown) => (w === null || w === undefined ? null : Number(w));

function zuMitarbeiter(z: Record<string, any>): KalkMitarbeiter {
	return {
		id: z.id,
		name: z.name,
		benutzerId: z.benutzer_id,
		werte: {
			bruttoCent: Number(z.brutto_cent),
			agArt: z.ag_art,
			agProzent: zahlOderNull(z.ag_prozent),
			agEuroCent: zahlOderNull(z.ag_euro_cent),
			tageJahr: zahlOderNull(z.tage_jahr),
			stundenTag: zahlOderNull(z.stunden_tag)
		}
	};
}

function zuKosten(z: Record<string, any>): KostenZeile {
	return {
		id: z.id,
		name: z.name,
		kategorie: z.kategorie,
		betragCent: Number(z.betrag_cent),
		intervall: z.intervall,
		abschreibungMonate: zahlOderNull(z.abschreibung_monate),
		aktiv: z.aktiv
	};
}

const MA_SPALTEN = `id, name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent, tage_jahr, stunden_tag`;
const KOSTEN_SPALTEN = `id, name, kategorie, betrag_cent, intervall, abschreibung_monate, aktiv`;

async function lade(tx: TransactionSql, k: Kontext): Promise<KalkulationDaten> {
	const [b] = await tx`select * from app.kalkulation_betrieb where betrieb_id = ${k.betriebId}`;
	const ma = await tx`
		select ${tx.unsafe(MA_SPALTEN)} from app.kalkulation_mitarbeiter
		where betrieb_id = ${k.betriebId} order by public.unaccent(lower(name)), angelegt, id`;
	const ko = await tx`
		select ${tx.unsafe(KOSTEN_SPALTEN)} from app.kalkulation_kosten
		where betrieb_id = ${k.betriebId} order by sortierung, angelegt, id`;
	const betrieb = zuBetrieb(b);
	const kosten = ko.map(zuKosten);
	const mitarbeiter = ma.map(zuMitarbeiter);
	return { betrieb, kosten, mitarbeiter, uebersicht: berechneUebersicht(betrieb, kosten, mitarbeiter) };
}

export async function ladeKalkulation(k: Kontext): Promise<KalkulationDaten> {
	return mitBetrieb(k, (tx) => lade(tx, k));
}

const aktuellesJahr = () => Number(new Date().toLocaleString('de-DE', { year: 'numeric', timeZone: 'Europe/Berlin' }));

async function schreibeBetrieb(tx: TransactionSql, k: Kontext, w: BetriebsWerte): Promise<void> {
	await tx`
		insert into app.kalkulation_betrieb (betrieb_id, jahr, standard_tage, standard_stunden_tag, gewinn_prozent, risiko_prozent,
			aktueller_satz_cent, km_satz_cent, jahres_km)
		values (${k.betriebId}, ${aktuellesJahr()}, ${w.standardTage}, ${w.standardStundenTag}, ${w.gewinnProzent}, ${w.risikoProzent},
			${w.aktuellerSatzCent}, ${w.kmSatzCent ?? null}, ${w.jahresKm ?? null})
		on conflict (betrieb_id) do update set standard_tage = excluded.standard_tage,
			standard_stunden_tag = excluded.standard_stunden_tag, gewinn_prozent = excluded.gewinn_prozent,
			risiko_prozent = excluded.risiko_prozent, aktueller_satz_cent = excluded.aktueller_satz_cent,
			km_satz_cent = excluded.km_satz_cent, jahres_km = excluded.jahres_km`;
}

export async function speichereBetriebswerte(k: Kontext, e: Record<string, unknown>): Promise<BetriebsWerte> {
	const w = pruefeBetriebswerte(e);
	await mitBetrieb(k, (tx) => schreibeBetrieb(tx, k, w));
	return w;
}

const kostenNichtGefunden = () => new ApiFehler(404, 'Kostenzeile nicht gefunden.');
const nichtGefunden = () => new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
const pruefeId = (id: unknown, fehler = nichtGefunden) => {
	if (typeof id !== 'string' || !UUID.test(id)) throw fehler();
	return id.toLowerCase();
};

export const MAX_KOSTENZEILEN = 200;

export async function legeKostenAn(k: Kontext, e: Record<string, unknown>): Promise<KostenZeile> {
	const w = pruefeKosten(e);
	return mitBetrieb(k, async (tx) => {
		const [{ n }] = await tx`select count(*)::int as n from app.kalkulation_kosten where betrieb_id = ${k.betriebId}`;
		if (n >= MAX_KOSTENZEILEN) throw new ApiFehler(400, `Höchstens ${MAX_KOSTENZEILEN} Kostenzeilen.`);
		const [z] = await tx`
			insert into app.kalkulation_kosten (betrieb_id, name, kategorie, betrag_cent, intervall, abschreibung_monate, aktiv, sortierung)
			values (${k.betriebId}, ${w.name}, ${w.kategorie}, ${w.betragCent}, ${w.intervall}, ${w.abschreibungMonate}, ${w.aktiv}, ${n})
			returning ${tx.unsafe(KOSTEN_SPALTEN)}`;
		return zuKosten(z);
	});
}

export async function aendereKosten(k: Kontext, id: unknown, e: Record<string, unknown>): Promise<KostenZeile> {
	const kid = pruefeId(id, kostenNichtGefunden);
	const w = pruefeKosten(e);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			update app.kalkulation_kosten set name = ${w.name}, kategorie = ${w.kategorie}, betrag_cent = ${w.betragCent},
				intervall = ${w.intervall}, abschreibung_monate = ${w.abschreibungMonate}, aktiv = ${w.aktiv}
			where id = ${kid} and betrieb_id = ${k.betriebId}
			returning ${tx.unsafe(KOSTEN_SPALTEN)}`;
		if (!z) throw kostenNichtGefunden();
		return zuKosten(z);
	});
}

export async function loescheKosten(k: Kontext, id: unknown): Promise<void> {
	const kid = pruefeId(id, kostenNichtGefunden);
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.kalkulation_kosten where id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw kostenNichtGefunden();
	});
}

async function pruefeBenutzer(tx: TransactionSql, k: Kontext, id: string | null): Promise<void> {
	if (id === null) return;
	const [b] = await tx`select 1 from app.benutzer where id = ${id} and betrieb_id = ${k.betriebId}`;
	if (!b) throw new ApiFehler(400, 'Benutzer: nicht gefunden.');
}

export async function legeKalkMitarbeiterAn(k: Kontext, e: Record<string, unknown>): Promise<KalkMitarbeiter> {
	const m = pruefeMitarbeiter(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeBenutzer(tx, k, m.benutzerId);
		const w = m.werte;
		const [z] = await tx`
			insert into app.kalkulation_mitarbeiter (betrieb_id, name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent,
				tage_jahr, stunden_tag)
			values (${k.betriebId}, ${m.name}, ${m.benutzerId}, ${w.bruttoCent}, ${w.agArt}, ${w.agProzent}, ${w.agEuroCent},
				${w.tageJahr}, ${w.stundenTag})
			returning ${tx.unsafe(MA_SPALTEN)}`;
		return zuMitarbeiter(z);
	});
}

export async function aendereKalkMitarbeiter(k: Kontext, id: unknown, e: Record<string, unknown>): Promise<KalkMitarbeiter> {
	const mid = pruefeId(id);
	const m = pruefeMitarbeiter(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeBenutzer(tx, k, m.benutzerId);
		const w = m.werte;
		const [z] = await tx`
			update app.kalkulation_mitarbeiter set name = ${m.name}, benutzer_id = ${m.benutzerId}, brutto_cent = ${w.bruttoCent},
				ag_art = ${w.agArt}, ag_prozent = ${w.agProzent}, ag_euro_cent = ${w.agEuroCent}, tage_jahr = ${w.tageJahr},
				stunden_tag = ${w.stundenTag}
			where id = ${mid} and betrieb_id = ${k.betriebId}
			returning ${tx.unsafe(MA_SPALTEN)}`;
		if (!z) throw nichtGefunden();
		return zuMitarbeiter(z);
	});
}

export async function loescheKalkMitarbeiter(k: Kontext, id: unknown): Promise<void> {
	const mid = pruefeId(id);
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.kalkulation_mitarbeiter where id = ${mid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}

/**
 * „Beispiel aus Jamils Excel laden“: fügt die Kostenzeilen hinzu (nur wenn noch keine gleichnamige da ist) und setzt
 * eine übernommene v1-Summe auf inaktiv (sonst doppelt gezählt). Mitarbeiter (3 × ohne Gehalt, Lohn steht als
 * Kostenzeile) nur, wenn noch keine erfasst sind; Standard 210 Tage × 7 Stunden. Haben erfasste Mitarbeiter schon ein
 * Gehalt, entfällt die Lohn-Zeile der Excel (sonst doppelt). Bestehende Werte bleiben sonst.
 */
export async function ladeBeispiel(k: Kontext): Promise<KalkulationDaten> {
	return mitBetrieb(k, async (tx) => {
		const vorher = await lade(tx, k);
		const namen = new Set(vorher.kosten.map((z) => z.name));
		const lohnBeiMitarbeitern = vorher.mitarbeiter.some((m) => m.werte.bruttoCent > 0);
		let n = vorher.kosten.length;
		for (const b of BEISPIEL_KOSTEN) {
			if (namen.has(b.name) || (b.kategorie === 'personal' && lohnBeiMitarbeitern)) continue;
			await tx`
				insert into app.kalkulation_kosten (betrieb_id, name, kategorie, betrag_cent, intervall, sortierung)
				values (${k.betriebId}, ${b.name}, ${b.kategorie}, ${b.betragCent}, 'monatlich', ${n++})`;
		}
		await tx`
			update app.kalkulation_kosten set aktiv = false
			where betrieb_id = ${k.betriebId} and name = 'Gemeinkosten (Summe aus der bisherigen Kalkulation)'`;
		if (vorher.mitarbeiter.length === 0) {
			for (let i = 1; i <= BEISPIEL_MITARBEITER; i++) {
				await tx`
					insert into app.kalkulation_mitarbeiter (betrieb_id, name, brutto_cent, ag_art, ag_euro_cent)
					values (${k.betriebId}, ${`Mitarbeiter ${i}`}, 0, 'euro', 0)`;
			}
		}
		await schreibeBetrieb(tx, k, { ...vorher.betrieb, standardTage: BEISPIEL_TAGE, standardStundenTag: BEISPIEL_STUNDEN_TAG });
		return lade(tx, k);
	});
}

/**
 * Firmensatz aus der Kalkulation (kostendeckend/empfohlen) für Katalog, Angebote und Auslastung – `null`, solange die
 * Kalkulation keinen Satz ergibt. Enthält keine Gehälter; Aufrufer zeigen ihn nur mit „Preise sehen“.
 */
export async function ladeFirmensatz(k: Kontext): Promise<{ kostendeckendCent: number; empfohlenCent: number } | null> {
	const { uebersicht } = await ladeKalkulation(k);
	if (uebersicht.kostendeckendCent === null || uebersicht.empfohlenCent === null) return null;
	return { kostendeckendCent: uebersicht.kostendeckendCent, empfohlenCent: uebersicht.empfohlenCent };
}
