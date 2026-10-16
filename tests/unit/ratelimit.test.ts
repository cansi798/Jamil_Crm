import { beforeEach, describe, expect, it } from 'vitest';
import { erzeugeBegrenzung, leereVersuche, pruefeVersuch, zuruecksetzen } from '../../src/lib/server/auth/ratelimit';

const MINUTE = 60_000;

describe('Begrenzung von Anmeldeversuchen', () => {
	beforeEach(() => leereVersuche());

	it('erlaubt 5 Versuche, der 6. wird abgelehnt', () => {
		const t = 1_000_000;
		for (let i = 1; i <= 5; i++) expect(pruefeVersuch('a@x.de', t + i).erlaubt, `Versuch ${i}`).toBe(true);
		expect(pruefeVersuch('a@x.de', t + 6).erlaubt).toBe(false);
		expect(pruefeVersuch('a@x.de', t + 7).erlaubt).toBe(false);
	});

	it('zählt je Schlüssel getrennt', () => {
		const t = 1_000_000;
		for (let i = 0; i < 5; i++) pruefeVersuch('a@x.de', t);
		expect(pruefeVersuch('a@x.de', t).erlaubt).toBe(false);
		expect(pruefeVersuch('b@x.de', t).erlaubt).toBe(true);
	});

	it('nach 15 Minuten ist wieder ein Versuch erlaubt', () => {
		const t = 1_000_000;
		for (let i = 0; i < 5; i++) pruefeVersuch('a@x.de', t);
		expect(pruefeVersuch('a@x.de', t + 14 * MINUTE).erlaubt).toBe(false);
		expect(pruefeVersuch('a@x.de', t + 15 * MINUTE + 1).erlaubt).toBe(true);
	});

	it('abgelehnte Versuche verlängern die Sperre nicht', () => {
		const t = 1_000_000;
		for (let i = 0; i < 5; i++) pruefeVersuch('a@x.de', t);
		pruefeVersuch('a@x.de', t + 10 * MINUTE); // abgelehnt
		expect(pruefeVersuch('a@x.de', t + 15 * MINUTE + 1).erlaubt).toBe(true);
	});

	it('Erfolg setzt zurück', () => {
		const t = 1_000_000;
		for (let i = 0; i < 4; i++) pruefeVersuch('a@x.de', t);
		zuruecksetzen('a@x.de');
		for (let i = 1; i <= 5; i++) expect(pruefeVersuch('a@x.de', t + i).erlaubt).toBe(true);
		expect(pruefeVersuch('a@x.de', t + 6).erlaubt).toBe(false);
	});

	it('eine eigene Instanz ist unabhängig vom Standardspeicher', () => {
		const eigene = erzeugeBegrenzung({ max: 2, fensterMs: MINUTE });
		expect(eigene.pruefeVersuch('k', 0).erlaubt).toBe(true);
		expect(eigene.pruefeVersuch('k', 1).erlaubt).toBe(true);
		expect(eigene.pruefeVersuch('k', 2).erlaubt).toBe(false);
		expect(pruefeVersuch('k', 3).erlaubt).toBe(true);
	});

	it('räumt abgelaufene Einträge auf (Speicher wächst nicht unbegrenzt)', () => {
		const eigene = erzeugeBegrenzung({ max: 5, fensterMs: MINUTE, aufraeumenAb: 10 });
		for (let i = 0; i < 50; i++) eigene.pruefeVersuch(`k${i}`, 0);
		expect(eigene.groesse()).toBe(50);
		eigene.pruefeVersuch('neu', 2 * MINUTE);
		expect(eigene.groesse()).toBe(1);
	});
});
