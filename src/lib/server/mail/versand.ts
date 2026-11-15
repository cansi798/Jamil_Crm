import { createHash } from 'node:crypto';
import { ApiFehler } from '../fehler';
import { mitBetrieb, systemAbfrage, type Kontext } from '../db';
import { entschluessele } from '../geheimnis';
import { smtpVersand, type SmtpKonfig } from './smtp';

/**
 * Mailversand des CRM (Plan „Lexware als Belegsystem“, Abschnitt 5). Lexware kann über die Schnittstelle keine Mails
 * senden – Angebote, Auftragsbestätigungen, Rechnungen und Mahnungen verschickt das CRM.
 *
 * Standard ist `KEIN_VERSAND`. Echt gesendet wird nur, wenn
 *   1. der Betrieb sein Postfach eingerichtet UND eingeschaltet hat (Einstellungen → E-Mail-Versand, app.mail_konfig) und
 *   2. der Server es erlaubt (`CRM_MAILVERSAND` nicht „aus“; im Testmodus/Vorschau nur mit `CRM_MAILVERSAND=an`).
 * Tests setzen eine Attrappe (`setzeMailVersand`), die immer Vorrang hat.
 * `sendeMail` schreibt jede Mail ins Versandprotokoll (app.mail_ausgang) – auch „kein Versand“ und Fehler.
 */

export type Anhang = { name: string; typ: string; bytes: Uint8Array };
export type Mail = { an: string; betreff: string; html: string; text: string; anhaenge?: Anhang[]; cc?: string; bcc?: string };

export interface MailVersand {
	readonly verbunden: boolean;
	senden(mail: Mail): Promise<void | { messageId?: string }>;
}

export const KEIN_VERSAND: MailVersand = {
	verbunden: false,
	async senden() {
		throw new ApiFehler(409, 'Der Mailversand ist noch nicht angebunden – bitte „In Mailprogramm öffnen“ nutzen.');
	}
};

let attrappe: MailVersand | null = null;
/** Für Tests (und nur dort): feste Versand-Attrappe für alle Betriebe; `null` = wieder echte Einstellungen. */
export function setzeMailVersand(v: MailVersand | null): void {
	attrappe = v;
}
export const hatAttrappe = () => attrappe !== null;
/** Die gesetzte Attrappe bzw. „kein Versand“ (alte Schnittstelle; neue Aufrufer nehmen `mailVersandFuer`). */
export function attrappeOderKein(): MailVersand {
	return attrappe ?? KEIN_VERSAND;
}

type Umgebung = Record<string, string | undefined>;
export function mailVersandErlaubt(env: Umgebung = process.env): { erlaubt: boolean; grund: string | null } {
	const schalter = env.CRM_MAILVERSAND?.trim().toLowerCase();
	if (schalter === 'aus') return { erlaubt: false, grund: 'Der Mailversand ist auf diesem Server ausgeschaltet (CRM_MAILVERSAND=aus).' };
	if (env.CRM_TESTMODUS === '1' && schalter !== 'an')
		return { erlaubt: false, grund: 'Vorschau/Testmodus: Es gehen keine echten Mails hinaus.' };
	return { erlaubt: true, grund: null };
}

type Zugang = {
	aktiv: boolean;
	host: string | null;
	port: number | null;
	sicherheit: SmtpKonfig['sicherheit'];
	benutzer: string | null;
	passwort: Uint8Array | null;
	absender_name: string | null;
	absender_adresse: string | null;
	antwort_an: string | null;
	bcc: string | null;
};

async function ladeZugang(betriebId: string): Promise<Zugang | null> {
	const [z] = await systemAbfrage((sql) => sql`select * from app.mail_zugang(${betriebId}::uuid)`);
	return (z as unknown as Zugang) ?? null;
}

/** Versand für einen Betrieb: Attrappe → SMTP (eingerichtet, eingeschaltet, erlaubt) → „kein Versand“. */
export async function mailVersandFuer(betriebId: string): Promise<MailVersand> {
	if (attrappe) return attrappe;
	if (!mailVersandErlaubt().erlaubt) return KEIN_VERSAND;
	const z = await ladeZugang(betriebId);
	if (!z || !z.aktiv || !z.host || !z.port || !z.absender_adresse) return KEIN_VERSAND;
	return smtpVersand(smtpKonfigAus(z, betriebId));
}

/** Postfach-Einstellung ohne Prüfung des Schalters „aktiv“ (für die Testmail vor dem Einschalten). */
export async function smtpOhneSchalter(betriebId: string): Promise<MailVersand | null> {
	if (attrappe) return attrappe;
	const z = await ladeZugang(betriebId);
	if (!z || !z.host || !z.port || !z.absender_adresse) return null;
	return smtpVersand(smtpKonfigAus(z, betriebId));
}

function smtpKonfigAus(z: Zugang, betriebId: string): SmtpKonfig {
	return {
		host: z.host!,
		port: z.port!,
		sicherheit: z.sicherheit,
		benutzer: z.benutzer,
		passwort: z.passwort ? entschluessele(z.passwort, 'smtp', betriebId) : null,
		absenderName: z.absender_name,
		absenderAdresse: z.absender_adresse!,
		antwortAn: z.antwort_an,
		bcc: z.bcc
	};
}

const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
/** ASCII-sicherer Dateiname für Anhänge (z. B. „Rechnung_RE-1042.pdf“). */
export function sichererDateiname(name: string): string {
	const s = name
		.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTE[c])
		.normalize('NFKD')
		.replace(/[^\x20-\x7e]/g, '')
		.replace(/\.\.+/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[_.]+|_+(?=\.[A-Za-z0-9]+$)|_+$/g, '');
	return s.slice(0, 120) || 'Anhang';
}

export type MailArt = 'angebot' | 'ab' | 'rechnung' | 'erinnerung' | 'mahnung' | 'nachfassen' | 'protokoll' | 'buchung' | 'test' | 'sonstiges';
export type MailMeta = {
	art: MailArt;
	bezugTyp?: 'angebot' | 'auftrag' | 'auftragsbestaetigung' | 'kunde' | 'buchung' | 'protokoll' | 'lexware_beleg';
	bezugId?: string | null;
	lexwareId?: string | null;
	/** Statt `mailVersandFuer` (z. B. Testmail vor dem Einschalten). */
	versand?: MailVersand;
};
export type MailErgebnis = { id: string; status: 'gesendet' | 'kein_versand' | 'fehler'; fehler?: string };

/**
 * Meldung für Nutzer und Versandprotokoll: allgemein, nie die rohe Antwort des Mailservers (kann interne Adressen oder
 * Details enthalten). Die rohe Meldung steht nur im Server-Log. Eigene Prüfungen (ApiFehler, z. B. „Server nicht erlaubt“)
 * bleiben im Wortlaut.
 */
export function mailFehlerText(e: unknown): string {
	if (e instanceof ApiFehler) return e.message;
	const code = String((e as { code?: string })?.code ?? '');
	if (code === 'EAUTH' || code === 'ENOAUTH') return 'Anmeldung am Postfach fehlgeschlagen – Benutzername und Passwort prüfen.';
	if (code === 'EENVELOPE') return 'Der Mailserver hat den Empfänger abgelehnt.';
	if (code === 'EMESSAGE') return 'Der Mailserver hat die Mail abgelehnt.';
	if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ETLS', 'EPROTOCOL'].includes(code)) return 'Verbindung zum Mailserver fehlgeschlagen.';
	return 'Versand fehlgeschlagen.';
}
const fehlerText = (e: unknown) => {
	if (!(e instanceof ApiFehler)) console.error('Mailversand:', String((e as Error)?.message ?? e).slice(0, 500));
	return mailFehlerText(e);
};

/**
 * Mail senden und protokollieren. Wirft nicht bei Versandfehlern (Ergebnis `fehler` mit Text), nur bei ungültigen Daten.
 * Läuft außerhalb einer offenen Transaktion, damit das Protokoll auch bei einem Fehler erhalten bleibt.
 */
export async function sendeMail(k: Kontext, mail: Mail, meta: MailMeta): Promise<MailErgebnis> {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.an.trim())) throw new ApiFehler(400, 'Die E-Mail-Adresse des Empfängers ist ungültig.');
	const versand = meta.versand ?? (await mailVersandFuer(k.betriebId));
	const anhaenge = (mail.anhaenge ?? []).map((a) => ({ ...a, name: sichererDateiname(a.name) }));
	const protokoll = anhaenge.map((a) => ({ name: a.name, bytes: a.bytes.length, sha256: createHash('sha256').update(a.bytes).digest('hex') }));
	const benutzer = /^[0-9a-f-]{36}$/i.test(k.benutzerId) ? k.benutzerId : null;
	const [z] = await mitBetrieb(k, (tx) => tx`
		insert into app.mail_ausgang (betrieb_id, art, an, cc, bcc, betreff, bezug_typ, bezug_id, lexware_id, status, anhaenge, von_benutzer)
		values (${k.betriebId}, ${meta.art}, ${mail.an.trim().slice(0, 1000)}, ${mail.cc ?? null}, ${mail.bcc ?? null}, ${mail.betreff.slice(0, 300)},
			${meta.bezugTyp ?? null}, ${meta.bezugId ?? null}, ${meta.lexwareId ?? null}, ${versand.verbunden ? 'wartet' : 'kein_versand'},
			${tx.json(protokoll)}, ${benutzer})
		returning id`);
	const id = z.id as string;
	if (!versand.verbunden) return { id, status: 'kein_versand' };
	try {
		const r = await versand.senden({ ...mail, anhaenge });
		const messageId = (r && typeof r === 'object' && r.messageId) || null;
		await mitBetrieb(k, (tx) => tx`
			update app.mail_ausgang set status = 'gesendet', gesendet_am = now(), versuche = versuche + 1, message_id = ${messageId ? String(messageId).slice(0, 300) : null}
			where id = ${id} and betrieb_id = ${k.betriebId}`);
		return { id, status: 'gesendet' };
	} catch (e) {
		const f = fehlerText(e);
		await mitBetrieb(k, (tx) => tx`
			update app.mail_ausgang set status = 'fehler', versuche = versuche + 1, fehler = ${f} where id = ${id} and betrieb_id = ${k.betriebId}`);
		return { id, status: 'fehler', fehler: f };
	}
}
