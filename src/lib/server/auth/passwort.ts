import { hash, verify } from '@node-rs/argon2';

/** Argon2id mit den Standardparametern von @node-rs/argon2. */
export function hashePasswort(passwort: string): Promise<string> {
	return hash(passwort);
}

/** Liefert bei kaputtem Hash `false` statt eines Fehlers (und gibt den Hash nicht in Meldungen preis). */
export async function pruefePasswort(hashWert: string, passwort: string): Promise<boolean> {
	try {
		return await verify(hashWert, passwort);
	} catch {
		return false;
	}
}
