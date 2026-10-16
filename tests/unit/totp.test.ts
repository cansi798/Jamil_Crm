import { describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { neuesTotpGeheimnis, pruefeTotp, pruefeTotpSchritt } from '../../src/lib/server/auth/totp';

const SCHRITT_MS = 30_000;

/** Code, den eine Authenticator-App zum Zeitpunkt `zeit` anzeigt. */
function code(geheimnis: string, zeit: number): string {
	return new OTPAuth.TOTP({
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(geheimnis)
	}).generate({ timestamp: zeit });
}

describe('neuesTotpGeheimnis', () => {
	it('liefert Base32-Geheimnis und otpauth-URI mit Aussteller, SHA1, 6 Ziffern, 30 s', () => {
		const { geheimnis, uri } = neuesTotpGeheimnis('anna@beispiel.test');
		expect(geheimnis).toMatch(/^[A-Z2-7]{32}$/); // 20 Byte
		const u = new URL(uri);
		expect(u.protocol).toBe('otpauth:');
		expect(u.host).toBe('totp');
		expect(decodeURIComponent(u.pathname)).toBe('/CRM System:anna@beispiel.test');
		expect(u.searchParams.get('issuer')).toBe('CRM System');
		expect(u.searchParams.get('secret')).toBe(geheimnis);
		expect(u.searchParams.get('algorithm')).toBe('SHA1');
		expect(u.searchParams.get('digits')).toBe('6');
		expect(u.searchParams.get('period')).toBe('30');
	});

	it('jedes Geheimnis ist neu', () => {
		expect(neuesTotpGeheimnis('a@b.test').geheimnis).not.toBe(neuesTotpGeheimnis('a@b.test').geheimnis);
	});
});

describe('pruefeTotp', () => {
	const { geheimnis } = neuesTotpGeheimnis('anna@beispiel.test');
	const jetzt = 1_800_000_000_000;

	it('gültiger Code → true', () => {
		expect(pruefeTotp(geheimnis, code(geheimnis, jetzt), jetzt)).toBe(true);
	});

	it('Code des Nachbarfensters (±1) → true', () => {
		expect(pruefeTotp(geheimnis, code(geheimnis, jetzt - SCHRITT_MS), jetzt)).toBe(true);
		expect(pruefeTotp(geheimnis, code(geheimnis, jetzt + SCHRITT_MS), jetzt)).toBe(true);
	});

	it('Code von vor 2 Fenstern → false', () => {
		expect(pruefeTotp(geheimnis, code(geheimnis, jetzt - 2 * SCHRITT_MS), jetzt)).toBe(false);
	});

	it('Code von in 2 Fenstern → false', () => {
		expect(pruefeTotp(geheimnis, code(geheimnis, jetzt + 2 * SCHRITT_MS), jetzt)).toBe(false);
	});

	it('Leerzeichen im Code werden toleriert, sonst nur genau 6 Ziffern', () => {
		const c = code(geheimnis, jetzt);
		expect(pruefeTotp(geheimnis, `${c.slice(0, 3)} ${c.slice(3)}`, jetzt)).toBe(true);
		expect(pruefeTotp(geheimnis, '', jetzt)).toBe(false);
		expect(pruefeTotp(geheimnis, c + '0', jetzt)).toBe(false);
		expect(pruefeTotp(geheimnis, 'abcdef', jetzt)).toBe(false);
		expect(pruefeTotp(geheimnis, '12345', jetzt)).toBe(false);
	});

	it('anderes Geheimnis → false', () => {
		const anderes = neuesTotpGeheimnis('x@y.test').geheimnis;
		expect(pruefeTotp(anderes, code(geheimnis, jetzt), jetzt)).toBe(false);
	});

	it('kaputtes Geheimnis wirft nicht, sondern → false', () => {
		expect(pruefeTotp('!!!kein base32!!!', '123456', jetzt)).toBe(false);
	});
});

describe('pruefeTotpSchritt', () => {
	const { geheimnis } = neuesTotpGeheimnis('anna@beispiel.test');
	const jetzt = 1_800_000_000_000;
	const zaehler = Math.floor(jetzt / SCHRITT_MS);

	it('liefert den Zeitschritt, zu dem der Code gehört', () => {
		expect(pruefeTotpSchritt(geheimnis, code(geheimnis, jetzt), jetzt)).toBe(zaehler);
		expect(pruefeTotpSchritt(geheimnis, code(geheimnis, jetzt - SCHRITT_MS), jetzt)).toBe(zaehler - 1);
		expect(pruefeTotpSchritt(geheimnis, code(geheimnis, jetzt + SCHRITT_MS), jetzt)).toBe(zaehler + 1);
	});

	it('ungültig → null', () => {
		expect(pruefeTotpSchritt(geheimnis, code(geheimnis, jetzt - 2 * SCHRITT_MS), jetzt)).toBeNull();
		expect(pruefeTotpSchritt(geheimnis, 'x', jetzt)).toBeNull();
	});
});
