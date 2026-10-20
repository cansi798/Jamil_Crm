import { ApiFehler } from '../fehler';
import { ENTWURF_WERKZEUG, pruefeAktion, pruefeEntwurf, werkzeuge, type KiAktion, type KiEntwurf } from '../sprache/aktionen';
import type { EntwurfEingabe, KiAnbieter, KiKontext } from './anbieter';

/**
 * Mistral AI (EU) über die Chat-Completions-API mit Function Calling (`tools` + `tool_choice: "any"` → genau ein
 * Werkzeugaufruf). Kein SDK, nur `fetch`. Zeitlimit 20 s je Versuch, genau eine Wiederholung bei 429/5xx. Die
 * Antwort wird streng gegen das Aktions-Schema geprüft (sonst 502). Der Schlüssel kommt nur aus der Umgebung
 * (`CRM_MISTRAL_KEY`), steht in keinem Feld, das serialisiert wird, und nie in Meldungen oder Logs.
 */

export type MistralOptionen = {
	schluessel: string;
	/** Basis-Adresse (Tests: lokaler Server). Standard https://api.mistral.ai */
	url?: string;
	modell?: string;
	/** Modell mit Bildverständnis für Fotos im Angebotsentwurf. */
	fotoModell?: string;
	timeoutMs?: number;
	/** Pause vor der Wiederholung. */
	wartezeitMs?: number;
};

const NICHT_ERREICHBAR = 'Die KI ist gerade nicht erreichbar – bitte gleich noch einmal.';
const UNGUELTIG = 'Die KI-Antwort war ungültig – bitte noch einmal.';

function systemAktion(k: KiKontext): string {
	return [
		'Du übersetzt gesprochene Befehle aus einem Handwerksbetrieb in genau eine Aktion (Werkzeugaufruf).',
		`Heute ist ${k.wochentag}, der ${k.heute} (Europe/Berlin).`,
		'Regeln:',
		'- Übernimm Namen von Kunden und Mitarbeitern genau wie gesprochen; erfinde nichts und ergänze keine Daten.',
		'- Zeitangaben nicht umrechnen: heute/morgen/übermorgen als tag; Wochentage als tag=wochentag mit wochentag (klein, z. B. montag);',
		'  nur ein ausdrücklich genanntes Datum als tag=datum mit datum JJJJ-MM-TT. Uhrzeiten als HH:MM (24 h), „halb neun“ = 08:30.',
		'- „Termin“ und „Einsatz“ bedeuten einsatz_anlegen; „verschieben/verlegen“ bedeutet einsatz_verschieben (nach = neue Zeit;',
		'  wird nur eine neue Uhrzeit genannt, gilt der Tag des bisherigen Termins).',
		'- Bei „erinnere mich“ ist zustaendig „mich“.',
		'- „Protokoll X (für Auftrag Y) starten/öffnen/beginnen“ bedeutet protokoll_ausfuellen mit vorlage = X (z. B. Abdichtung) und',
		'  auftrag.name = Y bzw. auftrag.nummer bei einer Nummer wie A-2026-0001.',
		'- „jede Woche/wöchentlich/alle 2 Wochen/monatlich/jährlich“ bei einem To-do: todo_anlegen mit wiederholung (und intervall).',
		'- „Weise Ali dem Auftrag Müller zu“ / „Ali und Murat zum Auftrag Müller“: mitarbeiter_zuweisen.',
		'- „Auftrag Müller auf In Arbeit setzen“ / „Auftrag Müller weiter“: status_aendern (status=weiter für den nächsten Schritt).',
		'- „Hake das To-do X ab“ / „X ist erledigt“: todo_abhaken.',
		'- „Neue Wärmepumpe/Anlage bei Müller, Hersteller …, Wartung jährlich“: anlage_anlegen (typ: waermepumpe, solar, heizung, klima, lueftung, wallbox, gasspeicher, sonstige).',
		'- „Nachfassen für Angebot … pausieren/fortsetzen“: nachfassen_pausieren.',
		'- Quelle (woher der Auftrag kam: „über Hornbach“, „kam über eine Empfehlung“) bei auftrag_anlegen als quelle; nachträglich quelle_setzen.',
		'- Kolonnen („Kolonne A“) stehen bei mitarbeiter wie ein Name, auch bei mitarbeiter_zuweisen und als wer bei abfrage_tagesplan.',
		'- Mehrtägige Termine („von Montag bis Mittwoch“, „bis Freitag“): einsatz_anlegen mit start (erster Tag) und bis (letzter Tag).',
		'- „Route für heute“, „Zeig mir die Route von Ali“, „Route für Kolonne A“: route_heute (wer leer = ich).',
		'- „Wie ist die Auslastung?“, „Wie ausgelastet ist Murat nächsten Monat?“: abfrage_auslastung (wer leer = alle; monat dieser|letzter|naechster).',
		'- „Wie viel Gewinn haben wir diesen Monat verplant?“, „Break-even erreicht?“: abfrage_monatsgewinn (monat dieser|letzter|naechster).',
		'- Fragen wie „Was steht heute für mich an?“, „Was hat Sabine morgen?“, „Was habe ich diese Woche?“, „Welche To-dos sind überfällig?“:',
		'  abfrage_tagesplan (wer leer = ich; zeitraum heute|morgen|woche|datum; nur_ueberfaellig=true bei überfällig).',
		'- Wenn keine Aktion passt (andere Fragen, Rechnungen, Löschen, …), rufe unbekannt auf.'
	].join('\n');
}

function systemEntwurf(katalog: EntwurfEingabe['katalog']): string {
	const zeilen = katalog.map((p) => `${p.schluessel} | ${p.bezeichnung} | ${p.einheit} | ${p.gewerk ?? '-'}`);
	return [
		'Du erstellst einen Angebotsentwurf für einen Handwerksbetrieb.',
		'Wähle ausschließlich Positionen aus diesem Leistungskatalog (Schlüssel | Bezeichnung | Einheit | Gewerk):',
		...zeilen,
		'Gib je Position den Schlüssel und die Menge in der Einheit der Position an. Nenne keine Beträge.',
		'Setze unsicher=true, wenn Position oder Menge nicht ausdrücklich genannt, sondern geschätzt ist.',
		'Passt nichts aus dem Katalog, gib eine leere Liste zurück.'
	].join('\n');
}

export class MistralKi implements KiAnbieter {
	readonly name = 'mistral' as const;
	readonly modell: string;
	readonly fotoModell: string;
	readonly timeoutMs: number;
	readonly #url: string;
	readonly #schluessel: string;
	readonly #wartezeitMs: number;

	constructor(o: MistralOptionen) {
		if (!o.schluessel || o.schluessel.trim() === '') throw new Error('MistralKi: Schlüssel fehlt');
		this.#schluessel = o.schluessel.trim();
		this.#url = (o.url ?? 'https://api.mistral.ai').replace(/\/+$/, '');
		this.modell = o.modell ?? 'mistral-small-latest';
		this.fotoModell = o.fotoModell ?? 'pixtral-12b-latest';
		this.timeoutMs = o.timeoutMs ?? 20_000;
		this.#wartezeitMs = o.wartezeitMs ?? 800;
	}

	/** Nie den Schlüssel ausgeben (auch nicht über JSON.stringify/console.log des Objekts). */
	toJSON() {
		return { name: this.name, modell: this.modell };
	}

	async #anfrage(koerper: Record<string, unknown>): Promise<Record<string, any>> {
		for (let versuch = 1; versuch <= 2; versuch++) {
			let antwort: Response;
			try {
				antwort = await fetch(`${this.#url}/v1/chat/completions`, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${this.#schluessel}`,
						'content-type': 'application/json',
						accept: 'application/json'
					},
					body: JSON.stringify(koerper),
					signal: AbortSignal.timeout(this.timeoutMs)
				});
			} catch (e) {
				// Zeitüberschreitung oder Netzfehler: keine Wiederholung (sonst bis zu 40 s Wartezeit)
				console.warn(`Mistral: Anfrage fehlgeschlagen (${(e as Error)?.name ?? 'Fehler'})`);
				throw new ApiFehler(503, NICHT_ERREICHBAR);
			}
			if (antwort.ok) {
				try {
					return (await antwort.json()) as Record<string, any>;
				} catch {
					throw new ApiFehler(502, UNGUELTIG);
				}
			}
			await antwort.body?.cancel().catch(() => {});
			const wiederholbar = antwort.status === 429 || antwort.status >= 500;
			console.warn(`Mistral: HTTP ${antwort.status}${wiederholbar && versuch === 1 ? ' – Wiederholung' : ''}`);
			if (!wiederholbar || versuch === 2) break;
			await new Promise((ok) => setTimeout(ok, this.#wartezeitMs));
		}
		throw new ApiFehler(503, NICHT_ERREICHBAR);
	}

	/** Genau ein Werkzeugaufruf aus der Antwort: Name + geparste Argumente (sonst 502). */
	static #werkzeugAufruf(antwort: Record<string, any>): { name: string; args: unknown } {
		const aufrufe = antwort?.choices?.[0]?.message?.tool_calls;
		if (!Array.isArray(aufrufe) || aufrufe.length < 1) throw new ApiFehler(502, UNGUELTIG);
		const f = aufrufe[0]?.function;
		if (!f || typeof f.name !== 'string') throw new ApiFehler(502, UNGUELTIG);
		let args: unknown = f.arguments;
		if (typeof args === 'string') {
			try {
				args = JSON.parse(args);
			} catch {
				throw new ApiFehler(502, UNGUELTIG);
			}
		}
		return { name: f.name, args };
	}

	async aktionAusText(text: string, kontext: KiKontext): Promise<KiAktion> {
		const antwort = await this.#anfrage({
			model: this.modell,
			temperature: 0,
			messages: [
				{ role: 'system', content: systemAktion(kontext) },
				{ role: 'user', content: text }
			],
			tools: werkzeuge(),
			tool_choice: 'any',
			parallel_tool_calls: false
		});
		const { name, args } = MistralKi.#werkzeugAufruf(antwort);
		try {
			return pruefeAktion({ aktion: name, daten: args });
		} catch {
			throw new ApiFehler(502, UNGUELTIG);
		}
	}

	async angebotsEntwurf(e: EntwurfEingabe): Promise<KiEntwurf> {
		const nutzer = e.foto
			? [
					{ type: 'text', text: e.text || 'Leistungen laut Foto' },
					{ type: 'image_url', image_url: `data:${e.foto.typ};base64,${Buffer.from(e.foto.bytes).toString('base64')}` }
				]
			: e.text;
		const antwort = await this.#anfrage({
			model: e.foto ? this.fotoModell : this.modell,
			temperature: 0,
			messages: [
				{ role: 'system', content: systemEntwurf(e.katalog) },
				{ role: 'user', content: nutzer }
			],
			tools: [ENTWURF_WERKZEUG],
			tool_choice: 'any',
			parallel_tool_calls: false
		});
		const { name, args } = MistralKi.#werkzeugAufruf(antwort);
		if (name !== ENTWURF_WERKZEUG.function.name) throw new ApiFehler(502, UNGUELTIG);
		try {
			return pruefeEntwurf(args);
		} catch {
			throw new ApiFehler(502, UNGUELTIG);
		}
	}
}
