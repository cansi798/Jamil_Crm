/**
 * Tarif-Wissen ohne Serverbezug – darf auch in Oberflächen-Komponenten genutzt werden.
 * Die Prüfungen gegen die Datenbank stehen in `$lib/server/tarif`.
 */

/** Alle Module, die ein Tarif freischalten kann. */
export const MODULE = [
	'kunden',
	'auftraege',
	'plantafel',
	'katalog',
	'angebote',
	'ki_angebote',
	'sprache',
	'zeiterfassung',
	'protokolle',
	'kundenportal',
	'lexware',
	'nextcloud'
] as const;

export type Modul = (typeof MODULE)[number];

export const istModul = (wert: unknown): wert is Modul =>
	typeof wert === 'string' && (MODULE as readonly string[]).includes(wert);

export type TarifInfo = { schluessel: string; name: string; module: readonly string[] };

/** Aufsteigende Preisstufen der Bezahltarife. `test` ist kein Kauftarif und steht immer zuletzt. */
const STUFEN = ['basis', 'profi', 'premium'];
const TEST = 'test';

function rang(schluessel: string): number {
	if (schluessel === TEST) return Number.MAX_SAFE_INTEGER;
	const i = STUFEN.indexOf(schluessel);
	// Unbekannte (später von Can angelegte) Tarife: hinter den bekannten Stufen, vor `test`.
	return i === -1 ? STUFEN.length : i;
}

/** Sortiert Tarifschlüssel aufsteigend nach Preisstufe (basis, profi, premium), `test` zuletzt, Unbekannte alphabetisch dazwischen. */
export function sortiereTarifSchluessel(schluessel: readonly string[]): string[] {
	return [...schluessel].sort((a, b) => rang(a) - rang(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Der günstigste echte Tarif (nie `test`), der das Modul enthält – oder `null`. */
export function niedrigsterTarif(tarife: readonly TarifInfo[], modul: string): TarifInfo | null {
	const passend = tarife.filter((t) => t.schluessel !== TEST && t.module.includes(modul));
	const reihenfolge = sortiereTarifSchluessel(passend.map((t) => t.schluessel));
	return passend.find((t) => t.schluessel === reihenfolge[0]) ?? null;
}
