import { berlinTag, wochentag } from '../../zeit';
import type { KiAktion, KiEntwurf } from '../sprache/aktionen';
import { FakeKi } from './fake';
import { MistralKi } from './mistral';

/**
 * Austauschbare KI (Pflichtenheft 9.2): Die App spricht nur mit dieser Schnittstelle. Umsetzungen: `MistralKi`
 * (EU-API, Function Calling) und `FakeKi` (regelbasiert, für Tests und solange kein Schlüssel da ist).
 *
 * Datensparsamkeit: Die KI bekommt nur den gesprochenen Text, das heutige Datum (Berlin) und das Aktions-Schema –
 * beim Angebotsentwurf zusätzlich Katalogpositionen (Schlüssel, Bezeichnung, Einheit, Gewerk; nie Preise) und ggf.
 * ein Foto. Nie Kundennamen aus der Datenbank, Adressen, Preise oder Benutzerdaten.
 */

export type KiKontext = { heute: string; wochentag: string };
export type KatalogFuerKi = { schluessel: string; bezeichnung: string; einheit: string; gewerk: string | null };
export type FotoFuerKi = { bytes: Uint8Array; typ: 'image/jpeg' | 'image/png' };
export type EntwurfEingabe = { text: string; katalog: KatalogFuerKi[]; foto?: FotoFuerKi };

export interface KiAnbieter {
	readonly name: 'mistral' | 'fake';
	aktionAusText(text: string, kontext: KiKontext): Promise<KiAktion>;
	angebotsEntwurf(eingabe: EntwurfEingabe): Promise<KiEntwurf>;
}

const WOCHENTAG_NAMEN = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Heutiges Datum in Berlin samt Wochentag (das Einzige, was die KI über „jetzt“ erfährt). */
export function kiKontext(jetzt = new Date()): KiKontext {
	const heute = berlinTag(jetzt);
	return { heute, wochentag: WOCHENTAG_NAMEN[wochentag(heute)] };
}

/**
 * Auswahl per Umgebung: `CRM_KI_ANBIETER=mistral` UND ein Schlüssel in `CRM_MISTRAL_KEY` → Mistral (Modell
 * `CRM_KI_MODELL`, Standard `mistral-small-latest`); sonst immer `FakeKi`.
 */
export function waehleAnbieter(env: Record<string, string | undefined> = process.env): KiAnbieter {
	const schluessel = (env.CRM_MISTRAL_KEY ?? '').trim();
	if (env.CRM_KI_ANBIETER === 'mistral' && schluessel !== '') {
		return new MistralKi({
			schluessel,
			modell: env.CRM_KI_MODELL?.trim() || undefined,
			fotoModell: env.CRM_KI_MODELL_FOTO?.trim() || undefined,
			url: env.CRM_MISTRAL_URL?.trim() || undefined
		});
	}
	return new FakeKi();
}

let ersatz: KiAnbieter | null = null;
let standard: KiAnbieter | null = null;

/** Nur für Tests: eigenen Anbieter einsetzen (`null` = wieder per Umgebung). */
export function setzeKiAnbieter(a: KiAnbieter | null): void {
	ersatz = a;
	standard = null;
}

/** Der aktive Anbieter (einmal aus der Umgebung gewählt). */
export function kiAnbieter(): KiAnbieter {
	if (ersatz) return ersatz;
	standard ??= waehleAnbieter();
	return standard;
}
