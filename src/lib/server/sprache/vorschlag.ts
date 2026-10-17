import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiFehler } from '../fehler';

/**
 * Signierter Vorschlag der Sprachsteuerung: Die Sprach-API speichert nichts, sie liefert nur einen Vorschlag
 * (`<inhalt>.<signatur>`, base64url, HMAC-SHA256 mit `CRM_VORSCHLAG_GEHEIMNIS`), 10 Minuten gültig und an Benutzer
 * und Betrieb gebunden. Gespeichert wird erst mit genau diesem Vorschlag (`POST /api/sprache/ausfuehren`), jeder
 * Vorschlag nur einmal.
 *
 * Fehler: Format/Signatur falsch oder abgelaufen → 400; gültig, aber für einen anderen Benutzer/Betrieb → 403;
 * schon ausgeführt → 409. Die Signatur wird immer zuerst geprüft – wer Benutzer oder Betrieb im Inhalt umschreibt,
 * bekommt 400.
 */

export const VORSCHLAG_GUELTIG_MS = 10 * 60 * 1000;
const UNGUELTIG = 'Der Vorschlag ist ungültig – bitte noch einmal sprechen.';
const ABGELAUFEN = 'Der Vorschlag ist abgelaufen – bitte noch einmal sprechen.';
const MAX_TOKEN = 64 * 1024;

type Inhalt = { v: 1; b: string; u: string; exp: number; jti: string; vorschau: unknown };

let notGeheimnis: string | null = null;

/**
 * Geheimnis aus der Umgebung (mind. 32 Zeichen). Fehlt es, gilt ein zufälliges Geheimnis für die Laufzeit dieses
 * Prozesses (Vorschläge überleben dann keinen Neustart) – mit Warnung im Log. Zu kurz → Konfigurationsfehler.
 */
function geheimnis(): string {
	const wert = process.env.CRM_VORSCHLAG_GEHEIMNIS;
	if (wert !== undefined && wert !== '') {
		if (wert.length < 32) throw new Error('CRM_VORSCHLAG_GEHEIMNIS ist zu kurz (mindestens 32 Zeichen)');
		return wert;
	}
	if (!notGeheimnis) {
		notGeheimnis = randomBytes(32).toString('base64url');
		console.warn('CRM_VORSCHLAG_GEHEIMNIS fehlt – Sprach-Vorschläge gelten nur bis zum nächsten Neustart.');
	}
	return notGeheimnis;
}

const signatur = (inhalt: string) => createHmac('sha256', geheimnis()).update(inhalt).digest();

export function signiere(vorschau: unknown, benutzerId: string, betriebId: string): string {
	const inhalt: Inhalt = {
		v: 1,
		b: betriebId,
		u: benutzerId,
		exp: Date.now() + VORSCHLAG_GUELTIG_MS,
		jti: randomBytes(16).toString('base64url'),
		vorschau
	};
	const teil = Buffer.from(JSON.stringify(inhalt), 'utf8').toString('base64url');
	return `${teil}.${signatur(teil).toString('base64url')}`;
}

export type GeprüfterVorschlag = { vorschau: any; jti: string; exp: number };

export function pruefeVorschlag(token: unknown, benutzerId: string, betriebId: string): GeprüfterVorschlag {
	if (typeof token !== 'string' || token.length > MAX_TOKEN) throw new ApiFehler(400, UNGUELTIG);
	const teile = token.split('.');
	if (teile.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(teile[0]) || !/^[A-Za-z0-9_-]+$/.test(teile[1])) {
		throw new ApiFehler(400, UNGUELTIG);
	}
	const [teil, sig] = teile;
	const erwartet = signatur(teil);
	const gegeben = Buffer.from(sig, 'base64url');
	if (gegeben.length !== erwartet.length || !timingSafeEqual(gegeben, erwartet)) throw new ApiFehler(400, UNGUELTIG);
	let inhalt: Inhalt;
	try {
		inhalt = JSON.parse(Buffer.from(teil, 'base64url').toString('utf8')) as Inhalt;
	} catch {
		throw new ApiFehler(400, UNGUELTIG);
	}
	if (!inhalt || inhalt.v !== 1 || typeof inhalt.exp !== 'number' || typeof inhalt.jti !== 'string') {
		throw new ApiFehler(400, UNGUELTIG);
	}
	if (Date.now() > inhalt.exp) throw new ApiFehler(400, ABGELAUFEN);
	if (inhalt.b !== betriebId || inhalt.u !== benutzerId) throw new ApiFehler(403, 'Dieser Vorschlag gehört zu einem anderen Benutzer.');
	return { vorschau: inhalt.vorschau, jti: inhalt.jti, exp: inhalt.exp };
}

/** Bereits ausgeführte Vorschläge (je Prozess; Einträge verfallen mit dem Vorschlag). */
const benutzt = new Map<string, number>();

/** Markiert den Vorschlag als ausgeführt; beim zweiten Mal 409. */
export function markiereBenutzt(v: GeprüfterVorschlag): void {
	const jetzt = Date.now();
	for (const [jti, exp] of benutzt) if (exp < jetzt) benutzt.delete(jti);
	if (benutzt.has(v.jti)) throw new ApiFehler(409, 'Dieser Vorschlag wurde schon gespeichert.');
	benutzt.set(v.jti, v.exp);
}

/** Gibt einen Vorschlag wieder frei (wenn das Speichern scheiterte, darf der Nutzer es erneut versuchen). */
export function gibFrei(v: GeprüfterVorschlag): void {
	benutzt.delete(v.jti);
}
