import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { erzeugeBegrenzung } from './auth/ratelimit';

/**
 * Schutz der öffentlichen Buchungsseiten vor Spam und Durchprobieren:
 * - Begrenzungen je IP-Adresse und je Link (im Arbeitsspeicher, nach Neustart leer),
 * - Honigtopf: ein für Menschen unsichtbares Feld muss leer bleiben,
 * - Zeitstempel: das Formular trägt einen signierten Zeitpunkt; schneller als 3 Sekunden oder älter als 12 Stunden
 *   wird abgelehnt (Bots schicken sofort bzw. wiederholen alte Formulare).
 */

/** Freie Zeiten abfragen: 300 je 10 Minuten und IP. */
export const abfrageGrenze = erzeugeBegrenzung({ max: 300, fensterMs: 10 * 60_000 });
/** Buchen/Absagen/Verschieben: 20 je Stunde und IP. */
export const buchenGrenzeIp = erzeugeBegrenzung({ max: 20, fensterMs: 60 * 60_000 });
/** Buchen: 60 je Stunde und Link. */
export const buchenGrenzeLink = erzeugeBegrenzung({ max: 60, fensterMs: 60 * 60_000 });

let zufall: string | null = null;
function geheimnis(): string {
	const g = process.env.CRM_VORSCHLAG_GEHEIMNIS;
	if (g && g.length >= 32) return `buchung:${g}`;
	zufall ??= randomBytes(32).toString('hex');
	return zufall;
}

const sig = (t: string) => createHmac('sha256', geheimnis()).update(`stempel:${t}`).digest('base64url').slice(0, 22);

export const MIN_SEKUNDEN = 3;
export const MAX_STUNDEN = 12;

/** Signierter Zeitstempel fürs Formular. */
export function formStempel(jetzt = Date.now()): string {
	const t = String(Math.floor(jetzt / 1000));
	return `${t}.${sig(t)}`;
}

/** `ok`, `zu_schnell` (unter 3 s) oder `ungueltig` (falsch signiert, zu alt, fehlt). */
export function pruefeStempel(stempel: unknown, jetzt = Date.now()): 'ok' | 'zu_schnell' | 'ungueltig' {
	if (typeof stempel !== 'string' || !/^\d{9,11}\.[A-Za-z0-9_-]{22}$/.test(stempel)) return 'ungueltig';
	const [t, s] = stempel.split('.');
	const erwartet = Buffer.from(sig(t));
	const echt = Buffer.from(s);
	if (erwartet.length !== echt.length || !timingSafeEqual(erwartet, echt)) return 'ungueltig';
	const alter = jetzt / 1000 - Number(t);
	if (alter < MIN_SEKUNDEN) return 'zu_schnell';
	if (alter > MAX_STUNDEN * 3600 || alter < -60) return 'ungueltig';
	return 'ok';
}

/** Honigtopf-Feld (heißt für Bots verlockend „website“) muss leer sein. */
export const honigtopfLeer = (w: unknown) => w === undefined || w === null || w === '';

/** Verwaltungs-Token (Link „absagen/verschieben“): 32 Zufallsbytes; gespeichert wird nur der SHA-256. */
export function neuesVerwaltungsToken(): { token: string; hash: Buffer } {
	const token = randomBytes(32).toString('base64url');
	return { token, hash: verwaltungsHash(token)! };
}

export function verwaltungsHash(token: unknown): Buffer | null {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	return createHash('sha256').update(token).digest();
}
