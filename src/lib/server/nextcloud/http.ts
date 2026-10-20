import type { NextcloudKonfig } from './konfig';

/**
 * Alle Anfragen an Nextcloud laufen hier durch:
 * - nur an die konfigurierte (interne) Nextcloud-Adresse, Pfade werden nie aus Benutzereingaben zusammengesetzt,
 *   ohne vorher jeden Teil zu kodieren (`pfadTeil`),
 * - keine Weiterleitungen (redirect: 'manual'), feste Zeitgrenze, Antwortgröße begrenzt,
 * - Zugangsdaten nur im Authorization-Kopf; Fehlermeldungen nennen Methode, Pfad und Status – nie Kopfzeilen,
 *   Tokens oder Antworttexte.
 */

export class NextcloudFehler extends Error {
	constructor(
		meldung: string,
		readonly status: number
	) {
		super(meldung);
		this.name = 'NextcloudFehler';
	}
}

export const MAX_ANTWORT = 5 * 1024 * 1024;

export type Antwort = { status: number; text: string; kopf: Headers };

/** Ein Pfad-Teil für DAV-Adressen: kodiert, nie „.“/„..“, keine Schrägstriche. */
export function pfadTeil(t: string): string {
	const s = t.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim().slice(0, 200) || '_';
	if (s === '.' || s === '..') return '_';
	return encodeURIComponent(s);
}

type Optionen = {
	methode?: string;
	kopf?: Record<string, string>;
	koerper?: string | Uint8Array;
	/** Technik-Konto (Basic-Auth mit App-Passwort) – Standard ja. */
	technik?: boolean;
	zeitMs?: number;
};

type Abrufer = typeof fetch;
let abrufer: Abrufer = (...a) => fetch(...a);
/** Nur Tests: anderer fetch (ohne Netz). */
export const setzeAbrufer = (f: Abrufer | null) => (abrufer = f ?? ((...a) => fetch(...a)));

/** Anfrage an `internUrl + pfad` (pfad beginnt mit „/“). */
export async function ncAnfrage(k: NextcloudKonfig, pfad: string, o: Optionen = {}): Promise<Antwort> {
	if (!pfad.startsWith('/') || pfad.includes('/../') || pfad.includes('://')) throw new Error('Ungültiger Nextcloud-Pfad');
	const kopf: Record<string, string> = { 'user-agent': 'CRM-Nextcloud-Anbindung', ...o.kopf };
	if (o.technik !== false) {
		if (!k.technik) throw new NextcloudFehler('Technik-Konto fehlt', 0);
		kopf.authorization = `Basic ${Buffer.from(`${k.technik.benutzer}:${k.technik.token}`).toString('base64')}`;
	}
	const methode = o.methode ?? 'GET';
	let r: Response;
	try {
		r = await abrufer(`${k.internUrl}${pfad}`, {
			method: methode,
			headers: kopf,
			body: o.koerper as BodyInit | undefined,
			redirect: 'manual',
			signal: AbortSignal.timeout(o.zeitMs ?? 20_000)
		});
	} catch (e) {
		throw new NextcloudFehler(`Nextcloud nicht erreichbar (${methode} ${kurz(pfad)}): ${(e as Error).name}`, 0);
	}
	const text = await leseBegrenzt(r);
	return { status: r.status, text, kopf: r.headers };
}

async function leseBegrenzt(r: Response): Promise<string> {
	const laenge = Number(r.headers.get('content-length') ?? '0');
	if (laenge > MAX_ANTWORT) {
		await r.body?.cancel().catch(() => undefined);
		throw new NextcloudFehler('Antwort von Nextcloud zu groß', r.status);
	}
	const puffer = await r.arrayBuffer();
	if (puffer.byteLength > MAX_ANTWORT) throw new NextcloudFehler('Antwort von Nextcloud zu groß', r.status);
	return new TextDecoder().decode(puffer);
}

/** Pfad für Meldungen: ohne Abfrageteil, gekürzt (keine Codes/Tokens im Log). */
export const kurz = (pfad: string) => pfad.split('?')[0].slice(0, 120);

/** Erwartet einen der Status, sonst NextcloudFehler (ohne Antworttext). */
export function erwarte(a: Antwort, erlaubt: number[], was: string): Antwort {
	if (!erlaubt.includes(a.status)) throw new NextcloudFehler(`${was}: Nextcloud antwortet ${a.status}`, a.status);
	return a;
}
