import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leseKonfig, pruefeUrl, type NextcloudKonfig } from '../../src/lib/server/nextcloud/konfig';
import { falte, ical, maskiere, sichererName, vcard } from '../../src/lib/server/nextcloud/formate';
import {
	discovery,
	flowCookieWert,
	internerPfad,
	leereOidcZwischenspeicher,
	liesFlowCookie,
	pkceChallenge,
	pruefeIdToken,
	startAdresse,
	tauscheCode
} from '../../src/lib/server/nextcloud/oidc';
import { kurz, pfadTeil, setzeAbrufer } from '../../src/lib/server/nextcloud/http';
import { kalenderUri } from '../../src/lib/server/nextcloud/dav';
import { talkText } from '../../src/lib/server/nextcloud/melden';

const URL_NC = 'https://cloud.beispiel.de';

describe('Nextcloud-Konfiguration', () => {
	it('ohne NEXTCLOUD_URL ist alles aus', () => {
		expect(leseKonfig({})).toBeNull();
		expect(leseKonfig({ NEXTCLOUD_URL: '  ', NEXTCLOUD_ANMELDUNG: 'ja' })).toBeNull();
	});
	it('https Pflicht, http nur localhost bzw. intern; keine Zugangsdaten in der Adresse', () => {
		expect(pruefeUrl('https://cloud.beispiel.de/', false)).toBe(URL_NC);
		expect(pruefeUrl('http://localhost:8080', false)).toBe('http://localhost:8080');
		expect(() => pruefeUrl('http://cloud.beispiel.de', false)).toThrow(/https/);
		expect(pruefeUrl('http://nextcloud', true)).toBe('http://nextcloud');
		expect(() => pruefeUrl('https://a:b@cloud.beispiel.de', false)).toThrow();
		expect(() => pruefeUrl('ftp://x', true)).toThrow();
	});
	it('Anmeldung braucht Client-ID und Secret; Abgleich braucht Technik-Konto', () => {
		expect(() => leseKonfig({ NEXTCLOUD_URL: URL_NC, NEXTCLOUD_ANMELDUNG: 'ja' })).toThrow(/CLIENT_ID/);
		expect(() => leseKonfig({ NEXTCLOUD_URL: URL_NC, NEXTCLOUD_KALENDER: 'ja' })).toThrow(/TECHNIK/);
		const k = leseKonfig({
			NEXTCLOUD_URL: URL_NC,
			NEXTCLOUD_ANMELDUNG: 'ja',
			NEXTCLOUD_OIDC_CLIENT_ID: 'id',
			NEXTCLOUD_OIDC_CLIENT_SECRET: 'geheim',
			NEXTCLOUD_TECHNIK_BENUTZER: 'crm-sync',
			NEXTCLOUD_TECHNIK_APP_TOKEN: 'tok',
			NEXTCLOUD_KONTAKTE: 'ja',
			NEXTCLOUD_KONTAKTE_GRUPPE: 'Team',
			NEXTCLOUD_DATEIEN: 'ja'
		})!;
		expect(k.anmeldung).toMatchObject({ zweiFaktorVertrauen: false, perEmail: true });
		expect(k.kontakte).toEqual({ gruppe: 'Team' });
		expect(k.dateien).toEqual({ ordner: 'CRM' });
		expect(k.kalender).toBe(false);
		expect(k.internUrl).toBe(URL_NC);
	});
	it('Ordner ohne .. und Betrieb nur als UUID', () => {
		const basis = { NEXTCLOUD_URL: URL_NC, NEXTCLOUD_TECHNIK_BENUTZER: 'a', NEXTCLOUD_TECHNIK_APP_TOKEN: 'b', NEXTCLOUD_DATEIEN: 'ja' };
		expect(() => leseKonfig({ ...basis, NEXTCLOUD_DATEIEN_ORDNER: 'CRM/../Privat' })).toThrow();
		expect(leseKonfig({ ...basis, NEXTCLOUD_DATEIEN_ORDNER: '/CRM/Ablage/' })!.dateien).toEqual({ ordner: 'CRM/Ablage' });
		expect(() => leseKonfig({ ...basis, NEXTCLOUD_BETRIEB: 'abc' })).toThrow(/UUID/);
	});
});

describe('Formate', () => {
	it('maskiert iCal/vCard-Texte (keine Eigenschafts-Injektion)', () => {
		expect(maskiere('a;b,c\\d\nEND:VEVENT')).toBe('a\\;b\\,c\\\\d\\nEND:VEVENT');
		expect(maskiere('x\u0000y\u0007')).toBe('xy');
	});
	it('faltet nach 75 Oktetten, ohne UTF-8 zu zerschneiden', () => {
		const z = falte(`SUMMARY:${'ä'.repeat(100)}`);
		for (const zeile of z.split('\r\n')) expect(Buffer.byteLength(zeile)).toBeLessThanOrEqual(75);
		expect(z.split('\r\n').map((t, i) => (i ? t.slice(1) : t)).join('')).toBe(`SUMMARY:${'ä'.repeat(100)}`);
	});
	it('iCal mit fester UID, UTC-Zeiten, Ort und ohne eingeschleuste Zeilen', () => {
		const t = ical({
			uid: 'crm-einsatz-1',
			titel: 'Bad\r\nEND:VEVENT\r\nBEGIN:VEVENT',
			beginn: new Date('2026-10-21T07:00:00Z'),
			ende: new Date('2026-10-21T15:00:00Z'),
			ort: 'Hauptstr. 1, 22844 Norderstedt',
			geaendert: new Date('2026-10-20T10:00:00Z')
		});
		expect(t).toContain('UID:crm-einsatz-1\r\n');
		expect(t).toContain('DTSTART:20261021T070000Z');
		expect(t.split('\r\n').filter((l) => l === 'BEGIN:VEVENT' || l === 'END:VEVENT')).toHaveLength(2);
		expect(t).toContain('LOCATION:Hauptstr. 1\\, 22844 Norderstedt');
		// gleiche Daten → gleicher Inhalt (Prüfsumme stabil)
		expect(t).toBe(ical({ uid: 'crm-einsatz-1', titel: 'Bad\r\nEND:VEVENT\r\nBEGIN:VEVENT', beginn: new Date('2026-10-21T07:00:00Z'), ende: new Date('2026-10-21T15:00:00Z'), ort: 'Hauptstr. 1, 22844 Norderstedt', geaendert: new Date('2026-10-20T10:00:00Z') }));
	});
	it('vCard für Firma und Person', () => {
		const f = vcard({ uid: 'crm-kunde-1', firma: 'Bäckerei Krümel', email: 'a@b.de', strasse: 'Weg 2', plz: '22844', ort: 'Norderstedt', geaendert: new Date(0) });
		expect(f).toContain('FN:Bäckerei Krümel');
		expect(f).toContain('ORG:Bäckerei Krümel');
		expect(f).toContain('ADR;TYPE=WORK:;;Weg 2;Norderstedt;;22844;');
		const p = vcard({ uid: 'crm-kunde-2', vorname: 'Max', nachname: 'Muster', anrede: 'Herr', geaendert: new Date(0) });
		expect(p).toContain('FN:Max Muster');
		expect(p).toContain('N:Muster;Max;;Herr;');
	});
	it('sichere Datei- und Ordnernamen', () => {
		expect(sichererName('../../etc/passwd')).toBe('_.._etc_passwd');
		expect(sichererName('  ')).toBe('Unbenannt');
		expect(sichererName('Müller & Söhne GmbH')).toBe('Müller & Söhne GmbH');
		expect(pfadTeil('..')).toBe('_');
		expect(pfadTeil('a/b')).toBe('a%20b');
		expect(kurz('/x?code=geheim')).toBe('/x');
		expect(kalenderUri('Can Siebert')).toMatch(/^crm-einsaetze-[0-9a-f]{16}$/);
	});
	it('Talk-Text mit Link', () => {
		expect(talkText({ titel: 'Aufgabe: X', text: 'Fällig Mo', link: '/todos' }, 'https://crm.x.de')).toBe('🔔 Aufgabe: X\nFällig Mo\nhttps://crm.x.de/todos');
	});
});

describe('OIDC (Authorization Code + PKCE, ID-Token über JWKS)', () => {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const fremd = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
	const k: NextcloudKonfig = {
		url: URL_NC,
		internUrl: 'http://nextcloud',
		betrieb: null,
		anmeldung: { clientId: 'crm-client', clientSecret: 'geheim', zweiFaktorVertrauen: true, perEmail: true },
		technik: null,
		kalender: false,
		kontakte: null,
		dateien: null,
		talk: false,
		intervallMinuten: 5
	};
	const disco = {
		issuer: URL_NC,
		authorization_endpoint: `${URL_NC}/index.php/apps/oidc/authorize`,
		token_endpoint: `${URL_NC}/index.php/apps/oidc/token`,
		jwks_uri: `${URL_NC}/index.php/apps/oidc/jwks`,
		userinfo_endpoint: `${URL_NC}/index.php/apps/oidc/userinfo`
	};
	let userinfo: Record<string, unknown> = {};
	const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const jetzt = Math.floor(Date.now() / 1000);
	const token = (claims: Record<string, unknown>, kopf: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }, schl = privateKey) => {
		const daten = `${b64(kopf)}.${b64({ iss: URL_NC, aud: 'crm-client', sub: 'max', exp: jetzt + 300, iat: jetzt, nonce: 'n'.repeat(43), ...claims })}`;
		return `${daten}.${sign('RSA-SHA256', Buffer.from(daten), schl).toString('base64url')}`;
	};
	let anfragen: { url: string; init: RequestInit }[] = [];
	let tokenAntwort: unknown = {};

	beforeEach(() => {
		leereOidcZwischenspeicher();
		anfragen = [];
		setzeAbrufer((async (url: string, init: RequestInit) => {
			anfragen.push({ url, init });
			if (url.endsWith('/.well-known/openid-configuration')) return new Response(JSON.stringify(disco));
			if (url.endsWith('/jwks')) return new Response(JSON.stringify({ keys: [jwk] }));
			if (url.endsWith('/token')) return new Response(JSON.stringify(tokenAntwort));
			if (url.endsWith('/userinfo')) return new Response(JSON.stringify(userinfo));
			return new Response('nein', { status: 404 });
		}) as typeof fetch);
	});
	afterEach(() => setzeAbrufer(null));

	it('Discovery: Aussteller muss NEXTCLOUD_URL sein, Endpunkte darunter; interne Adresse wird benutzt', async () => {
		await discovery(k);
		expect(anfragen[0].url).toBe('http://nextcloud/index.php/.well-known/openid-configuration');
		expect(internerPfad(k, disco.token_endpoint)).toBe('/index.php/apps/oidc/token');
		expect(() => internerPfad(k, 'https://boese.de/token')).toThrow();
		expect(() => internerPfad(k, `${URL_NC}.boese.de/token`)).toThrow();
		leereOidcZwischenspeicher();
		await expect(discovery({ ...k, url: 'https://andere.de' })).rejects.toThrow(/Aussteller/);
	});

	it('Start-Adresse mit PKCE S256, state und nonce', async () => {
		const { adresse, flow } = await startAdresse(k, 'https://crm.x.de/anmelden/nextcloud/rueckruf');
		const u = new URL(adresse);
		expect(u.origin + u.pathname).toBe(disco.authorization_endpoint);
		expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge(flow.verifier));
		expect(u.searchParams.get('code_challenge_method')).toBe('S256');
		expect(u.searchParams.get('state')).toBe(flow.state);
		expect(u.searchParams.get('nonce')).toBe(flow.nonce);
		expect(u.searchParams.get('scope')).toBe('openid profile email');
		expect(liesFlowCookie(flowCookieWert(flow))).toEqual(flow);
		expect(liesFlowCookie('kaputt')).toBeNull();
		// RFC 7636 Anhang B
		expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	it('gültiges ID-Token → Identität (E-Mail nur mit email_verified bestätigt)', async () => {
		const id = await pruefeIdToken(k, token({ email: 'Max@Beispiel.de', email_verified: true, name: 'Max' }), 'n'.repeat(43));
		expect(id).toEqual({ sub: 'max', email: 'max@beispiel.de', emailBestaetigt: true, name: 'Max' });
		const ohne = await pruefeIdToken(k, token({ email: 'max@beispiel.de' }), 'n'.repeat(43));
		expect(ohne.emailBestaetigt).toBe(false);
	});

	it.each([
		['falscher Aussteller', () => token({ iss: 'https://boese.de' }), /Aussteller/],
		['falscher Empfänger', () => token({ aud: 'anderer' }), /Empfänger/],
		['mehrere Empfänger ohne azp', () => token({ aud: ['crm-client', 'x'] }), /azp/],
		['abgelaufen', () => token({ exp: jetzt - 600 }), /abgelaufen/],
		['aus der Zukunft', () => token({ iat: jetzt + 600 }), /Zukunft/],
		['falsche nonce', () => token({ nonce: 'x'.repeat(43) }), /nonce/],
		['fremder Schlüssel', () => token({}, { alg: 'RS256', kid: 'k1' }, fremd.privateKey), /Signatur/],
		['alg none', () => `${b64({ alg: 'none' })}.${b64({ iss: URL_NC })}.`, /RS256/],
		['HS256', () => token({}, { alg: 'HS256', kid: 'k1' }), /RS256/],
		['ohne sub', () => token({ sub: '' }), /sub/]
	])('abgelehnt: %s', async (_name, erzeuge, fehler) => {
		await expect(pruefeIdToken(k, erzeuge(), 'n'.repeat(43))).rejects.toThrow(fehler);
	});

	it('Code-Tausch: client_secret_basic + code_verifier an den internen Token-Endpunkt, ohne Weiterleitungen', async () => {
		tokenAntwort = { id_token: token({}), access_token: 'a', token_type: 'Bearer' };
		const flow = { state: 's'.repeat(43), nonce: 'n'.repeat(43), verifier: 'v'.repeat(43) };
		const id = await tauscheCode(k, 'CODE', 'https://crm.x.de/anmelden/nextcloud/rueckruf', flow);
		expect(id.sub).toBe('max');
		const t = anfragen.find((a) => a.url.endsWith('/token'))!;
		expect(t.url).toBe('http://nextcloud/index.php/apps/oidc/token');
		expect(t.init.redirect).toBe('manual');
		const body = new URLSearchParams(String(t.init.body));
		expect(body.get('code_verifier')).toBe('v'.repeat(43));
		expect(body.get('grant_type')).toBe('authorization_code');
		expect((t.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('crm-client:geheim').toString('base64')}`);
		tokenAntwort = { access_token: 'a' };
		await expect(tauscheCode(k, 'CODE', 'x', flow)).rejects.toThrow(/ID-Token/);
	});

	it('E-Mail aus userinfo nur, wenn sub zum ID-Token passt (Bearer an den internen Endpunkt)', async () => {
		const flow = { state: 's'.repeat(43), nonce: 'n'.repeat(43), verifier: 'v'.repeat(43) };
		tokenAntwort = { id_token: token({}), access_token: 'zugang' };
		userinfo = { sub: 'max', email: 'Max@Firma.de', email_verified: true };
		expect(await tauscheCode(k, 'CODE', 'x', flow)).toMatchObject({ email: 'max@firma.de', emailBestaetigt: true });
		const ui = anfragen.find((a) => a.url.endsWith('/userinfo'))!;
		expect(ui.url).toBe('http://nextcloud/index.php/apps/oidc/userinfo');
		expect((ui.init.headers as Record<string, string>).authorization).toBe('Bearer zugang');
		userinfo = { sub: 'jemand-anders', email: 'chef@firma.de', email_verified: true };
		expect(await tauscheCode(k, 'CODE', 'x', flow)).toMatchObject({ email: null, emailBestaetigt: false });
		// steht die E-Mail schon im ID-Token, wird userinfo nicht gefragt
		anfragen = [];
		tokenAntwort = { id_token: token({ email: 'a@b.de', email_verified: false }), access_token: 'zugang' };
		expect(await tauscheCode(k, 'CODE', 'x', flow)).toMatchObject({ email: 'a@b.de', emailBestaetigt: false });
		expect(anfragen.some((a) => a.url.endsWith('/userinfo'))).toBe(false);
	});
});
