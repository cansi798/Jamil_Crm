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

/** Die Datenbank hat die Sitzung abgelehnt: Benutzer inaktiv oder unbekannt, oder Betrieb gesperrt. */
export class SitzungVerweigert extends Error {
	constructor() {
		super('Sitzung nicht erlaubt');
		this.name = 'SitzungVerweigert';
	}
}

/**
 * Legt eine Sitzung an und liefert das Token (für das Cookie). Gespeichert wird nur der Hash.
 * Wirft `SitzungVerweigert`, wenn der Benutzer inaktiv oder sein Betrieb gesperrt ist.
 */
export async function neueSitzung(benutzerId: string): Promise<string> {
	const token = randomBytes(32).toString('base64url');
	const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
	const [z] = await systemAbfrage(
		(sql) =>
			sql`select app.sitzung_anlegen(${benutzerId}::uuid, ${hashe(token)}::bytea, ${ablauf}::timestamptz) as ok`
	);
	if (z?.ok !== true) throw new SitzungVerweigert();
	return token;
}

/**
 * Prüft ein Token. `null`, wenn ungültig, abgelaufen oder gesperrt. `verlaengert` ist true, wenn die Datenbank
 * die Sitzung gerade (höchstens einmal pro Tag) auf +30 Tage verlängert hat – dann muss das Cookie neu gesetzt werden.
 */
export async function pruefeSitzungMitStatus(
	token: string
): Promise<{ nutzer: Nutzer; verlaengert: boolean } | null> {
	if (!TOKEN_MUSTER.test(token)) return null;
	const zeilen = await systemAbfrage(
		(sql) => sql`select * from app.sitzung_pruefen(${hashe(token)}::bytea)`
	);
	const z = zeilen[0];
	if (!z) return null;
	return {
		nutzer: {
			id: z.benutzer_id,
			betriebId: z.betrieb_id,
			istAdmin: z.ist_admin,
			rechte: z.rolle_rechte,
			betriebStatus: z.betrieb_status
		},
		verlaengert: z.verlaengert === true
	};
}

/** Wie `pruefeSitzungMitStatus`, aber nur der Nutzer. */
export async function pruefeSitzung(token: string): Promise<Nutzer | null> {
	return (await pruefeSitzungMitStatus(token))?.nutzer ?? null;
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
