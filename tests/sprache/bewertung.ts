import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KiAktion } from '../../src/lib/server/sprache/aktionen';

/**
 * Bewertung des Sprach-Testsatzes (tests/sprache/befehle.json): Ein Befehl ist ein Treffer, wenn die Aktion stimmt
 * UND alle erwarteten Kernfelder stimmen. Vergleich der Felder (Pfad mit Punkt, z. B. `start.wochentag`):
 * - Zeitangaben (`tag`, `wochentag`, `datum`, `uhrzeit`, `ende_uhrzeit`), `art`, `plz`: genau gleich,
 * - Texte (Titel, Namen, Stichworte, Adressen): normalisiert (klein, ohne Satzzeichen, ß→ss) – der erkannte Wert muss
 *   den erwarteten enthalten („Familie Schröder“ enthält „Schröder“),
 * - Listen (Mitarbeiter): gleich viele, jeder erwartete Name in genau einem erkannten enthalten.
 */

export type Befehl = {
	nr: number;
	text: string;
	mehrdeutig?: boolean;
	erwartet: { aktion: string; felder: Record<string, unknown> };
	audio: string;
};
export type Testsatz = { heute: string; wochentag: string; befehle: Befehl[] };

export const BEFEHLE_DATEI = fileURLToPath(new URL('./befehle.json', import.meta.url));
export const AUDIO_ORDNER = fileURLToPath(new URL('./', import.meta.url));

export function ladeTestsatz(datei = BEFEHLE_DATEI): Testsatz {
	return JSON.parse(readFileSync(datei, 'utf8')) as Testsatz;
}

const GENAU = new Set(['tag', 'wochentag', 'datum', 'uhrzeit', 'ende_uhrzeit', 'art', 'plz']);

export function normal(w: unknown): string {
	return String(w ?? '')
		.toLowerCase()
		.normalize('NFC')
		.replaceAll('ß', 'ss')
		.replaceAll('ı', 'i')
		.replace(/[^\p{L}\p{N}@.\s]/gu, ' ')
		.replace(/(?<!\S)\.|\.(?!\S)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function hole(objekt: unknown, pfad: string): unknown {
	let wert: any = objekt;
	for (const teil of pfad.split('.')) wert = wert == null ? undefined : wert[teil];
	return wert;
}

export type Bewertung = { treffer: boolean; abweichungen: string[] };

export function bewerte(erwartet: Befehl['erwartet'], ist: KiAktion | { aktion: string; daten: unknown }): Bewertung {
	if (ist.aktion !== erwartet.aktion) return { treffer: false, abweichungen: [`Aktion ${ist.aktion} statt ${erwartet.aktion}`] };
	const abweichungen: string[] = [];
	for (const [pfad, soll] of Object.entries(erwartet.felder)) {
		const istWert = hole(ist.daten, pfad);
		const feld = pfad.split('.').at(-1)!;
		let ok: boolean;
		if (Array.isArray(soll)) {
			const liste = Array.isArray(istWert) ? istWert.map(normal) : [];
			const offen = [...liste];
			ok =
				liste.length === soll.length &&
				soll.every((s) => {
					const i = offen.findIndex((x) => x.includes(normal(s)));
					if (i < 0) return false;
					offen.splice(i, 1);
					return true;
				});
		} else if (GENAU.has(feld)) {
			ok = istWert === soll;
		} else {
			ok = typeof istWert === 'string' && normal(istWert).includes(normal(soll));
		}
		if (!ok) abweichungen.push(`${pfad}: ${JSON.stringify(istWert)} statt ${JSON.stringify(soll)}`);
	}
	return { treffer: abweichungen.length === 0, abweichungen };
}
