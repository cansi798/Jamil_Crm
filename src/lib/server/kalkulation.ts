import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { pruefeRecht } from './rechte';
import { darf } from './tarif';
import { leseEuroInCent } from '../geld';
import {
	berechneUebersicht,
	type AgArt,
	type BetriebsWerte,
	type MitarbeiterWerte,
	type PufferArt,
	type Uebersicht
} from '../kalkulation';

/**
 * Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026): Firmenwerte und Mitarbeiter speichern (Migration 027),
 * rechnen mit src/lib/kalkulation.ts. Gehälter sind vertraulich: Zugriff nur mit „Preise sehen“ UND „Einstellungen“
 * (Chef), Modul `katalog` (Preisbildung).
 */

export type KalkMitarbeiter = { id: string; name: string; benutzerId: string | null; werte: MitarbeiterWerte };

export type KalkulationDaten = { betrieb: BetriebsWerte; mitarbeiter: KalkMitarbeiter[]; uebersicht: Uebersicht };

export const FIRMA_FELDER = [
	'jahr',
	'gemeinkosten',
	'anzahlProduktiv',
	'feiertage',
	'pufferArt',
	'pufferWert',
	'gewinnProzent',
	'risikoProzent',
	'aktuellerSatz'
] as const;
export const MITARBEITER_FELDER = [
	'name',
	'benutzerId',
	'brutto',
	'agArt',
	'agProzent',
	'agEuro',
	'wochenstunden',
	'urlaubstage',
	'krankheitstage'
] as const;

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
	const pufferArt = e.pufferArt;
	if (pufferArt !== 'prozent' && pufferArt !== 'stunden') throw new ApiFehler(400, 'Puffer: Bitte „Prozent“ oder „Stunden pro Jahr“ wählen.');
	return {
		jahr: zahl(e.jahr, 'Jahr', 2000, 2100, 0)!,
		gemeinkostenCent: euro(e.gemeinkosten, 'Gemeinkosten')!,
		anzahlProduktiv: zahl(e.anzahlProduktiv, 'Anzahl produktiver Mitarbeiter', 0, 10000)!,
		feiertage: zahl(e.feiertage, 'Feiertage', 0, 366, 1)!,
		pufferArt: pufferArt as PufferArt,
		pufferWert: zahl(e.pufferWert, 'Puffer', 0, pufferArt === 'prozent' ? 100 : 8784)!,
		gewinnProzent: zahl(e.gewinnProzent, 'Gewinnaufschlag', 0, 1000)!,
		risikoProzent: zahl(e.risikoProzent, 'Risikoaufschlag', 0, 1000)!,
		aktuellerSatzCent: euro(e.aktuellerSatz, 'Aktueller Stundensatz', false)
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
			bruttoCent: euro(e.brutto, 'Bruttojahresgehalt')!,
			agArt: agArt as AgArt,
			agProzent: agArt === 'prozent' ? zahl(e.agProzent, 'Arbeitgeber-Anteil (%)', 0, 100) : null,
			agEuroCent: agArt === 'euro' ? euro(e.agEuro, 'Arbeitgeber-Anteil (€)') : null,
			wochenstunden: zahl(e.wochenstunden, 'Wochenarbeitszeit', 0.5, 80)!,
			urlaubstage: zahl(e.urlaubstage, 'Urlaubstage', 0, 366, 1)!,
			krankheitstage: zahl(e.krankheitstage, 'Krankheitstage', 0, 366, 1)!
		}
	};
}

const STANDARD = (): Omit<BetriebsWerte, 'jahr'> => ({
	gemeinkostenCent: 0,
	anzahlProduktiv: 0,
	feiertage: 10,
	pufferArt: 'prozent',
	pufferWert: 10,
	gewinnProzent: 10,
	risikoProzent: 5,
	aktuellerSatzCent: null
});

function zuBetrieb(z: Record<string, any> | undefined): BetriebsWerte {
	if (!z) return { jahr: Number(new Date().toLocaleString('de-DE', { year: 'numeric', timeZone: 'Europe/Berlin' })), ...STANDARD() };
	return {
		jahr: Number(z.jahr),
		gemeinkostenCent: Number(z.gemeinkosten_cent),
		anzahlProduktiv: Number(z.anzahl_produktiv),
		feiertage: Number(z.feiertage),
		pufferArt: z.puffer_art,
		pufferWert: Number(z.puffer_wert),
		gewinnProzent: Number(z.gewinn_prozent),
		risikoProzent: Number(z.risiko_prozent),
		aktuellerSatzCent: z.aktueller_satz_cent === null ? null : Number(z.aktueller_satz_cent)
	};
}

function zuMitarbeiter(z: Record<string, any>): KalkMitarbeiter {
	return {
		id: z.id,
		name: z.name,
		benutzerId: z.benutzer_id,
		werte: {
			bruttoCent: Number(z.brutto_cent),
			agArt: z.ag_art,
			agProzent: z.ag_prozent === null ? null : Number(z.ag_prozent),
			agEuroCent: z.ag_euro_cent === null ? null : Number(z.ag_euro_cent),
			wochenstunden: Number(z.wochenstunden),
			urlaubstage: Number(z.urlaubstage),
			krankheitstage: Number(z.krankheitstage)
		}
	};
}

const MA_SPALTEN = `id, name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent, wochenstunden, urlaubstage, krankheitstage`;

export async function ladeKalkulation(k: Kontext): Promise<KalkulationDaten> {
	return mitBetrieb(k, async (tx) => {
		const [b] = await tx`select * from app.kalkulation_betrieb where betrieb_id = ${k.betriebId}`;
		const z = await tx`
			select ${tx.unsafe(MA_SPALTEN)} from app.kalkulation_mitarbeiter
			where betrieb_id = ${k.betriebId} order by public.unaccent(lower(name)), angelegt, id`;
		const betrieb = zuBetrieb(b);
		const mitarbeiter = z.map(zuMitarbeiter);
		return { betrieb, mitarbeiter, uebersicht: berechneUebersicht(betrieb, mitarbeiter.map((m) => ({ id: m.id, name: m.name, werte: m.werte }))) };
	});
}

export async function speichereBetriebswerte(k: Kontext, e: Record<string, unknown>): Promise<BetriebsWerte> {
	const w = pruefeBetriebswerte(e);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			insert into app.kalkulation_betrieb (betrieb_id, jahr, gemeinkosten_cent, anzahl_produktiv, feiertage, puffer_art,
				puffer_wert, gewinn_prozent, risiko_prozent, aktueller_satz_cent)
			values (${k.betriebId}, ${w.jahr}, ${w.gemeinkostenCent}, ${w.anzahlProduktiv}, ${w.feiertage}, ${w.pufferArt},
				${w.pufferWert}, ${w.gewinnProzent}, ${w.risikoProzent}, ${w.aktuellerSatzCent})
			on conflict (betrieb_id) do update set jahr = excluded.jahr, gemeinkosten_cent = excluded.gemeinkosten_cent,
				anzahl_produktiv = excluded.anzahl_produktiv, feiertage = excluded.feiertage, puffer_art = excluded.puffer_art,
				puffer_wert = excluded.puffer_wert, gewinn_prozent = excluded.gewinn_prozent,
				risiko_prozent = excluded.risiko_prozent, aktueller_satz_cent = excluded.aktueller_satz_cent
			returning *`;
		return zuBetrieb(z);
	});
}

async function pruefeBenutzer(tx: TransactionSql, k: Kontext, id: string | null): Promise<void> {
	if (id === null) return;
	const [b] = await tx`select 1 from app.benutzer where id = ${id} and betrieb_id = ${k.betriebId}`;
	if (!b) throw new ApiFehler(400, 'Benutzer: nicht gefunden.');
}

const nichtGefunden = () => new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
const pruefeId = (id: unknown) => {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	return id.toLowerCase();
};

export async function legeKalkMitarbeiterAn(k: Kontext, e: Record<string, unknown>): Promise<KalkMitarbeiter> {
	const m = pruefeMitarbeiter(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeBenutzer(tx, k, m.benutzerId);
		const w = m.werte;
		const [z] = await tx`
			insert into app.kalkulation_mitarbeiter (betrieb_id, name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent,
				wochenstunden, urlaubstage, krankheitstage)
			values (${k.betriebId}, ${m.name}, ${m.benutzerId}, ${w.bruttoCent}, ${w.agArt}, ${w.agProzent}, ${w.agEuroCent},
				${w.wochenstunden}, ${w.urlaubstage}, ${w.krankheitstage})
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
				ag_art = ${w.agArt}, ag_prozent = ${w.agProzent}, ag_euro_cent = ${w.agEuroCent}, wochenstunden = ${w.wochenstunden},
				urlaubstage = ${w.urlaubstage}, krankheitstage = ${w.krankheitstage}
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
