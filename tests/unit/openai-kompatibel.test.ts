import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiKompatibelKi, jsonAusText } from '../../src/lib/server/ki/openai-kompatibel';
import { waehleAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { MistralKi } from '../../src/lib/server/ki/mistral';

/** fetch wird ersetzt – kein Internet im Test. Jede Anfrage nimmt die nächste vorbereitete Antwort. */
const SCHLUESSEL = 'geheim-mimo-test-0123456789';
const URL_BASIS = 'https://ki.beispiel.test/v1';
const KONTEXT = { heute: '2026-10-17', wochentag: 'Samstag' };

type Vorbereitet = { status?: number; koerper?: unknown; fehler?: Error };
let antworten: Vorbereitet[] = [];
let anfragen: { url: string; init: RequestInit; koerper: any }[] = [];

function antwort(message: Record<string, unknown>, finish_reason = 'stop') {
	return { id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason, message: { role: 'assistant', ...message } }] };
}
const toolAntwort = (name: string, args: unknown) =>
	antwort(
		{
			content: '',
			reasoning_content: 'Der Nutzer möchte …',
			tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }]
		},
		'tool_calls'
	);
const textAntwort = (content: string, finish = 'stop') => antwort({ content, reasoning_content: 'überlege …' }, finish);

beforeEach(() => {
	antworten = [];
	anfragen = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			anfragen.push({ url, init, koerper: JSON.parse(String(init.body)) });
			const a = antworten.shift() ?? { status: 500, koerper: {} };
			if (a.fehler) throw a.fehler;
			return new Response(JSON.stringify(a.koerper ?? {}), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
		})
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const ki = (o: Partial<ConstructorParameters<typeof OpenAiKompatibelKi>[0]> = {}) =>
	new OpenAiKompatibelKi({ url: URL_BASIS, schluessel: SCHLUESSEL, modell: 'mimo-v2.6-pro', wartezeitMs: 1, ...o });

describe('OpenAiKompatibelKi – Aktion aus Text', () => {
	it('tool_calls: richtige Adresse, Kopfzeilen, tool_choice auto, max_tokens, nur Text + Datum', async () => {
		antworten.push({ koerper: toolAntwort('todo_anlegen', { titel: 'Silikonfuge erneuern', zustaendig: 'Murat' }) });
		const a = await ki().aktionAusText('Neues To-do für Murat: Silikonfuge erneuern', KONTEXT);
		expect(a).toEqual({ aktion: 'todo_anlegen', daten: { titel: 'Silikonfuge erneuern', zustaendig: 'Murat' } });
		expect(anfragen).toHaveLength(1);
		const r = anfragen[0];
		expect(r.url).toBe(`${URL_BASIS}/chat/completions`);
		const kopf = r.init.headers as Record<string, string>;
		expect(kopf.authorization).toBe(`Bearer ${SCHLUESSEL}`);
		expect(r.koerper.model).toBe('mimo-v2.6-pro');
		expect(r.koerper.tool_choice).toBe('auto');
		expect(r.koerper.max_tokens).toBeGreaterThanOrEqual(2048);
		expect(r.koerper.temperature).toBe(0);
		expect(r.koerper.thinking).toBeUndefined();
		expect(r.koerper.tools.map((t: any) => t.function.name)).toContain('abfrage_tagesplan');
		expect(r.koerper.messages[0].role).toBe('system');
		expect(r.koerper.messages[0].content).toContain('2026-10-17');
		expect(r.koerper.messages[0].content).toContain('genau EIN Werkzeug');
		expect(r.koerper.messages.at(-1)).toEqual({ role: 'user', content: 'Neues To-do für Murat: Silikonfuge erneuern' });
		expect(r.init.signal).toBeInstanceOf(AbortSignal);
	});

	it('Adresse mit /chat/completions am Ende wird nicht doppelt angehängt', async () => {
		antworten.push({ koerper: toolAntwort('unbekannt', {}) });
		await ki({ url: `${URL_BASIS}/chat/completions/` }).aktionAusText('x', KONTEXT);
		expect(anfragen[0].url).toBe(`${URL_BASIS}/chat/completions`);
	});

	it('schnelles Modell für Sprachbefehle, ohneNachdenken schickt thinking disabled', async () => {
		antworten.push({ koerper: toolAntwort('abfrage_tagesplan', { zeitraum: 'heute' }) });
		const a = await ki({ modellSchnell: 'mimo-v2.6-flash', ohneNachdenken: true }).aktionAusText('Was steht heute an?', KONTEXT);
		expect(a).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'heute' } });
		expect(anfragen[0].koerper.model).toBe('mimo-v2.6-flash');
		expect(anfragen[0].koerper.thinking).toEqual({ type: 'disabled' });
	});

	it('Fallback: JSON im Antworttext (auch in ```json```) statt Werkzeugaufruf', async () => {
		antworten.push({ koerper: textAntwort('Hier die Aktion:\n```json\n{"aktion": "todo_anlegen", "daten": {"titel": "Fliesen bestellen"}}\n```') });
		expect(await ki().aktionAusText('To-do Fliesen bestellen', KONTEXT)).toEqual({ aktion: 'todo_anlegen', daten: { titel: 'Fliesen bestellen' } });
		antworten.push({ koerper: textAntwort('<think>hm {kein json}</think>{"name": "abfrage_tagesplan", "arguments": "{\\"zeitraum\\": \\"morgen\\"}"}') });
		expect(await ki().aktionAusText('Was ist morgen?', KONTEXT)).toEqual({ aktion: 'abfrage_tagesplan', daten: { zeitraum: 'morgen' } });
		expect(anfragen).toHaveLength(2);
	});

	it('ungültige Antwort → genau ein zweiter Versuch (Hauptmodell, mit Hinweis) → Erfolg', async () => {
		antworten.push(
			{ koerper: toolAntwort('todo_anlegen', { titel: 'x', preis: 3 }) },
			{ koerper: toolAntwort('todo_anlegen', { titel: 'x' }) }
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const a = await ki({ modellSchnell: 'mimo-v2.6-flash' }).aktionAusText('To-do x', KONTEXT);
			expect(a).toEqual({ aktion: 'todo_anlegen', daten: { titel: 'x' } });
		} finally {
			warn.mockRestore();
		}
		expect(anfragen).toHaveLength(2);
		expect(anfragen[0].koerper.model).toBe('mimo-v2.6-flash');
		expect(anfragen[1].koerper.model).toBe('mimo-v2.6-pro');
		const letzte = anfragen[1].koerper.messages.at(-1);
		expect(letzte.role).toBe('user');
		expect(letzte.content).toContain('ungültig');
		expect(anfragen[1].koerper.messages.some((m: any) => m.role === 'assistant')).toBe(true);
	});

	it('ungültig → Wiederholung → wieder ungültig → 502 (fremde Aktion, leere Antwort mit finish_reason=length, Prosa)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			antworten.push({ koerper: toolAntwort('rechnung_schreiben', {}) }, { koerper: textAntwort('', 'length') });
			await expect(ki().aktionAusText('Schreib eine Rechnung', KONTEXT)).rejects.toMatchObject({ status: 502 });
			expect(anfragen).toHaveLength(2);
			anfragen = [];
			antworten.push({ koerper: textAntwort('Das kann ich leider nicht.') }, { koerper: textAntwort('Wirklich nicht.') });
			await expect(ki().aktionAusText('x', KONTEXT)).rejects.toMatchObject({ status: 502 });
			expect(anfragen).toHaveLength(2);
			const kaputt = toolAntwort('todo_anlegen', {});
			(kaputt.choices[0].message as any).tool_calls[0].function.arguments = '{titel:';
			anfragen = [];
			antworten.push({ koerper: kaputt }, { koerper: kaputt });
			await expect(ki().aktionAusText('x', KONTEXT)).rejects.toMatchObject({ status: 502 });
			expect(anfragen).toHaveLength(2);
		} finally {
			warn.mockRestore();
		}
	});

	it('HTTP 429/5xx: eine Wiederholung, dann 503; 401 ohne Wiederholung; Netz/Timeout → 503', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			antworten.push({ status: 429 }, { koerper: toolAntwort('unbekannt', {}) });
			expect((await ki().aktionAusText('x', KONTEXT)).aktion).toBe('unbekannt');
			expect(anfragen).toHaveLength(2);
			anfragen = [];
			antworten.push({ status: 502 }, { status: 503 });
			await expect(ki().aktionAusText('x', KONTEXT)).rejects.toMatchObject({ status: 503 });
			expect(anfragen).toHaveLength(2);
			anfragen = [];
			antworten.push({ status: 401, koerper: { error: `bad key ${SCHLUESSEL}` } });
			const f = await ki().aktionAusText('x', KONTEXT).catch((e) => e);
			expect(f).toMatchObject({ status: 503 });
			expect(anfragen).toHaveLength(1);
			expect(JSON.stringify(f) + String(f.message)).not.toContain(SCHLUESSEL);
			antworten.push({ fehler: new DOMException('zu langsam', 'TimeoutError') });
			await expect(ki().aktionAusText('x', KONTEXT)).rejects.toMatchObject({ status: 503 });
			const logs = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
			expect(logs).not.toContain(SCHLUESSEL);
		} finally {
			warn.mockRestore();
		}
	});

	it('Schlüssel nie in JSON des Objekts; Standard-Timeout 30 s (Entwurf 90 s)', () => {
		const k = ki();
		expect(JSON.stringify(k)).not.toContain(SCHLUESSEL);
		expect(k.timeoutMs).toBe(30_000);
		expect(k.entwurfTimeoutMs).toBe(90_000);
	});

	it('Zeitlimit beim Lesen der Antwort → 503 (nicht „ungültig“), ohne zweiten Versuch', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				anfragen.push({ url: '', init: {}, koerper: null });
				return { ok: true, status: 200, json: async () => Promise.reject(new DOMException('zu langsam', 'TimeoutError')) } as unknown as Response;
			})
		);
		try {
			await expect(ki().aktionAusText('x', KONTEXT)).rejects.toMatchObject({ status: 503 });
			expect(anfragen).toHaveLength(1);
		} finally {
			warn.mockRestore();
		}
	});
});

describe('OpenAiKompatibelKi – Angebotsentwurf', () => {
	const katalog = [
		{ schluessel: 'K1', bezeichnung: 'Wandfliesen verlegen', einheit: 'm²', gewerk: 'fliesen' },
		{ schluessel: 'K2', bezeichnung: 'Silikonfuge', einheit: 'lfm', gewerk: 'fliesen' }
	];

	it('Katalog ohne Preise, Werkzeug angebot_positionen, Hauptmodell', async () => {
		antworten.push({ koerper: toolAntwort('angebot_positionen', { positionen: [{ schluessel: 'K1', menge: 12, unsicher: false }] }) });
		const e = await ki({ modellSchnell: 'mimo-v2.6-flash' }).angebotsEntwurf({ text: '12 m² Wandfliesen', katalog });
		expect(e).toEqual({ positionen: [{ schluessel: 'K1', menge: 12, unsicher: false }] });
		const r = anfragen[0].koerper;
		expect(r.model).toBe('mimo-v2.6-pro');
		expect(r.tools.map((t: any) => t.function.name)).toEqual(['angebot_positionen']);
		const alles = JSON.stringify(r);
		expect(alles).toContain('Wandfliesen verlegen');
		expect(alles).not.toMatch(/cent|preis\b|€/i);
	});

	it('ohneNachdenken=entwurf: thinking disabled nur beim Entwurf, nicht beim Sprachbefehl', async () => {
		antworten.push({ koerper: toolAntwort('angebot_positionen', { positionen: [] }) }, { koerper: toolAntwort('unbekannt', {}) });
		const k = ki({ ohneNachdenken: 'entwurf' });
		await k.angebotsEntwurf({ text: 'Fliesen', katalog });
		await k.aktionAusText('x', KONTEXT);
		expect(anfragen[0].koerper.thinking).toEqual({ type: 'disabled' });
		expect(anfragen[1].koerper.thinking).toBeUndefined();
	});

	it('Foto als image_url-Data-URI (OpenAI-Format) an das Foto-Modell', async () => {
		antworten.push({ koerper: toolAntwort('angebot_positionen', { positionen: [] }) });
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		await ki({ fotoModell: 'mimo-v2.6-flash' }).angebotsEntwurf({ text: '', katalog, foto: { bytes, typ: 'image/png' } });
		const r = anfragen[0].koerper;
		expect(r.model).toBe('mimo-v2.6-flash');
		const inhalt = r.messages.at(-1).content;
		expect(inhalt).toEqual([
			{ type: 'text', text: 'Leistungen laut Foto' },
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` } }
		]);
	});

	it('JSON-Fallback ohne Werkzeug: {"positionen": …} direkt im Text; ungültig zweimal → 502', async () => {
		antworten.push({ koerper: textAntwort('{"positionen": [{"schluessel": "K2", "menge": 4, "unsicher": true}]}') });
		expect(await ki().angebotsEntwurf({ text: 'Silikon', katalog })).toEqual({ positionen: [{ schluessel: 'K2', menge: 4, unsicher: true }] });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			antworten.push({ koerper: toolAntwort('angebot_positionen', { liste: [] }) }, { koerper: textAntwort('') });
			await expect(ki().angebotsEntwurf({ text: 'x', katalog })).rejects.toMatchObject({ status: 502 });
		} finally {
			warn.mockRestore();
		}
	});
});

describe('jsonAusText', () => {
	it('findet das erste vollständige Objekt, auch mit Klammern in Strings', () => {
		expect(jsonAusText('vorher {"a": "x}y", "b": {"c": 1}} nachher {"d": 2}')).toEqual({ a: 'x}y', b: { c: 1 } });
		expect(jsonAusText('kein json')).toBeUndefined();
	});
});

describe('Auswahl openai-kompatibel', () => {
	it('braucht URL, Schlüssel und Modell; sonst FakeKi; Mistral bleibt', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(waehleAnbieter({ CRM_KI_ANBIETER: 'openai-kompatibel', CRM_KI_URL: URL_BASIS, CRM_KI_KEY: 'k' })).toBeInstanceOf(FakeKi);
			expect(waehleAnbieter({ CRM_KI_ANBIETER: 'openai-kompatibel', CRM_KI_KEY: 'k', CRM_KI_MODELL: 'm' })).toBeInstanceOf(FakeKi);
		} finally {
			warn.mockRestore();
		}
		const o = waehleAnbieter({
			CRM_KI_ANBIETER: 'openai-kompatibel',
			CRM_KI_URL: URL_BASIS,
			CRM_KI_KEY: 'k',
			CRM_KI_MODELL: 'mimo-v2.6-pro',
			CRM_KI_MODELL_SCHNELL: 'mimo-v2.6-flash',
			CRM_KI_MODELL_FOTO: 'pixtral-12b-latest',
			CRM_KI_OHNE_NACHDENKEN: 'ja'
		}) as OpenAiKompatibelKi;
		expect(o).toBeInstanceOf(OpenAiKompatibelKi);
		expect(o.name).toBe('openai-kompatibel');
		expect(o.modellSchnell).toBe('mimo-v2.6-flash');
		expect(o.fotoModell).toBe('mimo-v2.6-pro'); // alte Mistral-Vorgabe wird ignoriert
		expect(o.ohneNachdenken).toBe(true);
		const e = waehleAnbieter({ CRM_KI_ANBIETER: 'openai-kompatibel', CRM_KI_URL: URL_BASIS, CRM_KI_KEY: 'k', CRM_KI_MODELL: 'm', CRM_KI_OHNE_NACHDENKEN: 'Entwurf' }) as OpenAiKompatibelKi;
		expect(e.ohneNachdenken).toBe('entwurf');
		const m = waehleAnbieter({ CRM_KI_ANBIETER: 'mistral', CRM_MISTRAL_KEY: 'abc', CRM_KI_MODELL: '' }) as MistralKi;
		expect(m).toBeInstanceOf(MistralKi);
		expect(m.modell).toBe('mistral-small-latest');
		expect(m.fotoModell).toBe('pixtral-12b-latest');
	});
});
