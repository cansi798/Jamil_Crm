import { describe, expect, it } from 'vitest';
import * as devalue from 'devalue';
import { istAdminPfad, nichtGefundenAntwort, nurLesenAntwort } from '../../src/lib/server/sperren';

/** Wie `deserialize` aus `$app/forms` (SvelteKit): JSON mit devalue-kodiertem `data`. */
function deserialize(text: string): { type: string; status?: number; data?: unknown } {
	const ergebnis = JSON.parse(text);
	if (ergebnis.data) ergebnis.data = devalue.parse(ergebnis.data);
	return ergebnis;
}

const post = (pfad: string, headers: Record<string, string> = {}) =>
	new Request(`http://localhost${pfad}`, { method: 'POST', headers });

describe('nurLesenAntwort', () => {
	it('API: 403 JSON { fehler: "Nur Lesezugriff" } (unverändert)', async () => {
		const r = nurLesenAntwort(post('/api/kunden', { 'content-type': 'application/json' }));
		expect(r.status).toBe(403);
		expect(r.headers.get('content-type')).toContain('application/json');
		expect(await r.json()).toEqual({ fehler: 'Nur Lesezugriff' });
	});

	it('Formular mit use:enhance: ActionResult „failure“ mit lesbarer Meldung in form.fehler', async () => {
		const r = nurLesenAntwort(post('/kunden/neu?/anlegen', { 'x-sveltekit-action': 'true', accept: 'application/json' }));
		expect(r.status).toBe(403);
		const ergebnis = deserialize(await r.text());
		expect(ergebnis).toMatchObject({ type: 'failure', status: 403 });
		expect((ergebnis as { data: { fehler: string } }).data.fehler).toMatch(/^Nur Lesezugriff/);
	});

	it('Formular ohne JavaScript: deutsche HTML-Seite statt rohem JSON', async () => {
		const r = nurLesenAntwort(post('/kunden/neu?/anlegen', { accept: 'text/html' }));
		expect(r.status).toBe(403);
		expect(r.headers.get('content-type')).toContain('text/html');
		const html = await r.text();
		expect(html).toContain('Nur Lesezugriff');
		expect(html).toContain('lang="de"');
	});
});

describe('Admin-Bereich', () => {
	it('istAdminPfad erkennt /admin, /admin/…, /api/admin/… – aber nicht ähnliche Pfade', () => {
		for (const p of ['/admin', '/admin/', '/admin/betriebe/x', '/api/admin', '/api/admin/betriebe']) {
			expect(istAdminPfad(p), p).toBe(true);
		}
		for (const p of ['/administration', '/api/administrator', '/kunden/admin', '/']) {
			expect(istAdminPfad(p), p).toBe(false);
		}
	});

	it('nichtGefundenAntwort: 404, API als JSON, sonst Text', async () => {
		const api = nichtGefundenAntwort('/api/admin/betriebe');
		expect(api.status).toBe(404);
		expect(await api.json()).toEqual({ fehler: 'Nicht gefunden.' });
		const seite = nichtGefundenAntwort('/admin');
		expect(seite.status).toBe(404);
		expect(await seite.text()).toContain('Nicht gefunden.');
	});
});
