import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUSGANG_SCHLUESSEL, einreihen, fehlerListe, senden, wartend, type AusgangOp } from '../../src/lib/leitfaden-ausgang';
import { NUTZER_SCHLUESSEL } from '../../src/lib/heute-kopie';

/** Ausgang des Leitfadens (4b): merken, der Reihe nach senden, offline liegen lassen, Fehler zeigen, je Benutzer. */
class Speicher {
	daten = new Map<string, string>();
	getItem(k: string) {
		return this.daten.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.daten.set(k, v);
	}
	removeItem(k: string) {
		this.daten.delete(k);
	}
}

const op = (n: number, extra: Partial<AusgangOp> = {}): AusgangOp =>
	({ art: 'eingabe', opId: `00000000-0000-4000-8000-00000000000${n}`, einsatzId: 'e1', schrittId: 's', wert: `w${n}`, zeit: '2026-11-03T08:00:00.000Z', ...extra }) as AusgangOp;

describe('Leitfaden-Ausgang', () => {
	let speicher: Speicher;
	beforeEach(() => {
		speicher = new Speicher();
		speicher.setItem(NUTZER_SCHLUESSEL, 'n1');
		(globalThis as any).localStorage = speicher;
	});
	afterEach(() => {
		delete (globalThis as any).localStorage;
	});

	it('merkt Eingaben in Reihenfolge und schickt sie der Reihe nach; Antwort = neuer Stand', async () => {
		einreihen(op(1));
		einreihen(op(2, { einsatzId: 'e2' }));
		expect(wartend().map((o) => o.opId.slice(-1))).toEqual(['1', '2']);
		expect(wartend('e2')).toHaveLength(1);
		const urls: string[] = [];
		const r = await senden((async (url: string, init: RequestInit) => {
			urls.push(`${init.method} ${url} ${init.body}`);
			return new Response(JSON.stringify({ stand: url }), { status: 200 });
		}) as never);
		expect(r).toMatchObject({ gesendet: 2, offline: false });
		expect(urls[0]).toContain('POST /api/leitfaden/e1/eingaben');
		expect(urls[0]).toContain('"opId":"00000000-0000-4000-8000-000000000001"');
		expect(r.staende.get('e2')).toEqual({ stand: '/api/leitfaden/e2/eingaben' });
		expect(wartend()).toEqual([]);
	});

	it('ohne Netz bleibt alles liegen; 5xx/401 auch (später nochmal)', async () => {
		einreihen(op(1));
		einreihen(op(2));
		expect((await senden((async () => { throw new TypeError('offline'); }) as never)).offline).toBe(true);
		expect(wartend()).toHaveLength(2);
		expect((await senden((async () => new Response('', { status: 503 })) as never)).offline).toBe(true);
		expect((await senden((async () => new Response('', { status: 401 })) as never)).offline).toBe(true);
		expect(wartend()).toHaveLength(2);
	});

	it('abgelehnte Eingabe (400) kommt in die Fehlerliste, der Rest geht weiter', async () => {
		einreihen(op(1));
		einreihen(op(2));
		let n = 0;
		const r = await senden((async () => (++n === 1 ? new Response(JSON.stringify({ fehler: 'Die E-Mail-Adresse ist ungültig.' }), { status: 400 }) : new Response('{}', { status: 200 }))) as never);
		expect(r.gesendet).toBe(1);
		expect(r.fehler[0].meldung).toBe('Die E-Mail-Adresse ist ungültig.');
		expect(fehlerListe('e1')).toHaveLength(1);
		expect(wartend()).toEqual([]);
	});

	it('Fotos gehen als Datei, der Abschluss als JSON', async () => {
		einreihen({ art: 'foto', opId: 'f1', einsatzId: 'e1', schrittId: 'fotos', zeit: '2026-11-03T08:00:00.000Z', typ: 'image/jpeg', daten: 'data:image/jpeg;base64,/9j/4A==' });
		einreihen({ art: 'abschluss', opId: 'a1', einsatzId: 'e1', zeit: '2026-11-03T08:01:00.000Z', begruendung: 'kein Netz' });
		const bodies: unknown[] = [];
		await senden((async (url: string, init: RequestInit) => {
			bodies.push([url, init.body instanceof FormData ? (init.body.get('datei') as Blob).size : init.body]);
			return new Response('{}', { status: 200 });
		}) as never);
		expect(bodies).toEqual([
			['/api/leitfaden/e1/foto', 4],
			['/api/leitfaden/e1/abschliessen', JSON.stringify({ opId: 'a1', begruendung: 'kein Netz' })]
		]);
	});

	it('gehört einem Benutzer: meldet sich jemand anderes an, ist der Ausgang leer', () => {
		einreihen(op(1));
		expect(speicher.getItem(AUSGANG_SCHLUESSEL)).not.toBeNull();
		speicher.setItem(NUTZER_SCHLUESSEL, 'n2');
		expect(wartend()).toEqual([]);
		expect(speicher.getItem(AUSGANG_SCHLUESSEL)).toBeNull();
	});
});
