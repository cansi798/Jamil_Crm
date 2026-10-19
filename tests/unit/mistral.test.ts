import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MistralKi } from '../../src/lib/server/ki/mistral';
import { FakeKi } from '../../src/lib/server/ki/fake';
import { waehleAnbieter } from '../../src/lib/server/ki/anbieter';

/** Lokaler Test-Server statt api.mistral.ai (kein Internet im Test). */
type Anfrage = { pfad: string; kopf: IncomingMessage['headers']; koerper: any };
const SCHLUESSEL = 'geheim-test-schluessel-0123456789';

function toolAntwort(name: string, args: unknown) {
	return {
		id: 'x',
		object: 'chat.completion',
		choices: [
			{
				index: 0,
				finish_reason: 'tool_calls',
				message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
			}
		],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
	};
}

describe('MistralKi gegen lokalen Test-Server', () => {
	let server: Server;
	let url: string;
	let anfragen: Anfrage[] = [];
	let antworten: { status: number; koerper: unknown; verzoegerung?: number }[] = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			const teile: Buffer[] = [];
			req.on('data', (d: Buffer) => teile.push(d));
			req.on('end', () => {
				const text = Buffer.concat(teile).toString('utf8');
				anfragen.push({ pfad: req.url ?? '', kopf: req.headers, koerper: text ? JSON.parse(text) : null });
				const a = antworten.shift() ?? { status: 500, koerper: { message: 'keine Antwort vorbereitet' } };
				setTimeout(() => {
					if (res.destroyed) return;
					res.writeHead(a.status, { 'content-type': 'application/json' });
					res.end(JSON.stringify(a.koerper));
				}, a.verzoegerung ?? 0);
			});
		});
		await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
		const adr = server.address();
		if (!adr || typeof adr === 'string') throw new Error('kein Port');
		url = `http://127.0.0.1:${adr.port}`;
	});
	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((ok) => server.close(() => ok()));
	});
	beforeEach(() => {
		anfragen = [];
		antworten = [];
	});

	const ki = (opts: Partial<ConstructorParameters<typeof MistralKi>[0]> = {}) =>
		new MistralKi({ schluessel: SCHLUESSEL, url, timeoutMs: 500, wartezeitMs: 1, ...opts });

	it('schickt Chat-Completions mit Werkzeugen, tool_choice any, richtigen Kopfzeilen und nur Text + Datum', async () => {
		antworten.push({ status: 200, koerper: toolAntwort('todo_anlegen', { titel: 'Silikonfuge erneuern', zustaendig: 'Murat' }) });
		const a = await ki().aktionAusText('Neues To-do für Murat: Silikonfuge erneuern', { heute: '2026-10-17', wochentag: 'Samstag' });
		expect(a).toEqual({ aktion: 'todo_anlegen', daten: { titel: 'Silikonfuge erneuern', zustaendig: 'Murat' } });
		expect(anfragen).toHaveLength(1);
		const r = anfragen[0];
		expect(r.pfad).toBe('/v1/chat/completions');
		expect(r.kopf.authorization).toBe(`Bearer ${SCHLUESSEL}`);
		expect(r.kopf['content-type']).toMatch(/^application\/json/);
		expect(r.kopf.accept).toBe('application/json');
		expect(r.koerper.model).toBe('mistral-small-latest');
		expect(r.koerper.tool_choice).toBe('any');
		expect(r.koerper.temperature).toBe(0);
		expect(r.koerper.tools.map((t: any) => t.function.name)).toContain('auftrag_anlegen');
		expect(r.koerper.messages.at(-1)).toEqual({ role: 'user', content: 'Neues To-do für Murat: Silikonfuge erneuern' });
		expect(r.koerper.messages[0].role).toBe('system');
		expect(r.koerper.messages[0].content).toContain('2026-10-17');
		expect(r.koerper.messages[0].content).toContain('Samstag');
	});

	it('Modell aus CRM_KI_MODELL bzw. Option', async () => {
		antworten.push({ status: 200, koerper: toolAntwort('unbekannt', {}) });
		await ki({ modell: 'mistral-medium-latest' }).aktionAusText('Wie wird das Wetter?', { heute: '2026-10-17', wochentag: 'Samstag' });
		expect(anfragen[0].koerper.model).toBe('mistral-medium-latest');
	});

	it('wiederholt genau einmal bei 429 und 5xx', async () => {
		antworten.push({ status: 429, koerper: { message: 'rate limit' } }, { status: 200, koerper: toolAntwort('unbekannt', {}) });
		expect((await ki().aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' })).aktion).toBe('unbekannt');
		expect(anfragen).toHaveLength(2);
		anfragen = [];
		antworten.push({ status: 502, koerper: {} }, { status: 503, koerper: {} }, { status: 200, koerper: toolAntwort('unbekannt', {}) });
		await expect(ki().aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' })).rejects.toMatchObject({ status: 503 });
		expect(anfragen).toHaveLength(2);
	});

	it('keine Wiederholung bei 400/401', async () => {
		antworten.push({ status: 401, koerper: { message: `Unauthorized: key ${SCHLUESSEL}` } });
		await expect(ki().aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' })).rejects.toMatchObject({ status: 503 });
		expect(anfragen).toHaveLength(1);
	});

	it('Zeitüberschreitung (Timeout) → 503, auch nach der Wiederholung', async () => {
		antworten.push({ status: 200, koerper: toolAntwort('unbekannt', {}), verzoegerung: 2000 }, { status: 200, koerper: toolAntwort('unbekannt', {}), verzoegerung: 2000 });
		const start = Date.now();
		await expect(ki({ timeoutMs: 200 }).aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' })).rejects.toMatchObject({ status: 503 });
		expect(Date.now() - start).toBeLessThan(1500);
	});

	it('Standard-Timeout ist 20 s', () => {
		expect(new MistralKi({ schluessel: SCHLUESSEL }).timeoutMs).toBe(20_000);
	});

	it('Schlüssel steht nie in Fehlermeldungen oder Logs', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			antworten.push({ status: 401, koerper: { message: `bad key ${SCHLUESSEL}` } });
			const fehler = await ki().aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' }).catch((e) => e);
			expect(String(fehler.message)).not.toContain(SCHLUESSEL);
			expect(JSON.stringify(fehler)).not.toContain(SCHLUESSEL);
			antworten.push({ status: 200, koerper: { kaputt: SCHLUESSEL } });
			const fehler2 = await ki().aktionAusText('x', { heute: '2026-10-17', wochentag: 'Samstag' }).catch((e) => e);
			expect(String(fehler2.message)).not.toContain(SCHLUESSEL);
			const alles = [...log.mock.calls, ...warn.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
			expect(alles).not.toContain(SCHLUESSEL);
		} finally {
			log.mockRestore();
			warn.mockRestore();
		}
	});

	it('Antwort wird strikt gegen das Schema geprüft (Zusatzfeld, fremde Aktion, kaputtes JSON, kein Werkzeugaufruf → 502)', async () => {
		const kontext = { heute: '2026-10-17', wochentag: 'Samstag' };
		antworten.push({ status: 200, koerper: toolAntwort('todo_anlegen', { titel: 'x', preis: 3 }) });
		await expect(ki().aktionAusText('x', kontext)).rejects.toMatchObject({ status: 502 });
		antworten.push({ status: 200, koerper: toolAntwort('rechnung_schreiben', {}) });
		await expect(ki().aktionAusText('x', kontext)).rejects.toMatchObject({ status: 502 });
		const kaputt = toolAntwort('todo_anlegen', {});
		kaputt.choices[0].message.tool_calls[0].function.arguments = '{titel:';
		antworten.push({ status: 200, koerper: kaputt });
		await expect(ki().aktionAusText('x', kontext)).rejects.toMatchObject({ status: 502 });
		antworten.push({ status: 200, koerper: { choices: [{ message: { role: 'assistant', content: 'Hallo' } }] } });
		await expect(ki().aktionAusText('x', kontext)).rejects.toMatchObject({ status: 502 });
	});

	it('Angebotsentwurf: Katalog ohne Preise im Prompt, Werkzeug angebot_positionen, Foto nur an das Bild-Modell', async () => {
		const katalog = [
			{ schluessel: 'K1', bezeichnung: 'Wandfliesen verlegen', einheit: 'm²', gewerk: 'fliesen' },
			{ schluessel: 'K2', bezeichnung: 'Silikonfuge', einheit: 'lfm', gewerk: 'fliesen' }
		];
		antworten.push({ status: 200, koerper: toolAntwort('angebot_positionen', { positionen: [{ schluessel: 'K1', menge: 12, unsicher: false }] }) });
		const e = await ki().angebotsEntwurf({ text: '12 m² Wandfliesen', katalog });
		expect(e).toEqual({ positionen: [{ schluessel: 'K1', menge: 12, unsicher: false }] });
		const r = anfragen[0].koerper;
		expect(r.tools.map((t: any) => t.function.name)).toEqual(['angebot_positionen']);
		expect(r.tool_choice).toBe('any');
		expect(r.model).toBe('mistral-small-latest');
		const alles = JSON.stringify(r);
		expect(alles).toContain('Wandfliesen verlegen');
		expect(alles).not.toMatch(/cent|preis\b|€/i);
		anfragen = [];
		antworten.push({ status: 200, koerper: toolAntwort('angebot_positionen', { positionen: [] }) });
		await ki().angebotsEntwurf({ text: 'Bad', katalog, foto: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), typ: 'image/jpeg' } });
		const f = anfragen[0].koerper;
		expect(f.model).toBe('pixtral-12b-latest');
		const inhalt = f.messages.at(-1).content;
		expect(Array.isArray(inhalt)).toBe(true);
		expect(inhalt.some((t: any) => t.type === 'image_url' && String(t.image_url).startsWith('data:image/jpeg;base64,'))).toBe(true);
	});
});

describe('Auswahl des KI-Anbieters', () => {
	it('ohne Schlüssel immer FakeKi, mit mistral + Schlüssel MistralKi', () => {
		expect(waehleAnbieter({})).toBeInstanceOf(FakeKi);
		expect(waehleAnbieter({ CRM_KI_ANBIETER: 'fake', CRM_MISTRAL_KEY: 'x' })).toBeInstanceOf(FakeKi);
		expect(waehleAnbieter({ CRM_KI_ANBIETER: 'mistral' })).toBeInstanceOf(FakeKi);
		expect(waehleAnbieter({ CRM_KI_ANBIETER: 'mistral', CRM_MISTRAL_KEY: '  ' })).toBeInstanceOf(FakeKi);
		const m = waehleAnbieter({ CRM_KI_ANBIETER: 'mistral', CRM_MISTRAL_KEY: 'abc', CRM_KI_MODELL: 'mistral-large-latest' });
		expect(m).toBeInstanceOf(MistralKi);
		expect((m as MistralKi).modell).toBe('mistral-large-latest');
	});
});
