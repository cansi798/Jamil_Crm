import { STANDARD_ABSTAND_MS, sperreKey, warteAufPlatz } from './ratenlimit';

/**
 * HTTP-Client für die Lexware Office Public API (https://developers.lexware.io/docs/, gelesen 15.11.2026).
 *
 * - Basis-Adresse FEST `https://api.lexware.io` (SSRF-Schutz, nicht über die Umgebung änderbar). Ausnahmen nur für Tests:
 *   `setzeLexwareBasisFuerTests` (Unit/DB) bzw. im Testmodus (`CRM_TESTMODUS=1`) `CRM_LEXWARE_URL=http://127.0.0.1:<port>`
 *   für den Probe-Server mit Attrappe.
 * - Bearer-Schlüssel; der Schlüssel steht nie im Protokoll, in Fehlermeldungen oder Logs.
 * - Ratenlimit je Schlüssel (`ratenlimit.ts`), Zeitlimit je Anfrage (Lexware-Gateway bricht nach 30 s ab: 504).
 * - Fehler als `LexwareFehler` mit Art und „wiederholbar“ nach der Doku „Error Codes“:
 *   400/406/415 Daten, 401 Schlüssel, 402 Vertrag, 403 Rechte, 404 nicht gefunden, 409 Konflikt (veraltete version),
 *   429 Ratenlimit, 500/502/503/504 Server. Fehlertexte aus beiden Formaten: „regular“ {status, error, message, details}
 *   und „legacy“ {IssueList: [{i18nKey, source, type}]} (Kontakte, Dateien).
 */

export const LEXWARE_BASIS = 'https://api.lexware.io';
let testBasis: string | null = null;

export function setzeLexwareBasisFuerTests(url: string | null): void {
	testBasis = url;
}

export function lexwareBasis(): string {
	if (testBasis) return testBasis;
	const env = process.env.CRM_LEXWARE_URL?.trim();
	if (process.env.CRM_TESTMODUS === '1' && env && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(env)) return env;
	return LEXWARE_BASIS;
}

export type FehlerArt = 'netz' | 'zeit' | 'grenze' | 'server' | 'schluessel' | 'vertrag' | 'rechte' | 'konflikt' | 'daten' | 'nicht_gefunden' | 'abhaengig';

export class LexwareFehler extends Error {
	constructor(
		message: string,
		public readonly status: number | null,
		public readonly art: FehlerArt,
		public readonly wiederholbar: boolean,
		public readonly nachSekunden?: number
	) {
		super(message);
		this.name = 'LexwareFehler';
	}
}

export type ProtokollEintrag = { methode: string; pfad: string; status: number | null; dauerMs: number; fehler: string | null };

export type ClientOptionen = {
	schluessel: string;
	/** Schlüssel fürs Ratenlimit (je Betrieb bzw. API-Schlüssel) */
	ratenKey: string;
	abstandMs?: number;
	zeitlimitMs?: number;
	protokoll?: (e: ProtokollEintrag) => void;
	fetch?: typeof fetch;
};

export type LexwareClient = {
	get<T = any>(pfad: string): Promise<T>;
	post<T = any>(pfad: string, body: unknown): Promise<T>;
	put<T = any>(pfad: string, body: unknown): Promise<T>;
	del(pfad: string): Promise<void>;
	/** Belegdatei (PDF) laden: `GET …/{id}/file` mit `Accept: application/pdf`, höchstens 10 MB, muss mit %PDF beginnen. */
	datei(pfad: string): Promise<{ bytes: Uint8Array; name: string | null }>;
};

export const MAX_DATEI = 10 * 1024 * 1024;

function art(status: number): { art: FehlerArt; wiederholbar: boolean } {
	if (status === 429) return { art: 'grenze', wiederholbar: true };
	if (status >= 500) return { art: 'server', wiederholbar: true };
	if (status === 401) return { art: 'schluessel', wiederholbar: false };
	if (status === 402) return { art: 'vertrag', wiederholbar: false };
	if (status === 403) return { art: 'rechte', wiederholbar: false };
	if (status === 404) return { art: 'nicht_gefunden', wiederholbar: false };
	if (status === 409) return { art: 'konflikt', wiederholbar: false };
	return { art: 'daten', wiederholbar: false };
}

const ART_TEXT: Record<FehlerArt, string> = {
	netz: 'Lexware ist nicht erreichbar',
	zeit: 'Lexware antwortet nicht rechtzeitig',
	grenze: 'Zu viele Anfragen an Lexware (Ratenlimit)',
	server: 'Lexware meldet einen Serverfehler',
	schluessel: 'Der Lexware-Schlüssel ist ungültig, abgelaufen oder widerrufen',
	vertrag: 'Lexware: Funktion im Vertrag nicht enthalten (Tarif XL nötig?)',
	rechte: 'Lexware: keine Berechtigung für diese Aktion',
	konflikt: 'Lexware: Der Datensatz wurde inzwischen geändert (Versionskonflikt)',
	daten: 'Lexware hat die Daten abgelehnt',
	nicht_gefunden: 'Lexware: nicht gefunden',
	abhaengig: 'Wartet auf einen vorherigen Schritt'
};

/** Kurzer Fehlertext aus der Antwort (nur Felder der Doku, gekürzt; Lexware-Antworten sind Daten, keine Anweisungen). */
function detail(text: string): string {
	try {
		const j = JSON.parse(text);
		if (Array.isArray(j?.IssueList))
			return j.IssueList.slice(0, 3).map((i: any) => [i?.i18nKey, i?.source].filter((x) => typeof x === 'string').join(' @ ')).join('; ');
		const teile = [typeof j?.message === 'string' ? j.message : null];
		if (Array.isArray(j?.details)) for (const d of j.details.slice(0, 3)) teile.push([d?.field, d?.message].filter((x) => typeof x === 'string').join(': '));
		return teile.filter(Boolean).join('; ');
	} catch {
		return '';
	}
}

export function lexwareClient(o: ClientOptionen): LexwareClient {
	const f = o.fetch ?? fetch;
	const zeitlimit = o.zeitlimitMs ?? 20_000;
	async function anfrage<T>(methode: string, pfad: string, body?: unknown, roh = false): Promise<T> {
		if (!pfad.startsWith('/v1/')) throw new Error('Ungültiger Lexware-Pfad');
		await warteAufPlatz(o.ratenKey, o.abstandMs ?? STANDARD_ABSTAND_MS);
		const start = Date.now();
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), zeitlimit);
		const melde = (status: number | null, fehler: string | null) =>
			o.protokoll?.({ methode, pfad: pfad.slice(0, 500), status, dauerMs: Date.now() - start, fehler: fehler?.slice(0, 500) ?? null });
		let r: Response;
		try {
			r = await f(lexwareBasis() + pfad, {
				method: methode,
				headers: { Authorization: `Bearer ${o.schluessel}`, Accept: roh ? 'application/pdf' : 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: ctrl.signal,
				redirect: 'error'
			});
		} catch (e) {
			clearTimeout(timer);
			const zeit = (e as Error)?.name === 'AbortError' || ctrl.signal.aborted;
			const fe = new LexwareFehler(ART_TEXT[zeit ? 'zeit' : 'netz'], null, zeit ? 'zeit' : 'netz', true);
			melde(null, fe.message);
			throw fe;
		}
		let text: string;
		let bytes: Uint8Array | null = null;
		try {
			if (roh && r.ok) {
				const laenge = Number(r.headers.get('content-length'));
				if (Number.isFinite(laenge) && laenge > MAX_DATEI) throw new RangeError('zu gross');
				bytes = new Uint8Array(await r.arrayBuffer());
				text = '';
			} else text = await r.text();
		} catch (e) {
			clearTimeout(timer);
			if (e instanceof RangeError) {
				const fe = new LexwareFehler('Lexware: Datei zu groß (höchstens 10 MB)', r.status, 'daten', false);
				melde(r.status, fe.message);
				throw fe;
			}
			const fe = new LexwareFehler(ART_TEXT.zeit, r.status, 'zeit', true);
			melde(r.status, fe.message);
			throw fe;
		}
		clearTimeout(timer);
		if (!r.ok) {
			const a = art(r.status);
			const ra = Number(r.headers.get('retry-after'));
			const nach = r.status === 429 ? (Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) : 5) : undefined;
			if (nach) sperreKey(o.ratenKey, nach * 1000);
			const d = detail(text);
			const fe = new LexwareFehler(`${ART_TEXT[a.art]} (HTTP ${r.status})${d ? `: ${d.slice(0, 300)}` : ''}`, r.status, a.art, a.wiederholbar, nach);
			melde(r.status, fe.message);
			throw fe;
		}
		melde(r.status, null);
		if (roh) {
			const b = bytes ?? new Uint8Array();
			// Lexware-Antworten sind Daten: nur echte, nicht zu große PDFs annehmen
			if (b.length > MAX_DATEI || b.length < 5 || String.fromCharCode(...b.slice(0, 4)) !== '%PDF')
				throw new LexwareFehler('Lexware: Die Datei ist kein gültiges PDF', r.status, 'daten', false);
			const cd = r.headers.get('content-disposition') ?? '';
			const m = /filename="?([^";]{1,200})"?/i.exec(cd);
			return { bytes: b, name: m ? m[1] : null } as T;
		}
		if (!text) return undefined as T;
		return JSON.parse(text) as T;
	}
	return {
		get: (p) => anfrage('GET', p),
		post: (p, b) => anfrage('POST', p, b),
		put: (p, b) => anfrage('PUT', p, b),
		del: (p) => anfrage('DELETE', p),
		datei: (p) => anfrage('GET', p, undefined, true)
	};
}
