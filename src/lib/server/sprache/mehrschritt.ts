import type { Kontext } from '../db';
import { MAX_SCHRITTE, type SchrittAktion, type SchrittName } from './aktionen';
import { hinweisKarte, loeseAuf, mitVerweisen, type Auswahl, type FruehererSchritt, type Karte, type KartenSchritt } from './aufloesen';
import { rechteHinweis } from './rechte';

/**
 * Mehrere Schritte in einem Satz (Jamil msg 2983): „Leg Kunde Müller an, mach einen Auftrag Badsanierung und plan
 * Murat für Montag ein.“ Jeder Schritt wird genau wie ein einzelner Befehl geprüft (Rechte) und aufgelöst. Ein
 * späterer Schritt kann sich auf einen Kunden/Auftrag beziehen, den ein früherer Schritt erst anlegt – dann steht in
 * seinen Werten ein Platzhalter („$kunde:1“, „$auftrag:2“), den das Ausführen durch die neue ID ersetzt.
 */

/** Signierter Inhalt je Schritt (wie ein einzelner Vorschlag) plus Titel für die Ergebnisliste. */
export type SchrittVorschau = { aktion: SchrittName; titel: string; werte: Record<string, any>; auswahl: Auswahl[] };
export type MehrereVorschau = { aktion: 'mehrere_schritte'; schritte: SchrittVorschau[] };

/** Aktionen, die einen Kunden bzw. Auftrag aus einem früheren Schritt nutzen können. */
const NUTZT_KUNDE = new Set<string>(['auftrag_anlegen']);
const NUTZT_AUFTRAG = new Set<string>(['einsatz_anlegen', 'todo_anlegen', 'mitarbeiter_zuweisen', 'status_aendern', 'quelle_setzen', 'vorlage_anwenden', 'protokoll_ausfuellen']);

export const PLATZHALTER = /^\$(kunde|auftrag):(\d{1,2})$/;

const fuerMich = (m?: string[]) => !m || m.length === 0 || m.every((x) => /^(ich|mich|mir)$/i.test(x.trim()));

/** Feldname einer Auswahl im Schritt `nr` (auf der gemeinsamen Karte eindeutig). */
export const schrittFeld = (nr: number, feld: string) => `${nr}:${feld}`;

export async function schritteVorschau(
	locals: { nutzer: Nutzer | null },
	k: Kontext,
	nutzer: Nutzer,
	schritte: SchrittAktion[],
	jetzt: Date
): Promise<{ vorschau: MehrereVorschau | null; karte: Karte }> {
	const karte: Karte = { aktion: 'mehrere_schritte', titel: `${schritte.length} Schritte`, zeilen: [], auswahl: [], warnungen: [], fehler: null, aendern: null, schritte: [] };
	if (schritte.length > MAX_SCHRITTE) {
		return { vorschau: null, karte: { ...karte, fehler: `Höchstens ${MAX_SCHRITTE} Schritte auf einmal – bitte den Befehl aufteilen.` } };
	}
	const fruehere: FruehererSchritt[] = [];
	const vorschau: SchrittVorschau[] = [];
	const fehler: string[] = [];
	for (const [i, roh] of schritte.entries()) {
		const nr = i + 1;
		let s = roh;
		// Termin/Aufgabe ohne Auftrag nach einem neuen Auftrag: gehört zu diesem (sonst würde es ein eigener Termin)
		const letzterAuftrag = fruehere.filter((f) => f.art === 'auftrag').at(-1);
		if (letzterAuftrag && ((s.aktion === 'einsatz_anlegen' && !s.daten.auftrag && !s.daten.eigener_titel) || (s.aktion === 'todo_anlegen' && !s.daten.auftrag))) {
			s = { ...s, daten: { ...s.daten, auftrag: `#${letzterAuftrag.nr}` } } as SchrittAktion;
		}
		const eigenerTermin = s.aktion === 'einsatz_anlegen' && (!!s.daten.eigener_titel || !s.daten.auftrag) && fuerMich(s.daten.mitarbeiter);
		let ks: KartenSchritt;
		const rechte = await rechteHinweis(locals, s.aktion, { eigenerTermin });
		if (rechte) {
			ks = { nr, aktion: s.aktion, titel: hinweisKarte(s.aktion, rechte).titel, zeilen: [], warnungen: [], fehler: rechte };
		} else {
			const v = await mitVerweisen({ schritte: fruehere, kunde: NUTZT_KUNDE.has(s.aktion), auftrag: NUTZT_AUFTRAG.has(s.aktion) }, () => loeseAuf(k, nutzer, s, jetzt));
			let zusatz: string | null = null;
			// Gleiche Zusatzprüfungen wie beim einzelnen Befehl (befehl.ts)
			if (s.aktion === 'auftrag_anlegen' && v.werte.einsaetze?.length > 0) {
				const r = await rechteHinweis(locals, s.aktion, { mitEinsaetzen: true });
				if (r) zusatz = `${r} (Mitarbeiter einplanen).`;
			}
			if (s.aktion === 'protokoll_ausfuellen' && !v.werte.formular) zusatz = await rechteHinweis(locals, s.aktion, { formular: false });
			const f = [...v.fehlt, ...(zusatz ? [zusatz] : [])];
			ks = { nr, aktion: s.aktion, titel: v.karte.titel, zeilen: v.karte.zeilen, warnungen: v.warnungen, fehler: f.length > 0 ? f.join(' ') : null };
			vorschau.push({ aktion: s.aktion, titel: v.karte.titel, werte: v.werte, auswahl: v.auswahl });
			for (const a of v.auswahl) karte.auswahl.push({ ...a, feld: schrittFeld(nr, a.feld), frage: `Schritt ${nr}: ${a.frage}` });
			merkeNeues(fruehere, nr, s.aktion, v.werte, v.karte.zeilen);
		}
		if (ks.fehler) fehler.push(`Schritt ${nr}: ${ks.fehler}`);
		karte.schritte!.push(ks);
	}
	karte.fehler = fehler.length > 0 ? fehler.join(' ') : null;
	return { vorschau: fehler.length > 0 ? null : { aktion: 'mehrere_schritte', schritte: vorschau }, karte };
}

/** Neuer Kunde/Auftrag eines Schritts: für spätere Schritte über „#nr“ oder den Namen auffindbar. */
function merkeNeues(fruehere: FruehererSchritt[], nr: number, aktion: SchrittName, werte: Record<string, any>, zeilen: { label: string; wert: string }[]): void {
	const ohneNeu = (t: string) => t.replace(/\s*\(neu, Schritt \d+\)$/, '');
	if (aktion === 'kunde_anlegen') {
		const kd = (werte.kunde ?? {}) as Record<string, string | null>;
		const name = zeilen.find((z) => z.label === 'Name')?.wert ?? [kd.vorname, kd.nachname].filter(Boolean).join(' ');
		const namen = [kd.firma, kd.nachname, [kd.vorname, kd.nachname].filter(Boolean).join(' '), name].filter((x): x is string => !!x);
		fruehere.push({ nr, art: 'kunde', platzhalter: `$kunde:${nr}`, namen, titel: name, kundeName: name });
	}
	if (aktion === 'auftrag_anlegen') {
		const kunde = ohneNeu(zeilen.find((z) => z.label === 'Kunde')?.wert ?? '').replace(/\s*\(bitte wählen\)$/, '');
		const titel = String(werte.titel ?? 'Auftrag');
		fruehere.push({ nr, art: 'auftrag', platzhalter: `$auftrag:${nr}`, namen: [titel, kunde].filter(Boolean), titel, kundeName: kunde });
	}
}

/** Ersetzt Platzhalter („$auftrag:2“) überall in den Werten durch die IDs der schon ausgeführten Schritte. */
export function ersetzePlatzhalter(werte: unknown, ergebnisse: Map<number, { kundeId?: string; auftragId?: string }>): any {
	if (typeof werte === 'string') {
		const m = PLATZHALTER.exec(werte);
		if (!m) return werte;
		const e = ergebnisse.get(Number(m[2]));
		const id = m[1] === 'kunde' ? e?.kundeId : e?.auftragId;
		if (!id) throw new Error(`Platzhalter ${werte} ohne Ergebnis`);
		return id;
	}
	if (Array.isArray(werte)) return werte.map((x) => ersetzePlatzhalter(x, ergebnisse));
	if (werte && typeof werte === 'object') return Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, ersetzePlatzhalter(v, ergebnisse)]));
	return werte;
}
