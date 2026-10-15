import { createHash, randomBytes } from 'node:crypto';
import { systemAbfrage } from '../db';

export const COOKIE_NAME = 'crm_sitzung';
export const SITZUNG_TAGE = 30;
const SITZUNG_SEKUNDEN = SITZUNG_TAGE * 24 * 60 * 60;
/** 32 Byte Zufall als base64url = 43 Zeichen. */
const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;

/** Der Server kennt nur den SHA-256 des Tokens; das Token selbst steht nur im Cookie des Browsers. */
function hashe(token: string): Buffer {
	return createHash('sha256').update(token).digest();
}

/** Legt eine Sitzung an und liefert das Token (für das Cookie). Gespeichert wird nur der Hash. */
export async function neueSitzung(benutzerId: string): Promise<string> {
	const token = randomBytes(32).toString('base64url');
	const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
	await systemAbfrage(
		(sql) => sql`select app.sitzung_anlegen(${benutzerId}::uuid, ${hashe(token)}::bytea, ${ablauf}::timestamptz)`
	);
	return token;
}

/** Prüft ein Token (verlängert dabei die Sitzung gleitend). `null`, wenn ungültig, abgelaufen oder gesperrt. */
export async function pruefeSitzung(token: string): Promise<Nutzer | null> {
	if (!TOKEN_MUSTER.test(token)) return null;
	const zeilen = await systemAbfrage(
		(sql) => sql`select * from app.sitzung_pruefen(${hashe(token)}::bytea)`
	);
	const z = zeilen[0];
	if (!z) return null;
	return {
		id: z.benutzer_id,
		betriebId: z.betrieb_id,
		istAdmin: z.ist_admin,
		rechte: z.rolle_rechte,
		betriebStatus: z.betrieb_status
	};
}

export async function loescheSitzung(token: string): Promise<void> {
	if (!TOKEN_MUSTER.test(token)) return;
	await systemAbfrage((sql) => sql`select app.sitzung_loeschen(${hashe(token)}::bytea)`);
}

type CookieSpeicher = {
	set(name: string, wert: string, opts: Record<string, unknown> & { path: string }): unknown;
	delete(name: string, opts: { path: string }): unknown;
};

/** `Secure` bleibt immer gesetzt; Tests rufen die Handler direkt auf und brauchen kein HTTP. */
export function setzeSitzungsCookie(cookies: CookieSpeicher, token: string): void {
	cookies.set(COOKIE_NAME, token, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/',
		maxAge: SITZUNG_SEKUNDEN
	});
}

export function loescheSitzungsCookie(cookies: CookieSpeicher): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
}
