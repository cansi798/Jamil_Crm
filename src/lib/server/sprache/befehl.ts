import { ApiFehler } from '../fehler';
import { betriebKontext } from '../rechte';
import { pruefeModul } from '../tarif';
import { kiAnbieter, kiKontext } from '../ki/anbieter';
import { verbrauche } from '../ki/kontingent';
import { hinweisKarte, loeseAuf, type Karte } from './aufloesen';
import { rechteHinweis } from './rechte';
import { signiere } from './vorschlag';

/**
 * Vom erkannten Text zur Bestätigungskarte: Modul `sprache` → Kontingent (eine KI-Anfrage) → KI liefert genau eine
 * Aktion → Rechte des Nutzers → Namen/Zeiten auflösen → signierter Vorschlag. Gespeichert wird hier nichts; der
 * Text wird nicht aufbewahrt. Ohne Berechtigung oder bei „unbekannt“ gibt es keinen Vorschlag, nur die Karte.
 */

export const MAX_BEFEHL_ZEICHEN = 500;
export const UNBEKANNT_HINWEIS =
	'Ich kann Kunden, Aufträge, To-dos und Termine anlegen, Termine verschieben und Angebotsentwürfe erstellen.';

export type Befehlsergebnis = { text: string; vorschlag: string | null; karte: Karte };

/** Prüft getippten Befehlstext (400 bei leer/zu lang/kein Text). */
export function pruefeBefehlText(w: unknown): string {
	if (typeof w !== 'string') throw new ApiFehler(400, 'Bitte einen Befehl eingeben.');
	const text = w.replaceAll('\u0000', '').replace(/\s+/g, ' ').trim();
	if (text === '') throw new ApiFehler(400, 'Bitte einen Befehl eingeben.');
	if ([...text].length > MAX_BEFEHL_ZEICHEN) throw new ApiFehler(400, `Der Befehl ist zu lang (höchstens ${MAX_BEFEHL_ZEICHEN} Zeichen).`);
	return text;
}

/** Modul `sprache` (+ angemeldet, Betrieb) – vor jedem weiteren Schritt. */
export async function pruefeSprachZugang(locals: { nutzer: Nutzer | null }): Promise<void> {
	betriebKontext(locals);
	await pruefeModul(locals, 'sprache');
}

export async function vorschlagAusText(locals: { nutzer: Nutzer | null }, text: string, jetzt = new Date()): Promise<Befehlsergebnis> {
	const k = betriebKontext(locals);
	const nutzer = locals.nutzer!;
	await verbrauche(k, 'aktion');
	const aktion = await kiAnbieter().aktionAusText(text, kiKontext(jetzt));
	if (aktion.aktion === 'unbekannt') {
		return { text, vorschlag: null, karte: hinweisKarte('unbekannt', UNBEKANNT_HINWEIS) };
	}
	const fehlt = await rechteHinweis(locals, aktion.aktion);
	if (fehlt) return { text, vorschlag: null, karte: hinweisKarte(aktion.aktion, fehlt) };
	const vorschau = await loeseAuf(k, nutzer, aktion, jetzt);
	if (aktion.aktion === 'auftrag_anlegen' && vorschau.werte.einsaetze?.length > 0) {
		const ohnePlanung = await rechteHinweis(locals, aktion.aktion, { mitEinsaetzen: true });
		if (ohnePlanung) {
			return {
				text,
				vorschlag: null,
				karte: { ...vorschau.karte, fehler: `${ohnePlanung} (Mitarbeiter einplanen).`, aendern: vorschau.karte.aendern }
			};
		}
	}
	const vorschlag =
		vorschau.fehlt.length > 0
			? null
			: signiere({ aktion: vorschau.aktion, werte: vorschau.werte, auswahl: vorschau.auswahl }, nutzer.id, k.betriebId);
	return { text, vorschlag, karte: vorschau.karte };
}
