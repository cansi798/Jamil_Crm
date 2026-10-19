import { describe, expect, it } from 'vitest';
import { mitSicherheitsKopfzeilen } from '../../src/lib/server/sicherheit';

describe('mitSicherheitsKopfzeilen', () => {
	it('setzt nosniff, same-origin, DENY und eine knappe Permissions-Policy', () => {
		const antwort = mitSicherheitsKopfzeilen(new Response('x', { headers: { 'content-type': 'text/plain' } }));
		expect(antwort.headers.get('x-content-type-options')).toBe('nosniff');
		expect(antwort.headers.get('referrer-policy')).toBe('same-origin');
		expect(antwort.headers.get('x-frame-options')).toBe('DENY');
		const pp = antwort.headers.get('permissions-policy')!;
		for (const f of ['camera', 'geolocation', 'payment', 'usb']) expect(pp).toContain(`${f}=()`);
		// Mikrofon nur für die eigene Seite (Sprachsteuerung, Stufe 1d) – nie für eingebettete fremde Seiten
		expect(pp).toContain('microphone=(self)');
		expect(antwort.headers.get('content-type')).toBe('text/plain');
	});

	it('überschreibt eine strengere Referrer-Policy der Route nicht (z. B. no-referrer auf /einladung)', () => {
		const antwort = mitSicherheitsKopfzeilen(new Response('x', { headers: { 'referrer-policy': 'no-referrer' } }));
		expect(antwort.headers.get('referrer-policy')).toBe('no-referrer');
	});

	it('funktioniert auch mit unveränderlichen Kopfzeilen (z. B. Response.redirect) – Status und Ziel bleiben', async () => {
		const umleitung = Response.redirect('http://localhost/anmelden', 303);
		expect(() => umleitung.headers.set('x-test', '1')).toThrow();
		const antwort = mitSicherheitsKopfzeilen(umleitung);
		expect(antwort.status).toBe(303);
		expect(antwort.headers.get('location')).toBe('http://localhost/anmelden');
		expect(antwort.headers.get('x-frame-options')).toBe('DENY');
	});
});
