import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiFehler } from './fehler';

/**
 * Verschlüsselte Geheimnisse in der Datenbank (Lexware-API-Schlüssel, SMTP-Passwort; Plan Lexware Phase 1, Task 1).
 *
 * AES-256-GCM mit einem Schlüssel aus `CRM_GEHEIMNIS_SCHLUESSEL` (Umgebung, mindestens 32 Zeichen, nie in der Datenbank).
 * Je Zweck ein eigener abgeleiteter Schlüssel; Betrieb und Zweck sind als AAD gebunden – ein Chiffrat lässt sich also
 * weder in einen anderen Betrieb noch in ein anderes Feld kopieren. Format: 0x01 | IV (12) | Tag (16) | Daten.
 * Ohne Schlüssel wird nichts gespeichert (503 mit klarer Meldung) – nie Klartext als Ausweg.
 */

export type Zweck = 'lexware' | 'smtp';
type Umgebung = Record<string, string | undefined>;

const VERSION = 1;

function grundschluessel(env: Umgebung): string | null {
	const s = env.CRM_GEHEIMNIS_SCHLUESSEL?.trim() ?? '';
	return s.length >= 32 ? s : null;
}

export function geheimnisBereit(env: Umgebung = process.env): boolean {
	return grundschluessel(env) !== null;
}

function schluessel(zweck: Zweck, env: Umgebung): Buffer {
	const g = grundschluessel(env);
	if (!g) {
		throw new ApiFehler(
			503,
			'Geheimnisse können nicht sicher gespeichert werden: CRM_GEHEIMNIS_SCHLUESSEL fehlt in der Server-Einstellung (.env). Bitte den Administrator fragen.'
		);
	}
	return createHash('sha256').update(`crm-geheimnis:${zweck}:`).update(g).digest();
}

export function verschluessele(klartext: string, zweck: Zweck, betriebId: string, env: Umgebung = process.env): Buffer {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', schluessel(zweck, env), iv);
	c.setAAD(Buffer.from(`${zweck}:${betriebId}`));
	const daten = Buffer.concat([c.update(klartext, 'utf8'), c.final()]);
	return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), daten]);
}

export function entschluessele(b: Uint8Array, zweck: Zweck, betriebId: string, env: Umgebung = process.env): string {
	const buf = Buffer.from(b);
	if (buf.length < 29 || buf[0] !== VERSION) throw new Error('Geheimnis hat ein unbekanntes Format.');
	const d = createDecipheriv('aes-256-gcm', schluessel(zweck, env), buf.subarray(1, 13));
	d.setAAD(Buffer.from(`${zweck}:${betriebId}`));
	d.setAuthTag(buf.subarray(13, 29));
	return Buffer.concat([d.update(buf.subarray(29)), d.final()]).toString('utf8');
}

/** Für die Anzeige: nur die letzten 4 Zeichen („…abcd“), bei kurzen Werten gar nichts. */
export function hinweis(klartext: string): string {
	return klartext.length >= 8 ? `…${klartext.slice(-4)}` : '…';
}
