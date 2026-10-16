import { describe, expect, it } from 'vitest';
import { hashePasswort, pruefePasswort } from '../../src/lib/server/auth/passwort';

describe('Passwort-Hash (Argon2id)', () => {
	it('hasht mit Argon2id und prüft korrekt', async () => {
		const hash = await hashePasswort('geheim-123');
		expect(hash.startsWith('$argon2id$')).toBe(true);
		expect(await pruefePasswort(hash, 'geheim-123')).toBe(true);
		expect(await pruefePasswort(hash, 'geheim-124')).toBe(false);
	});

	it('gleiches Passwort ergibt verschiedene Hashes (Salz)', async () => {
		expect(await hashePasswort('x')).not.toBe(await hashePasswort('x'));
	});

	it('ein kaputter Hash ergibt false statt eines Fehlers', async () => {
		expect(await pruefePasswort('kein-hash', 'x')).toBe(false);
		expect(await pruefePasswort('', 'x')).toBe(false);
	});
});
