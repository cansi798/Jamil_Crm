import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { systemAbfrage } from '../db';
import { hashe, SITZUNG_SEKUNDEN, TOKEN_MUSTER } from './sitzung';
import { neuesTotpGeheimnis, pruefeTotpSchritt, totpUri } from './totp';

/**
 * Vor-Sitzung: Zwischenzustand nach dem richtigen Passwort, solange noch der zweite Faktor fehlt (5 Minuten).
 * Sie liegt in einem eigenen Cookie und ist keine Sitzung – `hooks.server.ts` liest sie nicht, und die Datenbank
 * ignoriert sie in `sitzung_pruefen`. Alle Datenbankzugriffe laufen über SECURITY-DEFINER-Funktionen, die über den
 * Hash der Vor-Sitzung adressieren (nie über eine frei gewählte Benutzer-ID).
 */
export const VORSITZUNG_COOKIE = 'crm_vorsitzung';
export const VORSITZUNG_SEKUNDEN = 5 * 60;

export type Weiter =
	| { art: 'sitzung'; token: string }
	| { art: 'code'; token: string }
	| { art: 'einrichten'; token: string }
	| { art: 'verweigert' }
	| { art: 'gesperrt' };

function neuesToken(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Eingang nach dem richtigen Passwort. Die Datenbank entscheidet: volle Sitzung (`sitzung`) oder Vor-Sitzung
 * (`code` bei aktivem TOTP, `einrichten` bei Pflicht ohne TOTP). Das zurückgegebene Token gehört zu dem, was die
 * Datenbank tatsächlich angelegt hat; bei `verweigert`/`gesperrt` gibt es keins.
 */
export async function meldeAn(benutzerId: string): Promise<Weiter> {
	const voll = neuesToken();
	const vor = neuesToken();
	const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
	const [z] = await systemAbfrage(
		(sql) =>
			sql`select app.anmeldung_weiter(${benutzerId}::uuid, ${hashe(voll)}::bytea, ${ablauf}::timestamptz, ${hashe(vor)}::bytea) as art`
	);
	switch (z?.art) {
		case 'sitzung':
			return { art: 'sitzung', token: voll };
		case 'code':
			return { art: 'code', token: vor };
		case 'einrichten':
			return { art: 'einrichten', token: vor };
		case 'gesperrt':
			return { art: 'gesperrt' };
		default:
			return { art: 'verweigert' };
	}
}

export type VorsitzungsDaten = {
	benutzerId: string;
	email: string;
	totpAktiv: boolean;
	gesperrt: boolean;
};

type Intern = VorsitzungsDaten & { geheimnis: string | null; letzterSchritt: number | null };

async function laden(token: string): Promise<Intern | null> {
	if (!TOKEN_MUSTER.test(token)) return null;
	const [z] = await systemAbfrage(
		(sql) => sql`select * from app.vorsitzung_daten(${hashe(token)}::bytea)`
	);
	if (!z) return null;
	return {
		benutzerId: z.benutzer_id,
		email: z.email,
		totpAktiv: z.totp_aktiv === true,
		gesperrt: z.gesperrt === true,
		geheimnis: z.totp_geheim,
		// bigint kommt als String; Zeitschritte (Unix-Zeit / 30 s) passen sicher in eine Zahl
		letzterSchritt: z.totp_letzter_schritt === null ? null : Number(z.totp_letzter_schritt)
	};
}

/** Nicht-geheime Daten zur Vor-Sitzung, oder `null`, wenn sie ungültig/abgelaufen ist. */
export async function vorsitzungsDaten(token: string): Promise<VorsitzungsDaten | null> {
	const d = await laden(token);
	if (!d) return null;
	return { benutzerId: d.benutzerId, email: d.email, totpAktiv: d.totpAktiv, gesperrt: d.gesperrt };
}

/**
 * Einrichtung: das (noch nicht aktivierte) Geheimnis zur Vor-Sitzung samt QR-Code (PNG als Data-URL).
 * `null`, wenn die Vor-Sitzung ungültig ist oder TOTP bereits aktiv ist – ein aktives Geheimnis wird nie ausgegeben.
 */
export async function bereiteEinrichtungVor(
	token: string
): Promise<{ geheimnis: string; uri: string; qr: string } | null> {
	const daten = await vorsitzungsDaten(token);
	if (!daten || daten.totpAktiv) return null;
	const [z] = await systemAbfrage(
		(sql) =>
			sql`select app.totp_geheimnis_vorbereiten(${hashe(token)}::bytea, ${neuesTotpGeheimnis(daten.email).geheimnis}) as geheimnis`
	);
	const geheimnis: string | null = z?.geheimnis ?? null;
	if (!geheimnis) return null;
	const uri = totpUri(geheimnis, daten.email);
	const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
	return { geheimnis, uri, qr };
}

export type CodeErgebnis =
	| { art: 'ok'; sitzungToken: string }
	| { art: 'falsch'; verbleibend: number }
	| { art: 'gesperrt' }
	| { art: 'abgelaufen' };

/**
 * Prüft den Code zur Vor-Sitzung. Bei Erfolg tauscht die Datenbank die Vor-Sitzung atomar gegen eine volle Sitzung
 * (bei der Einrichtung wird dabei TOTP aktiviert). Ein falscher oder bereits benutzter Code zählt als Fehlversuch;
 * der 5. sperrt das Konto 15 Minuten und löscht die Vor-Sitzung. Das Geheimnis und der Code verlassen diese
 * Funktion nie (kein Log, keine Fehlermeldung).
 */
export async function pruefeZweitenFaktor(
	token: string,
	code: string,
	jetzt: number = Date.now()
): Promise<CodeErgebnis> {
	const d = await laden(token);
	if (!d) return { art: 'abgelaufen' };
	if (d.gesperrt) return { art: 'gesperrt' };

	const schritt = d.geheimnis ? pruefeTotpSchritt(d.geheimnis, code, jetzt) : null;
	if (schritt !== null) {
		const neu = neuesToken();
		const ablauf = new Date(Date.now() + SITZUNG_SEKUNDEN * 1000);
		const [z] = await systemAbfrage(
			(sql) =>
				sql`select app.zweiten_faktor_abschliessen(${hashe(token)}::bytea, ${schritt}::bigint, ${hashe(neu)}::bytea, ${ablauf}::timestamptz) as ok`
		);
		if (z?.ok === true) return { art: 'ok', sitzungToken: neu };
	}

	// falscher Code, schon benutzter Zeitschritt oder (gleichzeitig) verlorenes Rennen: als Fehlversuch zählen
	const [f] = await systemAbfrage(
		(sql) => sql`select app.vorsitzung_fehlversuch(${hashe(token)}::bytea) as rest`
	);
	const rest = Number(f?.rest ?? -1);
	if (rest < 0) return { art: 'abgelaufen' };
	if (rest === 0) return { art: 'gesperrt' };
	return { art: 'falsch', verbleibend: rest };
}

type CookieSpeicher = {
	set(name: string, wert: string, opts: Record<string, unknown> & { path: string }): unknown;
	delete(name: string, opts: { path: string }): unknown;
};

/** `Secure` bleibt immer gesetzt (wie beim Sitzungs-Cookie). */
export function setzeVorsitzungsCookie(cookies: CookieSpeicher, token: string): void {
	cookies.set(VORSITZUNG_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		path: '/',
		maxAge: VORSITZUNG_SEKUNDEN
	});
}

export function loescheVorsitzungsCookie(cookies: CookieSpeicher): void {
	cookies.delete(VORSITZUNG_COOKIE, { path: '/' });
}
