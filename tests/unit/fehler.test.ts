import { describe, expect, it } from 'vitest';
import { alsAntwort, ApiFehler, leseJson } from '../../src/lib/server/fehler';

const anfrage = (headers: Record<string, string> | undefined, body: string = '{"a":1}') =>
	new Request('http://localhost/api/x', { method: 'POST', headers, body });

describe('leseJson verlangt Content-Type application/json (CSRF-Härtung)', () => {
	it('ohne Content-Type → 415', async () => {
		// Ein String-Body bekommt von Request automatisch text/plain; für "ohne Header" Header explizit entfernen.
		const r = anfrage(undefined);
		r.headers.delete('content-type');
		await expect(leseJson(r)).rejects.toMatchObject({
			status: 415,
			message: 'Content-Type muss application/json sein'
		});
	});

	it('text/plain und Formular-Typen → 415 (einfache Cross-Site-Formulare)', async () => {
		for (const t of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
			await expect(leseJson(anfrage({ 'content-type': t })), t).rejects.toMatchObject({ status: 415 });
		}
	});

	it('ähnlich klingende Typen sind kein JSON-Typ', async () => {
		for (const t of ['application/jsonx', 'application/json-patch+json', 'xapplication/json']) {
			await expect(leseJson(anfrage({ 'content-type': t })), t).rejects.toMatchObject({ status: 415 });
		}
	});

	it('application/json in jeder Schreibweise und mit Parametern ist erlaubt', async () => {
		for (const t of ['application/json', 'Application/JSON', 'application/json; charset=utf-8', 'APPLICATION/JSON;charset=UTF-8', ' application/json ']) {
			await expect(leseJson(anfrage({ 'content-type': t })), t).resolves.toEqual({ a: 1 });
		}
	});

	it('der Typ wird vor dem Inhalt geprüft; kaputtes JSON mit richtigem Typ bleibt 400', async () => {
		await expect(leseJson(anfrage({ 'content-type': 'text/plain' }, 'kaputt'))).rejects.toMatchObject({ status: 415 });
		await expect(leseJson(anfrage({ 'content-type': 'application/json' }, 'kaputt'))).rejects.toMatchObject({ status: 400 });
		await expect(leseJson(anfrage({ 'content-type': 'application/json' }, '[1]'))).rejects.toMatchObject({ status: 400 });
	});
});

describe('ApiFehler mit Zusatzfeldern', () => {
	it('alsAntwort gibt extra neben "fehler" aus; "fehler" lässt sich nicht überschreiben', async () => {
		const e = new ApiFehler(402, 'Im aktuellen Tarif nicht enthalten', { tarifMit: ['profi'], fehler: 'böse' });
		const a = alsAntwort(e);
		expect(a.status).toBe(402);
		expect(await a.json()).toEqual({ fehler: 'Im aktuellen Tarif nicht enthalten', tarifMit: ['profi'] });
	});

	it('ohne extra bleibt es bei { fehler }', async () => {
		expect(await alsAntwort(new ApiFehler(403, 'Nein')).json()).toEqual({ fehler: 'Nein' });
	});
});
