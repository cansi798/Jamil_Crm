import webpush from 'web-push';
import { mitBetrieb, systemAbfrage, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { UUID } from './kunden';
import { ausTagUndUhrzeit, berlinTag, berlinUhrzeit, istTag, tagKurz } from '../zeit';
import { erinnerungAusFeld, istPushEndpunkt, MAX_ERINNERUNGEN, MAX_MINUTEN_VORHER, vorlaufText } from '../erinnerungen';

/**
 * Erinnerungen (Wunsch Jamil msg 2679) für To-dos und Termine: bis zu zwei je Person und Ziel, relativ („1 Stunde
 * vorher“) oder fest („morgen um 8“). Ein Hintergrund-Dienst (jede Minute) stellt fällige Erinnerungen zu: in der App
 * (Glocke) und per Web-Push an alle Geräte der Person (VAPID). Vor dem Senden wird geprüft, ob die Person noch aktiv
 * ist, das Recht „erinnerungen.nutzen“ hat und das To-do bzw. den Termin sehen darf – sonst wird übersprungen.
 * E-Mail folgt, sobald die Mail-Anbindung steht (gleiche Schnittstelle wie beim Nachfassen).
 */

export const RECHT = 'erinnerungen.nutzen';
export type Ziel = { todoId: string } | { einsatzId: string };
type Eingabe = { minuten: number } | { zeitpunkt: Date };

/** Formular- oder Sprach-Eingaben → geprüfte Liste. Erlaubt: Felder `erinnerung1/2` oder `erinnerungen` (Array). */
export function erinnerungenAusEingabe(e: Record<string, unknown>): Eingabe[] | undefined {
	const roh: unknown[] = Array.isArray(e.erinnerungen)
		? e.erinnerungen
		: 'erinnerung1' in e || 'erinnerung2' in e
			? [e.erinnerung1, e.erinnerung2]
			: [];
	if (!Array.isArray(e.erinnerungen) && !('erinnerung1' in e) && !('erinnerung2' in e)) return undefined;
	const liste: Eingabe[] = [];
	for (const r of roh) {
		if (r === null || r === undefined || r === '') continue;
		if (typeof r === 'object') {
			const o = r as Record<string, unknown>;
			if (typeof o.minuten === 'number') liste.push({ minuten: o.minuten });
			else if (typeof o.zeitpunkt === 'string' && !Number.isNaN(Date.parse(o.zeitpunkt))) liste.push({ zeitpunkt: new Date(o.zeitpunkt) });
			else throw new ApiFehler(400, 'Erinnerung: ungültige Angabe.');
			continue;
		}
		const f = erinnerungAusFeld(r);
		if (!f) continue;
		if ('minuten' in f) liste.push({ minuten: f.minuten });
		else {
			const [tag, zeit] = f.ortszeit.split('T');
			if (!istTag(tag) || !zeit) throw new ApiFehler(400, 'Erinnerung: bitte Tag und Uhrzeit wählen.');
			liste.push({ zeitpunkt: ausTagUndUhrzeit(tag, zeit) });
		}
	}
	for (const x of liste) {
		if ('minuten' in x && (!Number.isInteger(x.minuten) || x.minuten < 0 || x.minuten > MAX_MINUTEN_VORHER)) {
			throw new ApiFehler(400, 'Erinnerung: höchstens 30 Tage vorher.');
		}
	}
	if (liste.length > MAX_ERINNERUNGEN) throw new ApiFehler(400, `Höchstens ${MAX_ERINNERUNGEN} Erinnerungen.`);
	return liste;
}

async function rechteVon(tx: TransactionSql, k: Kontext, benutzerId: string): Promise<{ aktiv: boolean; rechte: string[] } | null> {
	const [z] = await tx`
		select b.aktiv, r.rechte from app.benutzer b left join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.id = ${benutzerId} and b.betrieb_id = ${k.betriebId}`;
	return z ? { aktiv: z.aktiv, rechte: (z.rechte as string[] | null) ?? [] } : null;
}

/**
 * Erinnerungen des angemeldeten Nutzers für ein Ziel ersetzen (noch nicht gesendete). `faelligUm` = Fälligkeit bzw.
 * Terminbeginn (für „vorher“). 403 ohne Recht, 400 bei „vorher“ ohne Fälligkeit oder Zeitpunkt in der Vergangenheit.
 */
export async function setzeErinnerungen(
	tx: TransactionSql,
	k: Kontext,
	ziel: Ziel,
	liste: Eingabe[],
	faelligUm: Date | null,
	jetzt = new Date()
): Promise<void> {
	if (liste.length > 0) {
		const r = await rechteVon(tx, k, k.benutzerId);
		if (!r?.rechte.includes(RECHT)) throw new ApiFehler(403, 'Für Erinnerungen fehlt Ihnen die Berechtigung.');
	}
	const zeilen = liste.map((x) => {
		if ('minuten' in x) {
			if (!faelligUm) throw new ApiFehler(400, 'Für „… vorher“ braucht das To-do ein Fälligkeitsdatum.');
			return { minuten: x.minuten, zeitpunkt: new Date(faelligUm.getTime() - x.minuten * 60_000) };
		}
		return { minuten: null, zeitpunkt: x.zeitpunkt };
	});
	for (const z of zeilen) {
		if (z.zeitpunkt.getTime() < jetzt.getTime() - 60_000) throw new ApiFehler(400, 'Die Erinnerung läge in der Vergangenheit.');
	}
	const todoId = 'todoId' in ziel ? ziel.todoId : null;
	const einsatzId = 'einsatzId' in ziel ? ziel.einsatzId : null;
	await tx`
		delete from app.erinnerungen where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and gesendet_am is null
			and ${todoId ? tx`todo_id = ${todoId}` : tx`einsatz_id = ${einsatzId}`}`;
	for (const z of zeilen) {
		await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, einsatz_id, minuten_vorher, zeitpunkt, titel, link)
			values (${k.betriebId}, ${k.benutzerId}, ${todoId}, ${einsatzId}, ${z.minuten}, ${z.zeitpunkt}, 'Erinnerung', '/')`;
	}
}

/** Zeitpunkt der Fälligkeit eines To-dos (ohne Uhrzeit 8:00 Uhr) oder null. */
export const todoFaelligUm = (faellig: string | null, zeit: string | null) => (faellig ? ausTagUndUhrzeit(faellig, zeit ?? '08:00') : null);

export type ErinnerungKurz = { id: string; minutenVorher: number | null; zeitpunkt: string; text: string };

/** Offene Erinnerungen des Nutzers je Ziel (für die Anzeige am To-do/Termin). */
export async function eigeneErinnerungen(k: Kontext, ziel: Ziel): Promise<ErinnerungKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id, minuten_vorher, zeitpunkt from app.erinnerungen
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and gesendet_am is null
				and ${'todoId' in ziel ? tx`todo_id = ${ziel.todoId}` : tx`einsatz_id = ${ziel.einsatzId}`}
			order by zeitpunkt`;
		return z.map((r) => {
			const d = new Date(r.zeitpunkt);
			const fest = `${tagKurz(berlinTag(d))} ${berlinUhrzeit(d)}`;
			return {
				id: r.id,
				minutenVorher: r.minuten_vorher,
				zeitpunkt: d.toISOString(),
				text: r.minuten_vorher === null ? fest : `${vorlaufText(r.minuten_vorher)} (${fest})`
			};
		});
	});
}

// ——— Benachrichtigungen in der App (Glocke) ———

export type Benachrichtigung = { id: string; titel: string; text: string | null; link: string; zeit: string; gelesen: boolean };

export async function benachrichtigungen(k: Kontext, limit = 20): Promise<{ ungelesen: number; liste: Benachrichtigung[] }> {
	return mitBetrieb(k, async (tx) => {
		const [{ n }] = await tx`
			select count(*)::int as n from app.erinnerungen
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and ergebnis = 'gesendet' and gelesen_am is null`;
		const z = await tx`
			select id, titel, text, link, gesendet_am, gelesen_am from app.erinnerungen
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and ergebnis = 'gesendet'
			order by gesendet_am desc limit ${Math.min(Math.max(limit, 1), 50)}`;
		return {
			ungelesen: n,
			liste: z.map((r) => ({
				id: r.id,
				titel: r.titel,
				text: r.text,
				link: r.link,
				zeit: new Date(r.gesendet_am).toISOString(),
				gelesen: r.gelesen_am !== null
			}))
		};
	});
}

/** Eine (id) oder alle Benachrichtigungen des Nutzers als gelesen markieren. */
export async function markiereGelesen(k: Kontext, id: unknown): Promise<void> {
	if (id !== undefined && id !== null && (typeof id !== 'string' || !UUID.test(id))) throw new ApiFehler(400, 'Ungültige Benachrichtigung.');
	await mitBetrieb(k, (tx) => tx`
		update app.erinnerungen set gelesen_am = now()
		where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and gelesen_am is null and ergebnis = 'gesendet'
			${id ? tx`and id = ${id as string}` : tx``}`);
}

// ——— Web-Push (VAPID) ———

let vapidCache: { oeffentlich: string; privat: string; kontakt: string } | null = null;

/** VAPID-Schlüssel: aus der .env (CRM_VAPID_OEFFENTLICH/CRM_VAPID_PRIVAT), sonst einmalig erzeugt und in der Datenbank gemerkt. */
export async function vapid(): Promise<{ oeffentlich: string; privat: string; kontakt: string }> {
	if (vapidCache) return vapidCache;
	const kontakt = process.env.CRM_VAPID_KONTAKT?.trim() || 'mailto:admin@example.org';
	if (process.env.CRM_VAPID_OEFFENTLICH?.trim() && process.env.CRM_VAPID_PRIVAT?.trim()) {
		vapidCache = { oeffentlich: process.env.CRM_VAPID_OEFFENTLICH.trim(), privat: process.env.CRM_VAPID_PRIVAT.trim(), kontakt };
		return vapidCache;
	}
	const gespeichert = await systemAbfrage(async (sql) => {
		const [z] = await sql`select app.system_wert('vapid') as wert`;
		if (z?.wert) return z.wert as string;
		const neu = webpush.generateVAPIDKeys();
		const [w] = await sql`select app.system_wert_falls_neu('vapid', ${JSON.stringify({ oeffentlich: neu.publicKey, privat: neu.privateKey })}) as wert`;
		return w.wert as string;
	});
	const j = JSON.parse(gespeichert) as { oeffentlich: string; privat: string };
	vapidCache = { ...j, kontakt };
	return vapidCache;
}

export type PushNachricht = { titel: string; text: string; link: string };
type PushSender = (abo: { endpoint: string; keys: { p256dh: string; auth: string } }, nachricht: PushNachricht) => Promise<{ status: number }>;

/**
 * Senden: web-push baut nur die verschlüsselte Anfrage (VAPID-Kopfzeilen, Inhalt); verschickt wird mit fetch –
 * ohne Weiterleitungen zu folgen, mit kurzer Zeitgrenze, die Antwort wird nicht gelesen. Nur an erlaubte Push-Dienste.
 */
const echterSender: PushSender = async (abo, n) => {
	if (!istPushEndpunkt(abo.endpoint)) return { status: 410 };
	const v = await vapid();
	const anfrage = webpush.generateRequestDetails(abo, JSON.stringify(n), {
		vapidDetails: { subject: v.kontakt, publicKey: v.oeffentlich, privateKey: v.privat },
		TTL: 3600
	});
	const r = await fetch(anfrage.endpoint, {
		method: anfrage.method,
		headers: anfrage.headers as Record<string, string>,
		body: anfrage.body as unknown as BodyInit,
		redirect: 'manual',
		signal: AbortSignal.timeout(10_000)
	});
	await r.body?.cancel().catch(() => undefined);
	return { status: r.status >= 300 && r.status < 400 ? 502 : r.status };
};
let pushSender: PushSender = echterSender;
/** Nur Tests: anderer Sender (ohne Netz). */
export const setzePushSender = (s: PushSender | null) => (pushSender = s ?? echterSender);

export async function speicherePushAbo(k: Kontext, e: Record<string, unknown>): Promise<void> {
	const keys = (e.keys ?? {}) as Record<string, unknown>;
	const endpoint = typeof e.endpoint === 'string' ? e.endpoint.trim() : '';
	const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
	const auth = typeof keys.auth === 'string' ? keys.auth : '';
	if (!istPushEndpunkt(endpoint)) throw new ApiFehler(400, 'Ungültiges Push-Abo (unbekannter Push-Dienst).');
	if (!/^[A-Za-z0-9_-]{10,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) throw new ApiFehler(400, 'Ungültiges Push-Abo.');
	const geraet = typeof e.geraet === 'string' ? e.geraet.slice(0, 200) : null;
	await mitBetrieb(k, async (tx) => {
		const r = await rechteVon(tx, k, k.benutzerId);
		if (!r?.rechte.includes(RECHT)) throw new ApiFehler(403, 'Für Erinnerungen fehlt Ihnen die Berechtigung.');
		await tx`
			insert into app.push_abos (betrieb_id, benutzer_id, endpoint, p256dh, auth, geraet)
			values (${k.betriebId}, ${k.benutzerId}, ${endpoint}, ${p256dh}, ${auth}, ${geraet})
			on conflict (betrieb_id, endpoint) do update set benutzer_id = excluded.benutzer_id, p256dh = excluded.p256dh,
				auth = excluded.auth, geraet = excluded.geraet, fehler = 0`;
	});
}

export async function loeschePushAbo(k: Kontext, endpoint: unknown): Promise<void> {
	if (typeof endpoint !== 'string') throw new ApiFehler(400, 'Ungültiges Push-Abo.');
	await mitBetrieb(k, (tx) => tx`delete from app.push_abos where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and endpoint = ${endpoint}`);
}

export async function pushGeraete(k: Kontext): Promise<number> {
	const [z] = await mitBetrieb(k, (tx) => tx`select count(*)::int as n from app.push_abos where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId}`);
	return z.n;
}

/** Push an alle Geräte der Person; abgemeldete Geräte (404/410) werden entfernt, dauerhaft fehlerhafte nach 5 Fehlern. */
export async function sendePush(k: Kontext, n: PushNachricht): Promise<number> {
	const abos = await mitBetrieb(k, (tx) => tx`select id, endpoint, p256dh, auth from app.push_abos where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId}`);
	let ok = 0;
	for (const a of abos) {
		let status = 0;
		try {
			status = (await pushSender({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, n)).status;
		} catch (e) {
			console.error('Web-Push fehlgeschlagen:', (e as Error).message);
		}
		await mitBetrieb(k, async (tx) => {
			if (status >= 200 && status < 300) {
				ok++;
				await tx`update app.push_abos set fehler = 0, zuletzt_genutzt = now() where id = ${a.id} and betrieb_id = ${k.betriebId}`;
			} else if (status === 404 || status === 410) {
				await tx`delete from app.push_abos where id = ${a.id} and betrieb_id = ${k.betriebId}`;
			} else {
				await tx`update app.push_abos set fehler = fehler + 1 where id = ${a.id} and betrieb_id = ${k.betriebId}`;
				await tx`delete from app.push_abos where id = ${a.id} and betrieb_id = ${k.betriebId} and fehler >= 5`;
			}
		});
	}
	return ok;
}

// ——— Zustellung (Hintergrund-Dienst) ———

/**
 * Fällige Erinnerungen zustellen. Je Erinnerung im Betrieb (RLS): Empfänger aktiv + Recht, Ziel sichtbar und offen
 * (To-do nicht erledigt) → als gesendet markieren, Text aus den aktuellen Daten; dann Push. Sonst „übersprungen“.
 */
export async function stelleFaelligeZu(limit = 100): Promise<{ gesendet: number; uebersprungen: number }> {
	const faellig = await systemAbfrage((sql) => sql`select * from app.erinnerungen_faellig(${limit})`);
	let gesendet = 0;
	let uebersprungen = 0;
	for (const f of faellig) {
		const k = { betriebId: f.betrieb_id as string, benutzerId: f.benutzer_id as string };
		try {
			const n = await mitBetrieb(k, async (tx) => {
				const [r] = await tx`
					select id, todo_id, einsatz_id from app.erinnerungen
					where id = ${f.id} and betrieb_id = ${k.betriebId} and gesendet_am is null for update skip locked`;
				if (!r) return null;
				const nachricht = await inhalt(tx, k, r);
				await tx`
					update app.erinnerungen set gesendet_am = now(), ergebnis = ${nachricht ? 'gesendet' : 'uebersprungen'}
						${nachricht ? tx`, titel = ${nachricht.titel}, text = ${nachricht.text}, link = ${nachricht.link}` : tx``}
					where id = ${r.id} and betrieb_id = ${k.betriebId}`;
				return nachricht ?? false;
			});
			if (n === null) continue;
			if (n === false) {
				uebersprungen++;
				continue;
			}
			gesendet++;
			await sendePush(k, n).catch((e) => console.error('Web-Push:', e));
		} catch (e) {
			console.error('Erinnerung zustellen fehlgeschlagen:', e);
		}
	}
	return { gesendet, uebersprungen };
}

/** Text der Erinnerung aus den aktuellen Daten – oder null, wenn sie nicht (mehr) zugestellt werden darf. */
async function inhalt(tx: TransactionSql, k: Kontext, r: Record<string, any>): Promise<PushNachricht | null> {
	const wer = await rechteVon(tx, k, k.benutzerId);
	if (!wer?.aktiv || !wer.rechte.includes(RECHT)) return null;
	if (r.todo_id) {
		const alle = wer.rechte.includes('todos.alle_lesen');
		const [t] = await tx`
			select t.titel, t.erledigt_am, to_char(t.faellig, 'YYYY-MM-DD') as faellig, to_char(t.faellig_zeit, 'HH24:MI') as zeit, t.auftrag_id
			from app.todos t left join app.auftraege a on a.id = t.auftrag_id and a.betrieb_id = t.betrieb_id
			where t.id = ${r.todo_id} and t.betrieb_id = ${k.betriebId}
				and (${alle} or t.zustaendig_id = ${k.benutzerId}
					or exists (select 1 from app.auftrag_zustaendige z where z.auftrag_id = t.auftrag_id and z.betrieb_id = t.betrieb_id and z.benutzer_id = ${k.benutzerId})
					or exists (select 1 from app.einsaetze e where e.auftrag_id = t.auftrag_id and e.betrieb_id = t.betrieb_id and e.benutzer_id = ${k.benutzerId}))`;
		if (!t || t.erledigt_am) return null;
		return {
			titel: `To-do: ${t.titel}`.slice(0, 300),
			text: t.faellig ? `Fällig ${tagKurz(t.faellig)}${t.zeit ? ` ${t.zeit}` : ''}` : 'Erinnerung',
			link: t.auftrag_id ? `/auftraege/${t.auftrag_id}` : '/todos'
		};
	}
	const darfAlle = wer.rechte.includes('plantafel.bearbeiten') || wer.rechte.includes('auftraege.alle_lesen');
	const [e] = await tx`
		select e.beginn, e.benutzer_id, a.id as auftrag_id, a.titel, coalesce(k.firma, nullif(concat_ws(' ', k.vorname, k.nachname), ''), a.einmal_name, '') as kunde
		from app.einsaetze e join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
		left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
		where e.id = ${r.einsatz_id} and e.betrieb_id = ${k.betriebId}`;
	if (!e || (!darfAlle && e.benutzer_id !== k.benutzerId)) return null;
	const d = new Date(e.beginn);
	return {
		titel: `Termin: ${e.titel}${e.kunde ? ` – ${e.kunde}` : ''}`.slice(0, 300),
		text: `${tagKurz(berlinTag(d))} um ${berlinUhrzeit(d)}`,
		link: `/auftraege/${e.auftrag_id}`
	};
}

let dienst: ReturnType<typeof setInterval> | null = null;
let laeuft = false;
/** Hintergrund-Dienst starten (jede Minute). In Tests nicht. */
export function starteErinnerungsDienst(intervallMs = 60_000): void {
	if (dienst) return;
	dienst = setInterval(async () => {
		if (laeuft) return;
		laeuft = true;
		try {
			await stelleFaelligeZu();
		} catch (e) {
			console.error('Erinnerungs-Dienst:', e);
		} finally {
			laeuft = false;
		}
	}, intervallMs);
	dienst.unref?.();
}
export function stoppeErinnerungsDienst(): void {
	if (dienst) clearInterval(dienst);
	dienst = null;
}
