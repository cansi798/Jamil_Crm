/**
 * Ausgang des Leitfadens (Entscheidung 4b, Jamil msg 4340): Jede Eingabe wird zuerst auf dem Gerät gemerkt
 * (`localStorage`) und dann der Reihe nach an den Server geschickt. Ohne Netz bleibt sie liegen und geht raus, sobald
 * wieder Netz da ist (Ereignis „online“, nächster Seitenaufruf, nächste Eingabe).
 *
 * - Jede Eingabe hat eine Kennung (`opId`); der Server übernimmt dieselbe Eingabe nur einmal (Doppelsendungen nach
 *   Funklöchern sind harmlos).
 * - Je Schritt gewinnt die spätere Eingabe (Zeitpunkt vom Gerät) – auch wenn eine ältere später ankommt.
 * - Reihenfolge bleibt erhalten (Fotos vor dem Abschluss).
 * - Lehnt der Server eine Eingabe ab (z. B. ungültige E-Mail), kommt sie in die Fehlerliste und wird angezeigt.
 * - Der Ausgang gehört genau einem Benutzer (Kennung wie bei der Offline-Kopie von „Meine Einsätze heute“); meldet sich
 *   auf dem Gerät jemand anderes an, wird er verworfen – fremde Kundendaten bleiben nicht liegen.
 */
import { gemerkterNutzer } from './heute-kopie';

export const AUSGANG_SCHLUESSEL = 'crm-leitfaden-ausgang-v1';

export type AusgangOp =
	| { art: 'eingabe'; opId: string; einsatzId: string; schrittId: string; wert: unknown; zeit: string }
	| { art: 'foto'; opId: string; einsatzId: string; schrittId: string; zeit: string; daten: string; typ: string }
	| { art: 'abschluss'; opId: string; einsatzId: string; zeit: string; begruendung: string };

export type AusgangFehler = { op: AusgangOp; meldung: string };
type Ausgang = { nutzer: string | null; warteschlange: AusgangOp[]; fehler: AusgangFehler[] };

function speicher(): Storage | null {
	try {
		return (globalThis as { localStorage?: Storage }).localStorage ?? null;
	} catch {
		return null;
	}
}

function lies(): Ausgang {
	const nutzer = gemerkterNutzer();
	const leer: Ausgang = { nutzer, warteschlange: [], fehler: [] };
	try {
		const roh = speicher()?.getItem(AUSGANG_SCHLUESSEL);
		if (!roh) return leer;
		const a = JSON.parse(roh) as Ausgang;
		if (!a || a.nutzer !== nutzer || !Array.isArray(a.warteschlange)) {
			speicher()?.removeItem(AUSGANG_SCHLUESSEL);
			return leer;
		}
		return { nutzer, warteschlange: a.warteschlange, fehler: Array.isArray(a.fehler) ? a.fehler.slice(-20) : [] };
	} catch {
		return leer;
	}
}

/** Schreibt den Ausgang. `false`, wenn der Speicher voll/gesperrt ist (dann sofort senden versuchen). */
function schreibe(a: Ausgang): boolean {
	try {
		speicher()?.setItem(AUSGANG_SCHLUESSEL, JSON.stringify(a));
		return true;
	} catch {
		return false;
	}
}

export function neueOpId(): string {
	return crypto.randomUUID();
}

/** Eingabe in den Ausgang legen. `false` = konnte nicht gemerkt werden (Speicher voll, z. B. große Fotos). */
export function einreihen(op: AusgangOp): boolean {
	const a = lies();
	a.warteschlange.push(op);
	return schreibe(a);
}

export function wartend(einsatzId?: string): AusgangOp[] {
	const w = lies().warteschlange;
	return einsatzId ? w.filter((o) => o.einsatzId === einsatzId) : w;
}

export function fehlerListe(einsatzId?: string): AusgangFehler[] {
	const f = lies().fehler;
	return einsatzId ? f.filter((x) => x.op.einsatzId === einsatzId) : f;
}

export function fehlerVerwerfen(opId: string): void {
	const a = lies();
	a.fehler = a.fehler.filter((f) => f.op.opId !== opId);
	schreibe(a);
}

function entferne(opId: string, fehler?: string): void {
	const a = lies();
	const op = a.warteschlange.find((o) => o.opId === opId);
	a.warteschlange = a.warteschlange.filter((o) => o.opId !== opId);
	if (op && fehler) a.fehler.push({ op, meldung: fehler });
	schreibe(a);
}

function alsBlob(datenUrl: string, typ: string): Blob {
	const b64 = datenUrl.slice(datenUrl.indexOf(',') + 1);
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: typ });
}

function anfrage(op: AusgangOp): { url: string; init: RequestInit } {
	const basis = `/api/leitfaden/${encodeURIComponent(op.einsatzId)}`;
	if (op.art === 'eingabe') {
		return {
			url: `${basis}/eingaben`,
			init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eingaben: [{ opId: op.opId, schrittId: op.schrittId, wert: op.wert, zeit: op.zeit }] }) }
		};
	}
	if (op.art === 'foto') {
		const f = new FormData();
		f.set('opId', op.opId);
		f.set('schrittId', op.schrittId);
		f.set('zeit', op.zeit);
		f.set('datei', alsBlob(op.daten, op.typ), `foto.${op.typ === 'image/png' ? 'png' : 'jpg'}`);
		return { url: `${basis}/foto`, init: { method: 'POST', body: f } };
	}
	return { url: `${basis}/abschliessen`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opId: op.opId, begruendung: op.begruendung }) } };
}

export type SendeErgebnis = {
	gesendet: number;
	/** ohne Netz bzw. Server nicht erreichbar – der Rest wartet */
	offline: boolean;
	/** neuester Stand je Termin aus den Antworten des Servers */
	staende: Map<string, unknown>;
	fehler: AusgangFehler[];
};

let laeuft: Promise<SendeErgebnis> | null = null;

/** Schickt den Ausgang der Reihe nach. Läuft schon ein Senden, wartet der Aufruf darauf (nie doppelt parallel). */
export function senden(holen: typeof fetch = fetch): Promise<SendeErgebnis> {
	if (laeuft) return laeuft;
	laeuft = (async () => {
		const ergebnis: SendeErgebnis = { gesendet: 0, offline: false, staende: new Map(), fehler: [] };
		try {
			for (;;) {
				const op = lies().warteschlange[0];
				if (!op) break;
				let r: Response;
				try {
					const { url, init } = anfrage(op);
					r = await holen(url, init);
				} catch {
					ergebnis.offline = true;
					break;
				}
				if (r.ok) {
					ergebnis.staende.set(op.einsatzId, await r.json().catch(() => null));
					entferne(op.opId);
					ergebnis.gesendet++;
					continue;
				}
				// Nicht angemeldet, Server überlastet/kaputt: später nochmal (nichts verwerfen)
				if (r.status === 401 || r.status === 408 || r.status === 429 || r.status >= 500) {
					ergebnis.offline = true;
					break;
				}
				const meldung = ((await r.json().catch(() => null)) as { fehler?: string } | null)?.fehler ?? `Fehler ${r.status}`;
				entferne(op.opId, meldung);
				ergebnis.fehler.push({ op, meldung });
			}
		} finally {
			laeuft = null;
		}
		return ergebnis;
	})();
	return laeuft;
}
