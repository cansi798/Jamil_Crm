import { ApiFehler } from '../fehler';
import { betriebKontext } from '../rechte';
import { pruefeModul } from '../tarif';
import { kiAnbieter, kiKontext } from '../ki/anbieter';
import { verbrauche } from '../ki/kontingent';
import { hinweisKarte, loeseAuf, personAufloesen, type Karte } from './aufloesen';
import { kolonnenplan, tagesplan, zeitraumTage } from '../tagesplan';
import { berlinTag } from '../../zeit';
import type { TagesplanDaten } from './aktionen';
import { rechteHinweis } from './rechte';
import { signiere } from './vorschlag';

/**
 * Vom erkannten Text zur Bestätigungskarte: Modul `sprache` → Kontingent (eine KI-Anfrage) → KI liefert genau eine
 * Aktion → Rechte des Nutzers → Namen/Zeiten auflösen → signierter Vorschlag. Gespeichert wird hier nichts; der
 * Text wird nicht aufbewahrt. Ohne Berechtigung oder bei „unbekannt“ gibt es keinen Vorschlag, nur die Karte.
 */

export const MAX_BEFEHL_ZEICHEN = 2000;
export const UNBEKANNT_HINWEIS =
	'Ich kann Kunden, Aufträge, To-dos (auch wiederkehrende), Termine und Anlagen anlegen, Termine verschieben, Mitarbeiter zuweisen, ' +
	'den Auftragsstatus und die Quelle ändern, To-dos abhaken, Nachfassen pausieren, Angebotsentwürfe erstellen, Protokolle starten – und sagen, was heute ansteht.';

/** Frage „Was steht heute an?“ beantworten (nur lesend, ohne Bestätigung). */
async function beantworteTagesplan(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, d: TagesplanDaten, jetzt: Date): Promise<Karte> {
	const karte = (titel: string, fehler: string | null, antwort?: Karte['antwort']): Karte => ({
		aktion: 'abfrage_tagesplan',
		titel,
		zeilen: [],
		auswahl: [],
		warnungen: [],
		fehler,
		aendern: null,
		...(antwort ? { antwort } : {})
	});
	const p = await personAufloesen(k, nutzer, d.wer);
	const z = zeitraumTage(d.zeitraum, berlinTag(jetzt), d.datum);
	if (p.kolonne) {
		try {
			const plan = await kolonnenplan(k, nutzer, p.kolonne, z);
			return karte(`Tagesplan ${z.text} – ${p.kolonne.name}`, null, { abschnitte: [{ titel: 'Termine', eintraege: plan.termine }], vorlesen: plan.text });
		} catch (e) {
			if (e instanceof ApiFehler && e.status === 403) return karte('Tagesplan', e.message);
			throw e;
		}
	}
	if (!p.id) return karte('Tagesplan', p.frage);
	try {
		const plan = await tagesplan(k, nutzer, p.id, z, { nurUeberfaellig: d.nur_ueberfaellig, jetzt });
		const abschnitte = d.nur_ueberfaellig
			? [{ titel: 'Überfällige To-dos', eintraege: [...plan.todos, ...plan.nachfassen] }]
			: [
					{ titel: 'Termine', eintraege: plan.termine },
					{ titel: 'To-dos', eintraege: plan.todos },
					{ titel: 'Nachfassen', eintraege: plan.nachfassen }
				].filter((a) => a.titel !== 'Nachfassen' || a.eintraege.length > 0);
		const wer = p.id === nutzer.id ? '' : ` – ${plan.person.name}`;
		return karte(d.nur_ueberfaellig ? `Überfällig${wer}` : `Tagesplan ${z.text}${wer}`, null, { abschnitte, vorlesen: plan.text });
	} catch (e) {
		if (e instanceof ApiFehler && (e.status === 403 || e.status === 404)) return karte('Tagesplan', e.message);
		throw e;
	}
}

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
	// Fragen: sofort beantworten, kein Vorschlag, keine Bestätigung (Wunsch Jamil msg 2647)
	if (aktion.aktion === 'abfrage_tagesplan') {
		return { text, vorschlag: null, karte: await beantworteTagesplan(k, nutzer, aktion.daten, jetzt) };
	}
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
	// Baustellen-Protokoll (feste Typen) braucht „Protokolle bearbeiten“; eine Vorlage starten reicht „ausfüllen“
	if (aktion.aktion === 'protokoll_ausfuellen' && !vorschau.werte.formular) {
		const fehltRecht = await rechteHinweis(locals, aktion.aktion, { formular: false });
		if (fehltRecht) return { text, vorschlag: null, karte: { ...vorschau.karte, fehler: fehltRecht } };
	}
	const vorschlag =
		vorschau.fehlt.length > 0
			? null
			: signiere({ aktion: vorschau.aktion, werte: vorschau.werte, auswahl: vorschau.auswahl }, nutzer.id, k.betriebId);
	return { text, vorschlag, karte: vorschau.karte };
}
