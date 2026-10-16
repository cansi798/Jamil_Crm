import * as OTPAuth from 'otpauth';

/** Name, der in der Authenticator-App über dem Code steht. */
export const TOTP_AUSSTELLER = 'CRM System';
const PERIODE_SEKUNDEN = 30;
const FENSTER = 1;
const CODE_MUSTER = /^\d{6}$/;

function totpFuer(geheimnis: OTPAuth.Secret, email: string): OTPAuth.TOTP {
	return new OTPAuth.TOTP({
		issuer: TOTP_AUSSTELLER,
		label: email,
		algorithm: 'SHA1',
		digits: 6,
		period: PERIODE_SEKUNDEN,
		secret: geheimnis
	});
}

/** Neues Geheimnis (20 Byte Zufall, Base32) und die otpauth-URI für den QR-Code. */
export function neuesTotpGeheimnis(email: string): { geheimnis: string; uri: string } {
	const secret = new OTPAuth.Secret({ size: 20 });
	return { geheimnis: secret.base32, uri: totpFuer(secret, email).toString() };
}

/** otpauth-URI zu einem bereits gespeicherten Geheimnis (für die Anzeige des QR-Codes nach einem Neuladen). */
export function totpUri(geheimnis: string, email: string): string {
	return totpFuer(OTPAuth.Secret.fromBase32(geheimnis), email).toString();
}

/**
 * Prüft einen Code mit Fenster ±1 (ein Zeitschritt à 30 s davor und danach) und liefert den Zeitschritt
 * (Unix-Zeit / 30 s), zu dem der Code gehört – oder `null`, wenn er nicht passt. Den Schritt braucht der Aufrufer,
 * um dieselbe Eingabe nicht zweimal zu akzeptieren. Wirft nie, auch nicht bei kaputtem Geheimnis oder Müll als Code.
 */
export function pruefeTotpSchritt(geheimnis: string, code: string, jetzt: number = Date.now()): number | null {
	const sauber = code.replace(/\s/g, '');
	if (!CODE_MUSTER.test(sauber)) return null;
	try {
		const totp = totpFuer(OTPAuth.Secret.fromBase32(geheimnis), 'konto');
		const delta = totp.validate({ token: sauber, timestamp: jetzt, window: FENSTER });
		if (delta === null) return null;
		return Math.floor(jetzt / (PERIODE_SEKUNDEN * 1000)) + delta;
	} catch {
		return null;
	}
}

export function pruefeTotp(geheimnis: string, code: string, jetzt: number = Date.now()): boolean {
	return pruefeTotpSchritt(geheimnis, code, jetzt) !== null;
}
