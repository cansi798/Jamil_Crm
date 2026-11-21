import { describe, expect, it } from 'vitest';
import { besucherIp, vertrauterProxy } from '../../src/lib/server/client-ip';

/** X-Forwarded-For nur von vertrauenswürdigem Proxy (Prüfbericht 21.11.2026). */
describe('Besucher-IP', () => {
	const kopf = (xff: string) => new Headers({ 'x-forwarded-for': xff });
	const env = { CRM_ADRESS_KOPF: 'X-Forwarded-For', CRM_ADRESS_TIEFE: '1' };

	it('vom Proxy im privaten Netz: letzter XFF-Eintrag gilt', () => {
		expect(besucherIp('172.18.0.5', kopf('1.2.3.4, 203.0.113.9'), env)).toBe('203.0.113.9');
		expect(besucherIp('::ffff:127.0.0.1', kopf('198.51.100.7'), env)).toBe('198.51.100.7');
		expect(besucherIp('10.0.0.2', kopf('8.8.8.8, 9.9.9.9'), { ...env, CRM_ADRESS_TIEFE: '2' })).toBe('8.8.8.8');
	});
	it('direkt aus dem Internet: Kopfzeile wird ignoriert (keine gefälschte IP)', () => {
		expect(besucherIp('203.0.113.50', kopf('127.0.0.1'), env)).toBe('203.0.113.50');
		expect(besucherIp('2001:db8::1', kopf('10.0.0.1'), env)).toBe('2001:db8::1');
	});
	it('ohne CRM_ADRESS_KOPF, kaputte Werte, eigene Vertrauensliste', () => {
		expect(besucherIp('172.18.0.5', kopf('203.0.113.9'), {})).toBe('172.18.0.5');
		expect(besucherIp('172.18.0.5', kopf('kein-ip'), env)).toBe('172.18.0.5');
		expect(besucherIp(null, kopf('203.0.113.9'), env)).toBe('unbekannt');
		expect(vertrauterProxy('172.18.0.5', { CRM_PROXY_VERTRAUEN: '192.0.2.10' })).toBe(false);
		expect(vertrauterProxy('192.0.2.10', { CRM_PROXY_VERTRAUEN: '192.0.2.10' })).toBe(true);
		expect(vertrauterProxy('192.0.2.77', { CRM_PROXY_VERTRAUEN: '192.0.2.0/24' })).toBe(true);
		expect(vertrauterProxy('172.32.0.1', {})).toBe(false);
		expect(vertrauterProxy('fd12::1', {})).toBe(true);
	});
});
