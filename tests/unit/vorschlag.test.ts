import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markiereBenutzt, pruefeVorschlag, signiere, VORSCHLAG_GUELTIG_MS } from '../../src/lib/server/sprache/vorschlag';

const GEHEIM = 'test-geheimnis-0123456789abcdef0123456789';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const U1 = '33333333-3333-4333-8333-333333333333';
const U2 = '44444444-4444-4444-8444-444444444444';

const vorschau = { aktion: 'todo_anlegen', werte: { titel: 'Silikonfuge erneuern', zustaendigId: null }, auswahl: [], fehlt: [], warnungen: [] } as never;

const fehlerVon = (f: () => unknown) => {
	try {
		f();
		return null;
	} catch (e) {
		return e as { status?: number; message: string };
	}
};

describe('Signierter Vorschlag', () => {
	beforeEach(() => {
		process.env.CRM_VORSCHLAG_GEHEIMNIS = GEHEIM;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('hin und zurück: gleicher Inhalt, gebunden an Benutzer und Betrieb', () => {
		const t = signiere(vorschau, U1, B1);
		expect(typeof t).toBe('string');
		const v = pruefeVorschlag(t, U1, B1);
		expect(v.vorschau).toEqual(vorschau);
		expect(v.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/);
	});

	it('fremder Benutzer oder fremder Betrieb → 403', () => {
		const t = signiere(vorschau, U1, B1);
		expect(fehlerVon(() => pruefeVorschlag(t, U2, B1))?.status).toBe(403);
		expect(fehlerVon(() => pruefeVorschlag(t, U1, B2))?.status).toBe(403);
	});

	it('manipulierte Felder, falsche Signatur, Unsinn → 400', () => {
		const t = signiere(vorschau, U1, B1);
		const [kopf, sig] = t.split('.');
		const daten = JSON.parse(Buffer.from(kopf, 'base64url').toString('utf8'));
		daten.vorschau.werte.titel = 'Etwas anderes';
		const geaendert = Buffer.from(JSON.stringify(daten)).toString('base64url');
		expect(fehlerVon(() => pruefeVorschlag(`${geaendert}.${sig}`, U1, B1))?.status).toBe(400);
		// Benutzer/Betrieb im Inhalt umgeschrieben (ohne passende Signatur) → 400, nicht 403
		daten.vorschau.werte.titel = 'Silikonfuge erneuern';
		daten.u = U2;
		const umgeschrieben = Buffer.from(JSON.stringify(daten)).toString('base64url');
		expect(fehlerVon(() => pruefeVorschlag(`${umgeschrieben}.${sig}`, U2, B1))?.status).toBe(400);
		for (const kaputt of ['', 'abc', `${kopf}.`, `.${sig}`, `${kopf}.${sig}x`, `${kopf}.${sig}.x`, 'ä.ö', 5, null, undefined]) {
			expect(fehlerVon(() => pruefeVorschlag(kaputt as never, U1, B1))?.status, String(kaputt)).toBe(400);
		}
		// Mit anderem Geheimnis signiert → 400
		const fremd = createHmac('sha256', 'anderes-geheimnis-0123456789abcdef0123').update(kopf).digest('base64url');
		expect(fehlerVon(() => pruefeVorschlag(`${kopf}.${fremd}`, U1, B1))?.status).toBe(400);
	});

	it('nach 10 Minuten abgelaufen → 400', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
		const t = signiere(vorschau, U1, B1);
		vi.setSystemTime(new Date(Date.parse('2026-10-17T10:00:00Z') + VORSCHLAG_GUELTIG_MS - 1000));
		expect(pruefeVorschlag(t, U1, B1).vorschau).toEqual(vorschau);
		vi.setSystemTime(new Date(Date.parse('2026-10-17T10:00:00Z') + VORSCHLAG_GUELTIG_MS + 1));
		const f = fehlerVon(() => pruefeVorschlag(t, U1, B1));
		expect(f?.status).toBe(400);
		expect(f?.message).toBe('Der Vorschlag ist abgelaufen – bitte noch einmal sprechen.');
		expect(VORSCHLAG_GUELTIG_MS).toBe(10 * 60 * 1000);
	});

	it('jeder Vorschlag nur einmal ausführbar (409 beim zweiten Mal)', () => {
		const t = signiere(vorschau, U1, B1);
		const v = pruefeVorschlag(t, U1, B1);
		markiereBenutzt(v);
		const f = fehlerVon(() => markiereBenutzt(pruefeVorschlag(t, U1, B1)));
		expect(f?.status).toBe(409);
	});

	it('zu kurzes Geheimnis ist ein Konfigurationsfehler', () => {
		process.env.CRM_VORSCHLAG_GEHEIMNIS = 'kurz';
		const f = fehlerVon(() => signiere(vorschau, U1, B1));
		expect(f).toBeInstanceOf(Error);
		expect(f?.status).toBeUndefined();
	});
});
