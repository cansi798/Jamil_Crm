import { berlinTag, wochentag } from '../../zeit';
import type { KiAktion, KiEntwurf, Werkzeug } from '../sprache/aktionen';
import { FakeKi } from './fake';
import { MistralKi } from './mistral';
import { OpenAiKompatibelKi } from './openai-kompatibel';

/**
 * Austauschbare KI (Pflichtenheft 9.2): Die App spricht nur mit dieser Schnittstelle. Umsetzungen: `MistralKi`
 * (EU-API, Function Calling), `OpenAiKompatibelKi` (jede OpenAI-kompatible API, z. B. Xiaomi MiMo oder mittwald)
 * und `FakeKi` (regelbasiert, für Tests und solange kein Schlüssel da ist).
 *
 * Datensparsamkeit: Die KI bekommt nur den gesprochenen Text, das heutige Datum (Berlin) und das Aktions-Schema –
 * beim Angebotsentwurf zusätzlich Katalogpositionen (Schlüssel, Bezeichnung, Einheit, Gewerk; nie Preise) und ggf.
 * ein Foto. Nie Kundennamen aus der Datenbank, Adressen, Preise oder Benutzerdaten.
 */

export type KiKontext = { heute: string; wochentag: string };
export type KatalogFuerKi = { schluessel: string; bezeichnung: string; einheit: string; gewerk: string | null };
export type FotoFuerKi = { bytes: Uint8Array; typ: 'image/jpeg' | 'image/png' };
export type EntwurfEingabe = { text: string; katalog: KatalogFuerKi[]; foto?: FotoFuerKi };

/**
 * Bild-Auswertung (Lieferschein auslesen, Foto-Aufmaß): System-Anweisung, kurzer Text, 1–4 Fotos und GENAU EIN
 * Werkzeug. Die Antwort prüft `pruefe` streng (wirft bei Unsinn → ein zweiter Versuch, dann 502). Datensparsamkeit:
 * nur die Fotos und die Angaben des Nutzers (z. B. Referenzmaß) – nie Kundennamen, Adressen oder Preise aus der Datenbank.
 */
export type BildAnfrage<T> = { system: string; text: string; bilder: FotoFuerKi[]; werkzeug: Werkzeug; pruefe: (args: unknown) => T };

export interface KiAnbieter {
	readonly name: 'mistral' | 'openai-kompatibel' | 'fake';
	aktionAusText(text: string, kontext: KiKontext): Promise<KiAktion>;
	angebotsEntwurf(eingabe: EntwurfEingabe): Promise<KiEntwurf>;
	bildAuswertung<T>(anfrage: BildAnfrage<T>): Promise<T>;
}

const WOCHENTAG_NAMEN = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Heutiges Datum in Berlin samt Wochentag (das Einzige, was die KI über „jetzt“ erfährt). */
export function kiKontext(jetzt = new Date()): KiKontext {
	const heute = berlinTag(jetzt);
	return { heute, wochentag: WOCHENTAG_NAMEN[wochentag(heute)] };
}

/**
 * Auswahl per Umgebung:
 * - `CRM_KI_ANBIETER=mistral` UND Schlüssel in `CRM_MISTRAL_KEY` → Mistral (Modell `CRM_KI_MODELL`, Standard
 *   `mistral-small-latest`),
 * - `CRM_KI_ANBIETER=openai-kompatibel` UND `CRM_KI_URL`, `CRM_KI_KEY`, `CRM_KI_MODELL` → OpenAI-kompatible API
 *   (optional `CRM_KI_MODELL_SCHNELL` für Sprachbefehle, `CRM_KI_MODELL_FOTO`, `CRM_KI_OHNE_NACHDENKEN=ja|entwurf`),
 * - sonst immer `FakeKi`.
 */
export function waehleAnbieter(env: Record<string, string | undefined> = process.env): KiAnbieter {
	const anbieter = (env.CRM_KI_ANBIETER ?? '').trim();
	const schluessel = (env.CRM_MISTRAL_KEY ?? '').trim();
	if (anbieter === 'mistral' && schluessel !== '') {
		return new MistralKi({
			schluessel,
			modell: env.CRM_KI_MODELL?.trim() || undefined,
			fotoModell: env.CRM_KI_MODELL_FOTO?.trim() || undefined,
			url: env.CRM_MISTRAL_URL?.trim() || undefined
		});
	}
	if (anbieter === 'openai-kompatibel') {
		const url = (env.CRM_KI_URL ?? '').trim();
		const key = (env.CRM_KI_KEY ?? '').trim();
		const modell = (env.CRM_KI_MODELL ?? '').trim();
		if (url !== '' && key !== '' && modell !== '') {
			return new OpenAiKompatibelKi({
				url,
				schluessel: key,
				modell,
				modellSchnell: env.CRM_KI_MODELL_SCHNELL?.trim() || undefined,
				// Alte Vorgabe aus Mistral-Zeiten (pixtral…) gilt hier nicht → dann Hauptmodell
				fotoModell: /^pixtral/i.test(env.CRM_KI_MODELL_FOTO ?? '') ? undefined : env.CRM_KI_MODELL_FOTO?.trim() || undefined,
				ohneNachdenken: ohneNachdenken(env.CRM_KI_OHNE_NACHDENKEN)
			});
		}
		console.warn('KI: openai-kompatibel gewählt, aber CRM_KI_URL, CRM_KI_KEY oder CRM_KI_MODELL fehlt – nutze die Test-KI.');
	}
	return new FakeKi();
}

/** `CRM_KI_OHNE_NACHDENKEN`: ja → immer, entwurf → nur beim Angebotsentwurf, sonst nie. */
function ohneNachdenken(w: string | undefined): boolean | 'entwurf' {
	const v = (w ?? '').trim().toLowerCase();
	if (v === 'entwurf') return 'entwurf';
	return /^(ja|1|true)$/.test(v);
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
