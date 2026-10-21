import { createHash, randomInt } from 'node:crypto';
import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { ApiFehler } from '../fehler';
import { hashePasswort, pruefePasswort } from '../auth/passwort';
import { erzeugeBegrenzung } from '../auth/ratelimit';
import { UUID } from '../kunden';

/**
 * App-Passwörter für „Handy verbinden“ (CalDAV): je Benutzer mehrere, einzeln widerrufbar. Das Passwort wird genau
 * einmal angezeigt; gespeichert ist nur der Argon2id-Hash (crm_app kann ihn nicht lesen, siehe Migration 101).
 *
 * Form: 5 × 4 Zeichen aus 31 gut unterscheidbaren Kleinbuchstaben/Ziffern (≈ 99 Bit), z. B. `k7mq-2xpa-…`.
 * Beim Prüfen zählen Bindestriche, Leerzeichen und Groß-/Kleinschreibung nicht (abtippen am Handy).
 */

export const ZEICHEN = 'abcdefghjkmnpqrstuvwxyz23456789';
export const MAX_AKTIVE = 10;

export type AppPasswort = { id: string; bezeichnung: string; angelegt: string; zuletztBenutzt: string | null };

/** Nur Buchstaben/Ziffern, klein – so wird gehasht und verglichen. */
export const normalisiere = (p: string) => p.toLowerCase().replace(/[^a-z0-9]/g, '');

export function neuesPasswort(): string {
	const teile: string[] = [];
	for (let g = 0; g < 5; g++) {
		let s = '';
		for (let i = 0; i < 4; i++) s += ZEICHEN[randomInt(ZEICHEN.length)];
		teile.push(s);
	}
	return teile.join('-');
}

export async function listeAppPasswoerter(k: Kontext): Promise<AppPasswort[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id, bezeichnung, angelegt, zuletzt_benutzt from app.app_passwoerter
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and widerrufen_am is null
			order by angelegt desc`;
		return z.map((r) => ({
			id: r.id as string,
			bezeichnung: r.bezeichnung as string,
			angelegt: new Date(r.angelegt).toISOString(),
			zuletztBenutzt: r.zuletzt_benutzt ? new Date(r.zuletzt_benutzt).toISOString() : null
		}));
	});
}

/** Legt ein App-Passwort an und liefert es im Klartext – das einzige Mal. */
export async function legeAppPasswortAn(k: Kontext, bezeichnungRoh: unknown): Promise<{ id: string; passwort: string }> {
	const bezeichnung = typeof bezeichnungRoh === 'string' ? bezeichnungRoh.replace(/\s+/g, ' ').trim() : '';
	if (bezeichnung === '') throw new ApiFehler(400, 'Bitte einen Namen für das Gerät eingeben (z. B. „iPhone“).');
	if ([...bezeichnung].length > 80) throw new ApiFehler(400, 'Der Name ist zu lang (höchstens 80 Zeichen).');
	const passwort = neuesPasswort();
	const hash = await hashePasswort(normalisiere(passwort));
	const id = await mitBetrieb(k, async (tx) => {
		// Sperre je Benutzer, damit die Höchstzahl auch bei gleichzeitigen Anfragen gilt
		await tx`select pg_advisory_xact_lock(hashtext('app_passwort'), hashtext(${k.benutzerId}))`;
		const [{ n }] = await tx`
			select count(*)::int as n from app.app_passwoerter
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and widerrufen_am is null`;
		if (n >= MAX_AKTIVE) throw new ApiFehler(400, `Höchstens ${MAX_AKTIVE} Geräte. Bitte zuerst ein altes Gerät entfernen.`);
		const [z] = await tx`
			insert into app.app_passwoerter (betrieb_id, benutzer_id, bezeichnung, hash)
			values (${k.betriebId}, ${k.benutzerId}, ${bezeichnung}, ${hash}) returning id`;
		return z.id as string;
	});
	return { id, passwort };
}

/** Widerruft ein eigenes App-Passwort (sofort wirksam). Fremde/unbekannte → 404. */
export async function widerrufeAppPasswort(k: Kontext, id: unknown): Promise<void> {
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Gerät nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			update app.app_passwoerter set widerrufen_am = now()
			where id = ${id} and betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and widerrufen_am is null
			returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Gerät nicht gefunden.');
	});
	vergiss(id);
}

// ——— Anmeldung per HTTP Basic ———

export type CalNutzer = Nutzer & { email: string; name: string; passwortId: string };

/** Erfolgreiche Prüfungen 10 Minuten merken (Argon2 kostet Zeit; CalDAV-Programme senden viele Anfragen). */
const MERKEN_MS = 10 * 60 * 1000;
const gemerkt = new Map<string, { passwortId: string; bis: number }>();
const begrenzungEmail = erzeugeBegrenzung({ max: 10, fensterMs: 15 * 60 * 1000 });
const begrenzungIp = erzeugeBegrenzung({ max: 30, fensterMs: 15 * 60 * 1000 });

function vergiss(passwortId: string): void {
	for (const [s, w] of gemerkt) if (w.passwortId === passwortId) gemerkt.delete(s);
}

/** Für Tests: Merkliste und Sperren leeren. */
export function leereAnmeldeSpeicher(): void {
	gemerkt.clear();
	begrenzungEmail.leeren();
	begrenzungIp.leeren();
}

/** Liest `Authorization: Basic …` (UTF-8). `null` bei fehlendem oder kaputtem Kopf. */
export function leseBasic(kopf: string | null): { email: string; passwort: string } | null {
	if (!kopf) return null;
	const m = /^Basic\s+([A-Za-z0-9+/=]{1,1000})$/i.exec(kopf.trim());
	if (!m) return null;
	const text = Buffer.from(m[1], 'base64').toString('utf8');
	const i = text.indexOf(':');
	if (i <= 0) return null;
	const email = text.slice(0, i).trim().toLowerCase();
	const passwort = text.slice(i + 1);
	if (email.length > 254 || passwort.length > 200 || !email.includes('@')) return null;
	return { email, passwort };
}

/** Ein fester Argon2-Hash, damit unbekannte E-Mails gleich lange dauern wie falsche Passwörter. */
let attrappe: Promise<string> | null = null;

export type AnmeldeErgebnis = { nutzer: CalNutzer } | { fehler: 'falsch' | 'gesperrt' };

/**
 * Prüft E-Mail + App-Passwort. Fehlversuche sind begrenzt (10 je E-Mail, 30 je IP in 15 Minuten); erfolgreiche
 * Prüfungen setzen die Zähler zurück. Jede Anfrage fragt die Datenbank, ob das Passwort noch gilt (Widerruf,
 * deaktivierter Benutzer, gesperrter Betrieb wirken sofort).
 */
export async function meldeMitAppPasswortAn(email: string, passwortRoh: string, ip: string): Promise<AnmeldeErgebnis> {
	const passwort = normalisiere(passwortRoh);
	const schluessel = createHash('sha256').update(`${email}\u0000${passwort}`).digest('base64url');
	const jetzt = Date.now();
	let passwortId: string | null = null;
	const m = gemerkt.get(schluessel);
	if (m && m.bis > jetzt) passwortId = m.passwortId;
	else {
		if (m) gemerkt.delete(schluessel);
		if (!begrenzungEmail.pruefeVersuch(email).erlaubt || !begrenzungIp.pruefeVersuch(ip).erlaubt) return { fehler: 'gesperrt' };
		const kandidaten = passwort.length === 20 ? await systemAbfrage((sql) => sql`select id, hash from app.app_passwort_kandidaten(${email}::public.citext)`) : [];
		for (const k of kandidaten) {
			if (await pruefePasswort(k.hash as string, passwort)) {
				passwortId = k.id as string;
				break;
			}
		}
		if (!passwortId) {
			if (kandidaten.length === 0) {
				attrappe ??= hashePasswort('attrappe-fuer-gleiche-laufzeit');
				await pruefePasswort(await attrappe, passwort || 'x');
			}
			return { fehler: 'falsch' };
		}
		begrenzungEmail.zuruecksetzen(email);
		begrenzungIp.zuruecksetzen(ip);
		if (gemerkt.size > 2000) gemerkt.clear();
		gemerkt.set(schluessel, { passwortId, bis: jetzt + MERKEN_MS });
	}
	const [z] = await systemAbfrage((sql) => sql`select * from app.app_passwort_nutzer(${passwortId}::uuid)`);
	if (!z) {
		gemerkt.delete(schluessel);
		return { fehler: 'falsch' };
	}
	return {
		nutzer: {
			id: z.benutzer_id,
			betriebId: z.betrieb_id,
			istAdmin: false,
			rechte: z.rolle_rechte,
			betriebStatus: z.betrieb_status,
			email: z.email,
			name: z.name,
			passwortId: passwortId!
		}
	};
}
