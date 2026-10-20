import { ApiFehler } from '../fehler';
import {
	ENTWURF_WERKZEUG,
	pruefeAktion,
	pruefeEntwurf,
	werkzeuge,
	type KiAktion,
	type KiEntwurf
} from '../sprache/aktionen';
import type { BildAnfrage, EntwurfEingabe, KiAnbieter, KiKontext } from './anbieter';
import { systemAktion, systemEntwurf } from './anweisungen';

/**
 * KI über eine OpenAI-kompatible Chat-Completions-API (z. B. Xiaomi MiMo, mittwald AI Hosting, vLLM, Ollama).
 * Kein SDK, nur `fetch` auf `<CRM_KI_URL>/chat/completions`.
 *
 * Robust gegen „denkende“ Modelle und Anbieter ohne erzwungenen Werkzeugaufruf:
 * - `tool_choice: "auto"` plus klare Anweisung, genau ein Werkzeug aufzurufen,
 * - kommt kein Werkzeugaufruf, wird JSON aus dem Antworttext gelesen (`{"aktion": …, "daten": …}`, auch in ```json```),
 * - Antwort wird streng gegen das Aktions-Schema geprüft; ist sie ungültig (oder leer, z. B. `finish_reason=length`),
 *   gibt es genau eine zweite Anfrage mit Hinweis auf den Fehler (dann mit dem Hauptmodell) – danach 502,
 * - `max_tokens` großzügig (Nachdenken verbraucht Tokens), Zeitlimit je Anfrage (Sprachbefehl 30 s, Angebotsentwurf
 *   90 s – mit Foto denkt das Modell deutlich länger), eine Wiederholung bei 429/5xx.
 *
 * Datensparsamkeit wie bei Mistral (siehe anbieter.ts): nur Befehlstext, Datum, Schema, ggf. Katalog ohne Preise und
 * Foto. Der Schlüssel steht in keinem serialisierten Feld und nie in Meldungen oder Logs.
 */

export type OpenAiKompatibelOptionen = {
	/** Basis-Adresse inkl. Versionspfad, z. B. https://token-plan-ams.xiaomimimo.com/v1 */
	url: string;
	schluessel: string;
	/** Hauptmodell (Angebotsentwurf, Fotos, zweiter Versuch). */
	modell: string;
	/** Optional: schnelles Modell für Sprachbefehle (Aktion aus Text). */
	modellSchnell?: string;
	/** Optional: eigenes Modell für Fotos (Standard: Hauptmodell). */
	fotoModell?: string;
	/**
	 * `thinking: {type: "disabled"}` mitschicken (MiMo: schneller, kaum Einbußen beim Entwurf). true = immer,
	 * 'entwurf' = nur beim Angebotsentwurf (dort dauert Nachdenken 10–60 s), false = nie. Nur für Anbieter, die das
	 * Feld kennen.
	 */
	ohneNachdenken?: boolean | 'entwurf';
	/** Zeitlimit je Anfrage für Sprachbefehle (Standard 30 s). */
	timeoutMs?: number;
	/** Zeitlimit je Anfrage für Angebotsentwürfe (Standard 90 s). */
	entwurfTimeoutMs?: number;
	/** Token-Obergrenze für Sprachbefehle (Standard 4096) bzw. Entwürfe (doppelt). */
	maxTokens?: number;
	/** Pause vor der Wiederholung bei 429/5xx. */
	wartezeitMs?: number;
};

const NICHT_ERREICHBAR = 'Die KI ist gerade nicht erreichbar – bitte gleich noch einmal.';
const UNGUELTIG = 'Die KI-Antwort war ungültig – bitte noch einmal.';

const HINWEIS_WERKZEUG = [
	'',
	'Antwortformat: Rufe genau EIN Werkzeug auf (Function Calling) und schreibe keinen weiteren Text.',
	'Falls du kein Werkzeug aufrufen kannst, antworte ausschließlich mit JSON in der Form',
	'{"aktion": "<werkzeugname>", "daten": { …Parameter des Werkzeugs… }} – ohne Erklärung.'
].join('\n');

const HINWEIS_ENTWURF = [
	'',
	'Antwortformat: Rufe genau einmal das Werkzeug angebot_positionen auf und schreibe keinen weiteren Text.',
	'Falls du kein Werkzeug aufrufen kannst, antworte ausschließlich mit JSON in der Form',
	'{"positionen": [{"schluessel": "K1", "menge": 1, "unsicher": false}]} – ohne Erklärung.'
].join('\n');

/** Ungültige KI-Antwort (wird einmal wiederholt, dann 502). Grund nur für den Wiederholungs-Hinweis an die KI. */
class UngueltigeAntwort extends Error {}

type Nachricht = { role: 'system' | 'user' | 'assistant'; content: unknown };

/** Erstes vollständiges JSON-Objekt aus einem Text (auch in ```json … ```), sonst `undefined`. */
export function jsonAusText(text: string): unknown {
	const ohneDenken = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
	const kandidaten: string[] = [];
	for (const m of ohneDenken.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) kandidaten.push(m[1]);
	kandidaten.push(ohneDenken);
	for (const k of kandidaten) {
		const start = k.indexOf('{');
		if (start < 0) continue;
		let tiefe = 0;
		let inString = false;
		let escape = false;
		for (let i = start; i < k.length; i++) {
			const c = k[i];
			if (inString) {
				if (escape) escape = false;
				else if (c === '\\') escape = true;
				else if (c === '"') inString = false;
			} else if (c === '"') inString = true;
			else if (c === '{') tiefe++;
			else if (c === '}' && --tiefe === 0) {
				try {
					return JSON.parse(k.slice(start, i + 1));
				} catch {
					break;
				}
			}
		}
	}
	return undefined;
}

/** Werkzeugaufruf (Name + Argumente) aus der Antwort – zuerst `tool_calls`, sonst JSON im Text. */
function werkzeugAusAntwort(antwort: Record<string, any>, standardName?: string): { name: string; args: unknown } {
	const wahl = antwort?.choices?.[0];
	const msg = wahl?.message;
	const aufrufe = msg?.tool_calls;
	if (Array.isArray(aufrufe) && aufrufe.length > 0) {
		const f = aufrufe[0]?.function;
		if (!f || typeof f.name !== 'string') throw new UngueltigeAntwort('Werkzeugaufruf ohne Namen');
		let args: unknown = f.arguments ?? {};
		if (typeof args === 'string') {
			try {
				args = args.trim() === '' ? {} : JSON.parse(args);
			} catch {
				throw new UngueltigeAntwort('Argumente sind kein gültiges JSON');
			}
		}
		return { name: f.name, args };
	}
	const text = typeof msg?.content === 'string' ? msg.content : '';
	if (text.trim() === '') {
		throw new UngueltigeAntwort(wahl?.finish_reason === 'length' ? 'Antwort abgeschnitten (zu lang)' : 'leere Antwort');
	}
	const json = jsonAusText(text);
	if (!json || typeof json !== 'object' || Array.isArray(json)) throw new UngueltigeAntwort('kein Werkzeugaufruf und kein JSON');
	const o = json as Record<string, unknown>;
	// {"aktion": name, "daten": {…}}  |  {"name": name, "arguments": {…}}  |  direkt die Argumente (Entwurf)
	if (typeof o.aktion === 'string') return { name: o.aktion, args: o.daten ?? {} };
	if (typeof o.name === 'string' && ('arguments' in o || 'parameters' in o)) {
		let args = o.arguments ?? o.parameters;
		if (typeof args === 'string') {
			try {
				args = JSON.parse(args);
			} catch {
				throw new UngueltigeAntwort('Argumente sind kein gültiges JSON');
			}
		}
		return { name: o.name, args };
	}
	if (standardName) return { name: standardName, args: o };
	throw new UngueltigeAntwort('JSON ohne Feld „aktion“');
}

export class OpenAiKompatibelKi implements KiAnbieter {
	readonly name = 'openai-kompatibel' as const;
	readonly modell: string;
	readonly modellSchnell: string;
	readonly fotoModell: string;
	readonly timeoutMs: number;
	readonly entwurfTimeoutMs: number;
	readonly maxTokens: number;
	readonly ohneNachdenken: boolean | 'entwurf';
	readonly #url: string;
	readonly #schluessel: string;
	readonly #wartezeitMs: number;

	constructor(o: OpenAiKompatibelOptionen) {
		if (!o.schluessel || o.schluessel.trim() === '') throw new Error('OpenAiKompatibelKi: Schlüssel fehlt');
		if (!o.url || o.url.trim() === '') throw new Error('OpenAiKompatibelKi: Adresse fehlt');
		if (!o.modell || o.modell.trim() === '') throw new Error('OpenAiKompatibelKi: Modell fehlt');
		this.#schluessel = o.schluessel.trim();
		this.#url = o.url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
		this.modell = o.modell.trim();
		this.modellSchnell = o.modellSchnell?.trim() || this.modell;
		this.fotoModell = o.fotoModell?.trim() || this.modell;
		this.ohneNachdenken = o.ohneNachdenken === true || o.ohneNachdenken === 'entwurf' ? o.ohneNachdenken : false;
		this.timeoutMs = o.timeoutMs ?? 30_000;
		this.entwurfTimeoutMs = o.entwurfTimeoutMs ?? 90_000;
		this.maxTokens = o.maxTokens ?? 4096;
		this.#wartezeitMs = o.wartezeitMs ?? 800;
	}

	/** Nie den Schlüssel ausgeben (auch nicht über JSON.stringify/console.log des Objekts). */
	toJSON() {
		return { name: this.name, modell: this.modell, modellSchnell: this.modellSchnell };
	}

	async #anfrage(koerper: Record<string, unknown>, timeoutMs: number): Promise<Record<string, any>> {
		for (let versuch = 1; versuch <= 2; versuch++) {
			let antwort: Response;
			try {
				antwort = await fetch(`${this.#url}/chat/completions`, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${this.#schluessel}`,
						'content-type': 'application/json',
						accept: 'application/json'
					},
					body: JSON.stringify(koerper),
					signal: AbortSignal.timeout(timeoutMs)
				});
			} catch (e) {
				// Zeitüberschreitung oder Netzfehler: keine Wiederholung (sonst sehr lange Wartezeit)
				console.warn(`KI (openai-kompatibel): Anfrage fehlgeschlagen (${(e as Error)?.name ?? 'Fehler'})`);
				throw new ApiFehler(503, NICHT_ERREICHBAR);
			}
			if (antwort.ok) {
				try {
					return (await antwort.json()) as Record<string, any>;
				} catch (e) {
					// Zeitlimit beim Lesen der Antwort (Modell denkt zu lange) ist „nicht erreichbar“, kein ungültiges JSON
					const name = (e as Error)?.name;
					if (name === 'TimeoutError' || name === 'AbortError') {
						console.warn('KI (openai-kompatibel): Zeitlimit beim Lesen der Antwort');
						throw new ApiFehler(503, NICHT_ERREICHBAR);
					}
					throw new ApiFehler(502, UNGUELTIG);
				}
			}
			await antwort.body?.cancel().catch(() => {});
			const wiederholbar = antwort.status === 429 || antwort.status >= 500;
			console.warn(`KI (openai-kompatibel): HTTP ${antwort.status}${wiederholbar && versuch === 1 ? ' – Wiederholung' : ''}`);
			if (!wiederholbar || versuch === 2) break;
			await new Promise((ok) => setTimeout(ok, this.#wartezeitMs));
		}
		throw new ApiFehler(503, NICHT_ERREICHBAR);
	}

	/**
	 * Anfrage + Auswertung mit genau einem zweiten Versuch bei ungültiger Antwort. Der zweite Versuch nimmt das
	 * Hauptmodell und bekommt die eigene (ungültige) Antwort samt Grund zurück.
	 */
	async #mitKorrektur<T>(
		art: { modelle: [string, string]; timeoutMs: number; maxTokens: number; ohneNachdenken: boolean },
		nachrichten: Nachricht[],
		tools: unknown[],
		auswerten: (antwort: Record<string, any>) => T
	): Promise<T> {
		let verlauf = nachrichten;
		for (let versuch = 0; versuch < 2; versuch++) {
			const antwort = await this.#anfrage(
				{
					model: art.modelle[versuch],
					temperature: 0,
					max_tokens: art.maxTokens,
					messages: verlauf,
					tools,
					tool_choice: 'auto',
					...(art.ohneNachdenken ? { thinking: { type: 'disabled' } } : {})
				},
				art.timeoutMs
			);
			try {
				return auswerten(antwort);
			} catch (e) {
				const grund = e instanceof UngueltigeAntwort ? e.message : 'passt nicht zum Schema';
				console.warn(`KI (openai-kompatibel): ungültige Antwort (${grund})${versuch === 0 ? ' – zweiter Versuch' : ''}`);
				const msg = antwort?.choices?.[0]?.message;
				const bisher = typeof msg?.content === 'string' && msg.content.trim() !== '' ? msg.content.slice(0, 2000) : '';
				const aufruf = Array.isArray(msg?.tool_calls) ? JSON.stringify(msg.tool_calls[0]?.function ?? {}).slice(0, 2000) : '';
				verlauf = [
					...nachrichten,
					...(bisher || aufruf ? [{ role: 'assistant' as const, content: aufruf ? `Werkzeugaufruf: ${aufruf}` : bisher }] : []),
					{
						role: 'user',
						content: `Deine Antwort war ungültig (${grund}${e instanceof Error && !(e instanceof UngueltigeAntwort) ? `: ${e.message.slice(0, 200)}` : ''}). Rufe jetzt genau ein passendes Werkzeug mit gültigen Parametern auf.`
					}
				];
			}
		}
		throw new ApiFehler(502, UNGUELTIG);
	}

	async aktionAusText(text: string, kontext: KiKontext): Promise<KiAktion> {
		return this.#mitKorrektur(
			{
				modelle: [this.modellSchnell, this.modell],
				timeoutMs: this.timeoutMs,
				maxTokens: this.maxTokens,
				ohneNachdenken: this.ohneNachdenken === true
			},
			[
				{ role: 'system', content: systemAktion(kontext) + HINWEIS_WERKZEUG },
				{ role: 'user', content: text }
			],
			werkzeuge(),
			(antwort) => {
				const { name, args } = werkzeugAusAntwort(antwort);
				return pruefeAktion({ aktion: name, daten: args });
			}
		);
	}

	async angebotsEntwurf(e: EntwurfEingabe): Promise<KiEntwurf> {
		const nutzer = e.foto
			? [
					{ type: 'text', text: e.text || 'Leistungen laut Foto' },
					{
						type: 'image_url',
						image_url: { url: `data:${e.foto.typ};base64,${Buffer.from(e.foto.bytes).toString('base64')}` }
					}
				]
			: e.text;
		const modell = e.foto ? this.fotoModell : this.modell;
		const name = ENTWURF_WERKZEUG.function.name;
		return this.#mitKorrektur(
			{
				modelle: [modell, modell],
				timeoutMs: this.entwurfTimeoutMs,
				maxTokens: this.maxTokens * 2,
				ohneNachdenken: this.ohneNachdenken !== false
			},
			[
				{ role: 'system', content: systemEntwurf(e.katalog) + HINWEIS_ENTWURF },
				{ role: 'user', content: nutzer }
			],
			[ENTWURF_WERKZEUG],
			(antwort) => {
				const w = werkzeugAusAntwort(antwort, name);
				if (w.name !== name) throw new UngueltigeAntwort(`falsches Werkzeug ${w.name.slice(0, 40)}`);
				return pruefeEntwurf(w.args);
			}
		);
	}

	async bildAuswertung<T>(a: BildAnfrage<T>): Promise<T> {
		const name = a.werkzeug.function.name;
		const inhalt = [
			{ type: 'text', text: a.text },
			...a.bilder.map((b) => ({ type: 'image_url', image_url: { url: `data:${b.typ};base64,${Buffer.from(b.bytes).toString('base64')}` } }))
		];
		const hinweis = [
			'',
			`Antwortformat: Rufe genau einmal das Werkzeug ${name} auf und schreibe keinen weiteren Text.`,
			'Falls du kein Werkzeug aufrufen kannst, antworte ausschließlich mit JSON, das genau den Parametern des Werkzeugs entspricht.'
		].join('\n');
		return this.#mitKorrektur(
			{
				modelle: [this.fotoModell, this.fotoModell],
				timeoutMs: this.entwurfTimeoutMs,
				maxTokens: this.maxTokens * 2,
				ohneNachdenken: this.ohneNachdenken !== false
			},
			[
				{ role: 'system', content: a.system + hinweis },
				{ role: 'user', content: inhalt }
			],
			[a.werkzeug],
			(antwort) => {
				const w = werkzeugAusAntwort(antwort, name);
				if (w.name !== name) throw new UngueltigeAntwort(`falsches Werkzeug ${w.name.slice(0, 40)}`);
				return a.pruefe(w.args);
			}
		);
	}
}
