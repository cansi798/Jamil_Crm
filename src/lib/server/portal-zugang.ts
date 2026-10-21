import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { alsOeffentlich, mitBetrieb, OEFFENTLICH, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { erzeugeBegrenzung } from './auth/ratelimit';
import { hashePasswort, pruefePasswort } from './auth/passwort';

/**
 * Zugang zum Kundenportal (Jamil msgs 3035–3037):
 *
 * - **Passwort:** Wer /portal/<Token> öffnet, gibt zuerst das Passwort ein – Standard ist die PLZ des Kunden, auf der
 *   Kundenseite kann ein eigenes gesetzt werden (Argon2id). Danach gilt ein Sitzungs-Cookie NUR für diesen Link
 *   (Pfad /portal/<Token>, httpOnly, secure, sameSite=strict, 30 Tage). Es ist an den Link und an den „Stand“ des
 *   Passworts gebunden: Widerruf des Links oder ein neues Passwort (auch eine geänderte PLZ) machen es ungültig.
 * - **Durchprobieren:** höchstens 5 Fehlversuche je Link in 15 Minuten, dazu eine Grenze je IP; die Meldung verrät
 *   nicht, ob der Link oder das Passwort falsch war. Fehlversuche stehen im Zugriffsprotokoll (portal_ereignisse) –
 *   nie das eingegebene Passwort.
 * - **Link wieder öffnen:** Neue Tokens werden zusätzlich mit AES-256-GCM verschlüsselt gespeichert
 *   (CRM_PORTAL_GEHEIMNIS), damit berechtigte Mitarbeiter den aktiven Link öffnen/kopieren können. Gesucht wird nur
 *   über den SHA-256-Hash.
 */

export const PORTAL_COOKIE = 'kp_sitzung';
export const SITZUNG_TAGE = 30;
const SITZUNG_MS = SITZUNG_TAGE * 24 * 60 * 60 * 1000;

/** Fehlversuche je Link (Token-Hash) und je IP. */
export const anmeldungJeLink = erzeugeBegrenzung({ max: 5, fensterMs: 15 * 60_000 });
export const anmeldungJeIp = erzeugeBegrenzung({ max: 30, fensterMs: 15 * 60_000 });

export const MELDUNG_FALSCH = 'Das Passwort stimmt nicht. Bitte prüfen Sie Ihre Eingabe.';
export const MELDUNG_GESPERRT = 'Zu viele Versuche – bitte warten Sie 15 Minuten und versuchen Sie es dann erneut.';
export const MELDUNG_FEHLT = 'Der Zugang ist noch nicht eingerichtet – bitte wenden Sie sich an Ihren Handwerksbetrieb.';

// ---------------------------------------------------------------------------------------------------------------
// Geheimnis, Verschlüsselung

let warnungGezeigt = false;
let notSchluessel: Buffer | null = null;

/** CRM_PORTAL_GEHEIMNIS (mind. 32 Zeichen) oder null. */
export function portalGeheimnis(env: Record<string, string | undefined> = process.env): string | null {
	const g = env.CRM_PORTAL_GEHEIMNIS?.trim() ?? '';
	if (g.length >= 32) return g;
	if (!warnungGezeigt && !env.VITEST) {
		warnungGezeigt = true;
		console.warn('CRM_PORTAL_GEHEIMNIS fehlt oder ist zu kurz – Portal-Links lassen sich nicht wieder öffnen, Portal-Anmeldungen gelten nur bis zum Neustart.');
	}
	return null;
}

const ableiten = (zweck: string, g: string) => createHash('sha256').update(`${zweck}:${g}`).digest();

/** Schlüssel für die Sitzungs-Signatur (ohne Geheimnis: zufällig je Prozess). */
function sitzungsSchluessel(): Buffer {
	const g = portalGeheimnis();
	if (g) return ableiten('portal-sitzung', g);
	notSchluessel ??= randomBytes(32);
	return notSchluessel;
}

/** Token → iv(12) | tag(16) | Chiffrat; ohne Geheimnis null (dann kein „wieder öffnen“). */
export function verschluesseleToken(token: string, geheimnis = portalGeheimnis()): Buffer | null {
	if (!geheimnis) return null;
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', ableiten('portal-token', geheimnis), iv);
	const daten = Buffer.concat([c.update(token, 'utf8'), c.final()]);
	return Buffer.concat([iv, c.getAuthTag(), daten]);
}

/** Entschlüsselt ein gespeichertes Token; falsches Geheimnis/manipuliert → null. */
export function entschluesseleToken(wert: Uint8Array | null | undefined, geheimnis = portalGeheimnis()): string | null {
	if (!wert || !geheimnis || wert.length < 29) return null;
	try {
		const b = Buffer.from(wert);
		const d = createDecipheriv('aes-256-gcm', ableiten('portal-token', geheimnis), b.subarray(0, 12));
		d.setAuthTag(b.subarray(12, 28));
		return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Passwort und Sitzung

/** PLZ zum Vergleichen: ohne Leerzeichen, Großbuchstaben (z. B. „D-22846“ bleibt, „22846 “ → „22846“). */
export const normalPlz = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * „Stand“ des Zugangs: ändert sich mit jedem neuen Passwort bzw. (ohne eigenes Passwort) mit der PLZ. Steht im Cookie –
 * ein neues Passwort macht so alle Sitzungen ungültig.
 */
export function zugangsStand(passwortHash: string | null, plz: string | null): string {
	return createHash('sha256').update(passwortHash ? `pw:${passwortHash}` : `plz:${normalPlz(plz)}`).digest('base64url').slice(0, 16);
}

const signatur = (linkId: string, ablauf: number, stand: string) =>
	createHmac('sha256', sitzungsSchluessel()).update(`${linkId}|${ablauf}|${stand}`).digest('base64url');

/** Cookie-Wert `v1.<ablauf>.<stand>.<signatur>` – an Link und Zugangsstand gebunden. */
export function sitzungsWert(linkId: string, stand: string, jetzt = Date.now()): { wert: string; ablauf: Date } {
	const ablauf = jetzt + SITZUNG_MS;
	return { wert: `v1.${ablauf}.${stand}.${signatur(linkId, ablauf, stand)}`, ablauf: new Date(ablauf) };
}

export function pruefeSitzungsWert(wert: string | undefined, linkId: string, stand: string, jetzt = Date.now()): boolean {
	if (!wert) return false;
	const t = wert.split('.');
	if (t.length !== 4 || t[0] !== 'v1' || !/^\d{10,16}$/.test(t[1])) return false;
	const ablauf = Number(t[1]);
	if (ablauf <= jetzt || t[2] !== stand) return false;
	const erwartet = Buffer.from(signatur(linkId, ablauf, stand));
	const gegeben = Buffer.from(t[3]);
	return erwartet.length === gegeben.length && timingSafeEqual(erwartet, gegeben);
}

/** Cookie-Optionen: nur dieser Portal-Link. */
export const cookieOptionen = (token: string, ablauf: Date) => ({
	path: `/portal/${token}`,
	httpOnly: true,
	secure: true,
	sameSite: 'strict' as const,
	expires: ablauf
});

type LinkKontext = { linkId: string; betriebId: string; kundeId: string | null; hash: Buffer };

/** PLZ und eigenes Passwort des Kunden zum Link (öffentlicher Kontext, RLS auf den Betrieb). */
async function zugangsDaten(p: LinkKontext): Promise<{ plz: string | null; hash: string | null }> {
	if (!p.kundeId) return { plz: null, hash: null };
	return alsOeffentlich(p.betriebId, 'kundenportal', () =>
		mitBetrieb({ betriebId: p.betriebId, benutzerId: OEFFENTLICH }, async (tx) => {
			const [z] = await tx`
				select k.plz, pw.passwort_hash from app.kunden k
				left join app.portal_passwoerter pw on pw.kunde_id = k.id and pw.betrieb_id = k.betrieb_id
				where k.id = ${p.kundeId} and k.betrieb_id = ${p.betriebId}`;
			return { plz: (z?.plz as string | null) ?? null, hash: (z?.passwort_hash as string | null) ?? null };
		})
	);
}

/** Gilt das Cookie für diesen (noch gültigen) Link? */
export async function sitzungGueltig(token: string, wert: string | undefined, ip: string): Promise<boolean> {
	if (!wert) return false;
	const { loeseAuf } = await import('./kundenportal-oeffentlich');
	const p = await loeseAuf(token, ip);
	if (!p) return false;
	const z = await zugangsDaten(p);
	return pruefeSitzungsWert(wert, p.linkId, zugangsStand(z.hash, z.plz));
}

async function protokolliere(p: LinkKontext, art: 'anmeldung' | 'anmeldung_fehler', ip: string): Promise<void> {
	const { ipHash } = await import('./kundenportal-oeffentlich');
	await alsOeffentlich(p.betriebId, 'kundenportal', () =>
		mitBetrieb({ betriebId: p.betriebId, benutzerId: OEFFENTLICH }, (tx) => tx`
			insert into app.portal_ereignisse (betrieb_id, link_id, art, text, ip_hash)
			values (${p.betriebId}, ${p.linkId}, ${art}, ${art === 'anmeldung' ? 'Anmeldung im Kundenportal' : 'Falsches Passwort im Kundenportal'}, ${ipHash(ip)})`)
	);
}

export type AnmeldeErgebnis = { ok: true; wert: string; ablauf: Date } | { ok: false; grund: 'falsch' | 'gesperrt' | 'fehlt' | 'ungueltig' };

/**
 * Passwort prüfen. Jeder Versuch zählt (vor der Prüfung) gegen die Grenzen je Link und je IP; Erfolg setzt die
 * Zählung des Links zurück. Ungültiger Link → `ungueltig` (die Seite zeigt dann 404).
 */
export async function anmelden(token: string, eingabe: unknown, ip: string): Promise<AnmeldeErgebnis> {
	const { loeseAuf } = await import('./kundenportal-oeffentlich');
	const p = await loeseAuf(token, ip);
	if (!p) return { ok: false, grund: 'ungueltig' };
	const schluessel = p.hash.toString('hex');
	if (!anmeldungJeIp.pruefeVersuch(`ip:${ip}`).erlaubt || !anmeldungJeLink.pruefeVersuch(schluessel).erlaubt) {
		console.warn(`Kundenportal: Anmeldung gesperrt (Link ${p.linkId.slice(0, 8)}…, zu viele Versuche)`);
		return { ok: false, grund: 'gesperrt' };
	}
	const passwort = typeof eingabe === 'string' ? eingabe.trim().slice(0, 200) : '';
	const z = await zugangsDaten(p);
	let richtig = false;
	if (z.hash) richtig = passwort !== '' && (await pruefePasswort(z.hash, passwort));
	else if (normalPlz(z.plz) !== '') {
		const a = Buffer.from(normalPlz(passwort));
		const b = Buffer.from(normalPlz(z.plz));
		richtig = a.length === b.length && timingSafeEqual(a, b);
	} else {
		return { ok: false, grund: 'fehlt' };
	}
	if (!richtig) {
		console.warn(`Kundenportal: falsches Passwort (Link ${p.linkId.slice(0, 8)}…)`);
		await protokolliere(p, 'anmeldung_fehler', ip).catch(() => {});
		return { ok: false, grund: 'falsch' };
	}
	anmeldungJeLink.zuruecksetzen(schluessel);
	await protokolliere(p, 'anmeldung', ip).catch(() => {});
	return { ok: true, ...sitzungsWert(p.linkId, zugangsStand(z.hash, z.plz)) };
}

/** Name, Farbe und Erscheinungsbild für die Passwort-Seite (nur mit gültigem Link). */
export async function portalAussehen(token: string, ip: string): Promise<{ name: string; farbe: string | null; dunkel: string | null; hintergrund: string | null } | null> {
	const { loeseAuf } = await import('./kundenportal-oeffentlich');
	const p = await loeseAuf(token, ip);
	if (!p) return null;
	return alsOeffentlich(p.betriebId, 'kundenportal', () =>
		mitBetrieb({ betriebId: p.betriebId, benutzerId: OEFFENTLICH }, async (tx) => {
			const [b] = await tx`
				select coalesce(pr.firmenname, be.name) as name, pr.farbe, pr.dunkel_farbe, pr.hintergrund_farbe
				from app.betriebe be left join app.betrieb_profil pr on pr.betrieb_id = be.id where be.id = ${p.betriebId}`;
			return { name: b.name, farbe: b.farbe ?? null, dunkel: b.dunkel_farbe ?? null, hintergrund: b.hintergrund_farbe ?? null };
		})
	);
}

// ---------------------------------------------------------------------------------------------------------------
// Verwaltung (Kundenseite)

export type PortalPasswortStand = { eigenes: boolean; geaendert: string | null; plz: string | null };

export async function passwortStand(tx: TransactionSql, k: Kontext, kundeId: string): Promise<PortalPasswortStand> {
	const [z] = await tx`
		select k.plz, pw.geaendert from app.kunden k
		left join app.portal_passwoerter pw on pw.kunde_id = k.id and pw.betrieb_id = k.betrieb_id
		where k.id = ${kundeId} and k.betrieb_id = ${k.betriebId}`;
	return { eigenes: !!z?.geaendert, geaendert: z?.geaendert ? new Date(z.geaendert).toISOString() : null, plz: normalPlz(z?.plz) || null };
}

export const MIN_PASSWORT = 6;

/** Eigenes Passwort setzen (`passwort`) oder auf die PLZ zurücksetzen (`null`). Rechte prüft der Aufrufer. */
export async function setzePortalPasswort(k: Kontext, kundeId: string, passwort: string | null): Promise<void> {
	if (passwort === null) {
		await mitBetrieb(k, (tx) => tx`delete from app.portal_passwoerter where kunde_id = ${kundeId} and betrieb_id = ${k.betriebId}`);
		return;
	}
	const p = passwort.trim();
	if ([...p].length < MIN_PASSWORT) throw new ApiFehler(400, `Das Passwort braucht mindestens ${MIN_PASSWORT} Zeichen.`);
	if ([...p].length > 100) throw new ApiFehler(400, 'Das Passwort ist zu lang (höchstens 100 Zeichen).');
	const hash = await hashePasswort(p);
	await mitBetrieb(k, (tx) => tx`
		insert into app.portal_passwoerter (kunde_id, betrieb_id, passwort_hash, geaendert_von)
		values (${kundeId}, ${k.betriebId}, ${hash}, ${k.benutzerId})
		on conflict (kunde_id) do update set passwort_hash = excluded.passwort_hash, geaendert = now(), geaendert_von = excluded.geaendert_von`);
}
