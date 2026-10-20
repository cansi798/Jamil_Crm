import { describe, expect, it } from 'vitest';
import { TOKEN_MUSTER, tokenHash } from '../../src/lib/server/kundenportal';
import { ipHash } from '../../src/lib/server/kundenportal-oeffentlich';
import { randomBytes } from 'node:crypto';

describe('Kundenportal – Token und Hashes', () => {
	it('Token: 32 Zufallsbytes base64url (43 Zeichen); andere Formen gelten nicht', () => {
		const t = randomBytes(32).toString('base64url');
		expect(TOKEN_MUSTER.test(t)).toBe(true);
		for (const f of ['', 'kurz', `${t}x`, t.replace(/.$/, '+'), t.replace(/.$/, '/'), `${t.slice(0, 42)} `]) expect(TOKEN_MUSTER.test(f)).toBe(false);
	});
	it('gespeichert wird nur der SHA-256 (32 Byte, gleich für gleiches Token, anders für anderes)', () => {
		const a = randomBytes(32).toString('base64url');
		const b = randomBytes(32).toString('base64url');
		expect(tokenHash(a)).toHaveLength(32);
		expect(tokenHash(a).equals(tokenHash(a))).toBe(true);
		expect(tokenHash(a).equals(tokenHash(b))).toBe(false);
		expect(tokenHash(a).toString('base64url')).not.toBe(a);
	});
	it('IP nur als HMAC (nicht umkehrbar, kein Klartext)', () => {
		const h = ipHash('203.0.113.7');
		expect(h).toHaveLength(32);
		expect(h.equals(ipHash('203.0.113.7'))).toBe(true);
		expect(h.equals(ipHash('203.0.113.8'))).toBe(false);
		expect(h.toString('latin1')).not.toContain('203.0.113.7');
	});
});
