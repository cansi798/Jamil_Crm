import { describe, expect, it } from 'vitest';
import { entschluessele, geheimnisBereit, hinweis, verschluessele } from '../../src/lib/server/geheimnis';

const env = { CRM_GEHEIMNIS_SCHLUESSEL: 'x'.repeat(40) };
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';

describe('Geheimnisse (Lexware-Schlüssel, SMTP-Passwort)', () => {
	it('Rundreise: verschlüsselt und wieder entschlüsselt', () => {
		const c = verschluessele('geheimer-api-schluessel-123', 'lexware', B1, env);
		expect(c[0]).toBe(1);
		expect(entschluessele(c, 'lexware', B1, env)).toBe('geheimer-api-schluessel-123');
	});

	it('Klartext steht nie im Chiffrat, zwei Aufrufe ergeben verschiedene Chiffrate', () => {
		const a = verschluessele('geheimer-api-schluessel-123', 'smtp', B1, env);
		const b = verschluessele('geheimer-api-schluessel-123', 'smtp', B1, env);
		expect(Buffer.from(a).toString('latin1')).not.toContain('geheimer');
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('anderer Betrieb, anderer Zweck oder anderer Schlüssel → Fehler (Chiffrate nicht vertauschbar)', () => {
		const c = verschluessele('abc', 'lexware', B1, env);
		expect(() => entschluessele(c, 'lexware', B2, env)).toThrow();
		expect(() => entschluessele(c, 'smtp', B1, env)).toThrow();
		expect(() => entschluessele(c, 'lexware', B1, { CRM_GEHEIMNIS_SCHLUESSEL: 'y'.repeat(40) })).toThrow();
	});

	it('ohne (oder mit zu kurzem) CRM_GEHEIMNIS_SCHLUESSEL wird nichts gespeichert: 503 mit klarer Meldung', () => {
		expect(geheimnisBereit({})).toBe(false);
		expect(geheimnisBereit({ CRM_GEHEIMNIS_SCHLUESSEL: 'kurz' })).toBe(false);
		expect(geheimnisBereit(env)).toBe(true);
		try {
			verschluessele('abc', 'lexware', B1, {});
			expect.unreachable();
		} catch (e: any) {
			expect(e.status).toBe(503);
			expect(e.message).toContain('CRM_GEHEIMNIS_SCHLUESSEL');
		}
	});

	it('Hinweis zeigt nur die letzten 4 Zeichen', () => {
		expect(hinweis('abcdefgh1234')).toBe('…1234');
		expect(hinweis('ab')).toBe('…');
	});
});
