import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import type { NextcloudKonfig } from './konfig';
import { erwarte, ncAnfrage, NextcloudFehler } from './http';

/**
 * „Mit Nextcloud anmelden“: OpenID Connect, Authorization-Code-Flow mit PKCE (S256), state + nonce, ID-Token
 * (RS256) geprüft über die Schlüssel der Nextcloud (JWKS). Identitätsanbieter ist die Nextcloud-App
 * „OIDC Identity Provider“ (`oidc`). Nur dieser eine Aussteller wird akzeptiert.
 */

export type Discovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
	userinfo_endpoint?: string;
};

export const FLOW_COOKIE = 'crm_nc_anmeldung';
export const FLOW_SEKUNDEN = 10 * 60;
export const FLOW_PFAD = '/anmelden/nextcloud';
const ZEIT_SPIEL_S = 120;

const b64url = (b: Buffer) => b.toString('base64url');
export const zufall = () => b64url(randomBytes(32));
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

/** Interne Adresse für Server-Anfragen: öffentlicher Präfix → interner Präfix. Fremde Adressen werden abgelehnt. */
export function internerPfad(k: NextcloudKonfig, adresse: string): string {
	if (adresse !== k.url && !adresse.startsWith(`${k.url}/`)) {
		throw new NextcloudFehler('Endpunkt liegt nicht auf der konfigurierten Nextcloud', 0);
	}
	// ncAnfrage hängt den Rest an internUrl an (gleicher Pfad-Aufbau wie die öffentliche Adresse)
	return adresse.slice(k.url.length) || '/';
}

let discoveryCache: { wert: Discovery; bis: number } | null = null;
let jwksCache: { wert: JsonWebKey[]; bis: number } | null = null;
/** Nur Tests. */
export function leereOidcZwischenspeicher(): void {
	discoveryCache = null;
	jwksCache = null;
}

export async function discovery(k: NextcloudKonfig, jetzt = Date.now()): Promise<Discovery> {
	if (discoveryCache && discoveryCache.bis > jetzt) return discoveryCache.wert;
	const a = erwarte(
		await ncAnfrage(k, '/index.php/.well-known/openid-configuration', { technik: false }),
		[200],
		'OIDC-Konfiguration'
	);
	const d = JSON.parse(a.text) as Partial<Discovery>;
	for (const feld of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
		if (typeof d[feld] !== 'string') throw new NextcloudFehler(`OIDC-Konfiguration ohne ${feld}`, 0);
	}
	// Aussteller muss genau die konfigurierte öffentliche Adresse sein; alle Endpunkte liegen darunter
	if (d.issuer!.replace(/\/+$/, '') !== k.url) throw new NextcloudFehler('OIDC-Aussteller passt nicht zu NEXTCLOUD_URL', 0);
	for (const feld of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) internerPfad(k, d[feld]!);
	if (d.userinfo_endpoint !== undefined) {
		if (typeof d.userinfo_endpoint !== 'string') throw new NextcloudFehler('OIDC-Konfiguration: userinfo ungültig', 0);
		internerPfad(k, d.userinfo_endpoint);
	}
	discoveryCache = { wert: d as Discovery, bis: jetzt + 60 * 60_000 };
	return discoveryCache.wert;
}

async function schluessel(k: NextcloudKonfig, d: Discovery, neu: boolean, jetzt: number): Promise<JsonWebKey[]> {
	if (!neu && jwksCache && jwksCache.bis > jetzt) return jwksCache.wert;
	const a = erwarte(await ncAnfrage(k, internerPfad(k, d.jwks_uri), { technik: false }), [200], 'JWKS');
	const keys = (JSON.parse(a.text) as { keys?: JsonWebKey[] }).keys;
	if (!Array.isArray(keys)) throw new NextcloudFehler('JWKS ohne Schlüssel', 0);
	jwksCache = { wert: keys, bis: jetzt + 60 * 60_000 };
	return keys;
}

export type FlowDaten = { state: string; nonce: string; verifier: string };

/** Start: Adresse der Nextcloud-Anmeldung und die Daten, die bis zum Rückruf im Cookie liegen. */
export async function startAdresse(
	k: NextcloudKonfig,
	rueckruf: string
): Promise<{ adresse: string; flow: FlowDaten }> {
	if (!k.anmeldung) throw new NextcloudFehler('Anmeldung über Nextcloud ist aus', 0);
	const d = await discovery(k);
	const flow: FlowDaten = { state: zufall(), nonce: zufall(), verifier: zufall() };
	const u = new URL(d.authorization_endpoint);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('client_id', k.anmeldung.clientId);
	u.searchParams.set('redirect_uri', rueckruf);
	u.searchParams.set('scope', 'openid profile email');
	u.searchParams.set('state', flow.state);
	u.searchParams.set('nonce', flow.nonce);
	u.searchParams.set('code_challenge', pkceChallenge(flow.verifier));
	u.searchParams.set('code_challenge_method', 'S256');
	return { adresse: u.toString(), flow };
}

export const flowCookieWert = (f: FlowDaten) => b64url(Buffer.from(JSON.stringify(f)));

export function liesFlowCookie(wert: string | undefined): FlowDaten | null {
	if (!wert || wert.length > 1000) return null;
	try {
		const f = JSON.parse(Buffer.from(wert, 'base64url').toString('utf8')) as Record<string, unknown>;
		const ok = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(x);
		return ok(f.state) && ok(f.nonce) && ok(f.verifier)
			? { state: f.state as string, nonce: f.nonce as string, verifier: f.verifier as string }
			: null;
	} catch {
		return null;
	}
}

export function gleich(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export type Identitaet = { sub: string; email: string | null; emailBestaetigt: boolean; name: string | null };

/** Prüft ein ID-Token (RS256, Signatur über JWKS, iss/aud/azp/exp/iat/nonce). Wirft bei jedem Fehler. */
export async function pruefeIdToken(
	k: NextcloudKonfig,
	token: string,
	nonce: string,
	jetzt = Date.now()
): Promise<Identitaet> {
	if (!k.anmeldung) throw new NextcloudFehler('Anmeldung über Nextcloud ist aus', 0);
	const d = await discovery(k, jetzt);
	const teile = token.split('.');
	if (teile.length !== 3 || token.length > 16_384) throw new NextcloudFehler('ID-Token ungültig', 0);
	const kopf = JSON.parse(Buffer.from(teile[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string };
	if (kopf.alg !== 'RS256') throw new NextcloudFehler('ID-Token: nur RS256 erlaubt', 0);
	const pruefe = (keys: JsonWebKey[]) => {
		const passend = keys.filter((j) => j.kty === 'RSA' && (!kopf.kid || (j as { kid?: string }).kid === kopf.kid));
		return passend.some((j) => {
			try {
				const { kid: _kid, alg: _alg, use: _use, ...rest } = j as JsonWebKey & { kid?: string; alg?: string; use?: string };
				return verify(
					'RSA-SHA256',
					Buffer.from(`${teile[0]}.${teile[1]}`),
					createPublicKey({ key: rest, format: 'jwk' }),
					Buffer.from(teile[2], 'base64url')
				);
			} catch {
				return false;
			}
		});
	};
	// Schlüsselwechsel in Nextcloud: einmal frisch laden, wenn kein gespeicherter Schlüssel passt
	if (!pruefe(await schluessel(k, d, false, jetzt)) && !pruefe(await schluessel(k, d, true, jetzt))) {
		throw new NextcloudFehler('ID-Token: Signatur ungültig', 0);
	}
	const c = JSON.parse(Buffer.from(teile[1], 'base64url').toString('utf8')) as Record<string, unknown>;
	const s = Math.floor(jetzt / 1000);
	const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
	if (c.iss !== d.issuer) throw new NextcloudFehler('ID-Token: falscher Aussteller', 0);
	if (!aud.includes(k.anmeldung.clientId)) throw new NextcloudFehler('ID-Token: falscher Empfänger', 0);
	if (aud.length > 1 && c.azp !== k.anmeldung.clientId) throw new NextcloudFehler('ID-Token: falscher azp', 0);
	if (typeof c.exp !== 'number' || c.exp + ZEIT_SPIEL_S < s) throw new NextcloudFehler('ID-Token abgelaufen', 0);
	if (typeof c.iat !== 'number' || c.iat - ZEIT_SPIEL_S > s) throw new NextcloudFehler('ID-Token aus der Zukunft', 0);
	if (typeof c.nonce !== 'string' || !gleich(c.nonce, nonce)) throw new NextcloudFehler('ID-Token: nonce passt nicht', 0);
	if (typeof c.sub !== 'string' || c.sub.length < 1 || c.sub.length > 64) throw new NextcloudFehler('ID-Token ohne sub', 0);
	const email = typeof c.email === 'string' && c.email.length <= 254 ? c.email.trim().toLowerCase() : null;
	return {
		sub: c.sub,
		email,
		emailBestaetigt: c.email_verified === true,
		name: typeof c.name === 'string' ? c.name.slice(0, 200) : null
	};
}

/** Code gegen Tokens tauschen (client_secret_basic + PKCE-Verifier) und das ID-Token prüfen. */
export async function tauscheCode(
	k: NextcloudKonfig,
	code: string,
	rueckruf: string,
	flow: FlowDaten
): Promise<Identitaet> {
	if (!k.anmeldung) throw new NextcloudFehler('Anmeldung über Nextcloud ist aus', 0);
	const d = await discovery(k);
	const auth = Buffer.from(
		`${encodeURIComponent(k.anmeldung.clientId)}:${encodeURIComponent(k.anmeldung.clientSecret)}`
	).toString('base64');
	const a = erwarte(
		await ncAnfrage(k, internerPfad(k, d.token_endpoint), {
			methode: 'POST',
			technik: false,
			kopf: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${auth}`, accept: 'application/json' },
			koerper: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: rueckruf,
				code_verifier: flow.verifier
			}).toString()
		}),
		[200],
		'Token-Abruf'
	);
	const j = JSON.parse(a.text) as { id_token?: unknown; access_token?: unknown };
	if (typeof j.id_token !== 'string') throw new NextcloudFehler('Antwort ohne ID-Token', 0);
	const id = await pruefeIdToken(k, j.id_token, flow.nonce);
	// Nextcloud legt E-Mail-Angaben im Code-Flow nur in „userinfo“ ab (OIDC Core 5.3). Dort nur übernehmen, wenn
	// „sub“ genau zum geprüften ID-Token passt (OIDC Core 5.3.2) – sonst bleibt es bei den Angaben des ID-Tokens.
	if (!id.email && d.userinfo_endpoint && typeof j.access_token === 'string' && j.access_token.length < 8192) {
		const u = await ncAnfrage(k, internerPfad(k, d.userinfo_endpoint), {
			technik: false,
			kopf: { authorization: `Bearer ${j.access_token}`, accept: 'application/json' }
		});
		if (u.status === 200) {
			const info = JSON.parse(u.text) as Record<string, unknown>;
			if (info.sub === id.sub && typeof info.email === 'string' && info.email.length <= 254) {
				return { ...id, email: info.email.trim().toLowerCase(), emailBestaetigt: info.email_verified === true };
			}
		}
	}
	return id;
}
