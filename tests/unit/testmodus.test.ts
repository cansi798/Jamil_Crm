import { describe, expect, it } from 'vitest';
import { testEmail, testmodusAktiv, testmodusStartFehler } from '../../src/lib/server/auth/testmodus';

describe('Testmodus – Benutzername zu Test-E-Mail', () => {
	it('ergänzt kurze Namen zur Test-Domain', () => {
		expect(testEmail('can.chef')).toBe('can.chef@bauwelt.test');
		expect(testEmail(' Jamil.Buero ')).toBe('jamil.buero@bauwelt.test');
		expect(testEmail('jamil.admin')).toBe('jamil.admin@crm.test');
		expect(testEmail('admin')).toBe('admin@crm.test');
	});
	it('akzeptiert volle Adressen nur mit .test', () => {
		expect(testEmail('chef@bauwelt.test')).toBe('chef@bauwelt.test');
		expect(testEmail('chef@firma.de')).toBeNull();
		expect(testEmail('a@b.test.de')).toBeNull();
	});
	it('lehnt Leeres und Sonderzeichen ab', () => {
		expect(testEmail('')).toBeNull();
		expect(testEmail('can chef')).toBeNull();
		expect(testEmail("x'--")).toBeNull();
		expect(testEmail('a'.repeat(300))).toBeNull();
	});
	it('ist nur mit CRM_TESTMODUS=1 aktiv', () => {
		expect(testmodusAktiv({})).toBe(false);
		expect(testmodusAktiv({ CRM_TESTMODUS: 'true' })).toBe(false);
		expect(testmodusAktiv({ CRM_TESTMODUS: '1' })).toBe(true);
	});
	it('startet nur lokal oder mit ausdrücklich erlaubter Vorschau-Adresse', () => {
		expect(testmodusStartFehler({ ORIGIN: 'https://crm.firma.de' })).toBeNull(); // Testmodus aus
		expect(testmodusStartFehler({ CRM_TESTMODUS: '1', ORIGIN: 'http://127.0.0.1:8310' })).toBeNull();
		expect(testmodusStartFehler({ CRM_TESTMODUS: '1', ORIGIN: 'http://localhost:3000/' })).toBeNull();
		expect(testmodusStartFehler({ CRM_TESTMODUS: '1' })).toBeNull();
		expect(testmodusStartFehler({ CRM_TESTMODUS: '1', ORIGIN: 'https://crm.firma.de' })).toMatch(/nur lokal/);
		expect(testmodusStartFehler({ CRM_TESTMODUS: '1', ORIGIN: 'http://127.0.0.1.evil.de' })).toMatch(/nur lokal/);
		// Vorschau: start-vorschau.sh nennt die eigene Adresse
		const vorschau = { CRM_TESTMODUS: '1', ORIGIN: 'https://crm.waybuild-software.de', CRM_TESTMODUS_ORIGIN: 'https://crm.waybuild-software.de' };
		expect(testmodusStartFehler(vorschau)).toBeNull();
		expect(testmodusStartFehler({ ...vorschau, ORIGIN: 'https://crm.andere.de' })).toMatch(/nur lokal/);
	});
});
