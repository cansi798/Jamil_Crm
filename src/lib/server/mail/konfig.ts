import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { hinweis, verschluessele } from '../geheimnis';
import { pruefeSmtpHost, SMTP_PORTS, type Aufloeser } from '../netz-schutz';
import { hatAttrappe, mailVersandErlaubt, sendeMail, smtpOhneSchalter, type MailErgebnis } from './versand';

/**
 * Einstellungen → E-Mail-Versand (Recht „Einstellungen“, geprüft vom Aufrufer). Das Passwort wird nie zurückgegeben,
 * nur „gesetzt“ und die letzten 4 Zeichen. Leeres Passwortfeld beim Speichern = bisheriges Passwort bleibt.
 */

export type Sicherheit = 'starttls' | 'ssl' | 'keine';
export type MailEinstellungen = {
	aktiv: boolean;
	host: string | null;
	port: number | null;
	sicherheit: Sicherheit;
	benutzer: string | null;
	passwortGesetzt: boolean;
	passwortHinweis: string | null;
	absenderName: string | null;
	absenderAdresse: string | null;
	antwortAn: string | null;
	bcc: string | null;
	geaendert: string | null;
};

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function text(w: unknown, max: number): string | null {
	if (w === undefined || w === null) return null;
	if (typeof w !== 'string') throw new ApiFehler(400, 'Ungültige Eingabe.');
	const t = w.trim();
	if (/[\r\n]/.test(t)) throw new ApiFehler(400, 'Zeilenumbrüche sind hier nicht erlaubt.');
	if (t.length > max) throw new ApiFehler(400, `Höchstens ${max} Zeichen.`);
	return t === '' ? null : t;
}
function adresse(w: unknown, feld: string): string | null {
	const t = text(w, 254);
	if (t && !EMAIL.test(t)) throw new ApiFehler(400, `${feld}: Bitte eine gültige E-Mail-Adresse eingeben.`);
	return t;
}

export async function ladeMailEinstellungen(k: Kontext): Promise<MailEinstellungen> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select aktiv, host, port, sicherheit, benutzer, passwort_hinweis, absender_name, absender_adresse::text, antwort_an::text, bcc::text, geaendert
		from app.mail_konfig where betrieb_id = ${k.betriebId}`);
	return {
		aktiv: z?.aktiv ?? false,
		host: z?.host ?? null,
		port: z?.port ?? null,
		sicherheit: (z?.sicherheit as Sicherheit) ?? 'starttls',
		benutzer: z?.benutzer ?? null,
		passwortGesetzt: !!z?.passwort_hinweis,
		passwortHinweis: z?.passwort_hinweis ?? null,
		absenderName: z?.absender_name ?? null,
		absenderAdresse: z?.absender_adresse ?? null,
		antwortAn: z?.antwort_an ?? null,
		bcc: z?.bcc ?? null,
		geaendert: z?.geaendert ? new Date(z.geaendert).toISOString() : null
	};
}

export async function speichereMailEinstellungen(k: Kontext, e: Record<string, unknown>, aufloeser?: Aufloeser): Promise<void> {
	const host = text(e.host, 253);
	if (host && !HOST.test(host)) throw new ApiFehler(400, 'Server: Bitte einen gültigen Servernamen eingeben (z. B. smtp.ionos.de).');
	const portRoh = e.port === '' || e.port === null || e.port === undefined ? null : Number(e.port);
	if (portRoh !== null && !(SMTP_PORTS as readonly number[]).includes(portRoh)) throw new ApiFehler(400, 'Port: erlaubt sind 587 (empfohlen), 465, 25 oder 2525.');
	// SSRF-Schutz schon beim Speichern (und noch einmal vor jeder Mail): nur öffentliche Mailserver
	if (host) await pruefeSmtpHost(host, portRoh ?? 587, aufloeser);
	const sicherheit = (e.sicherheit ?? 'starttls') as Sicherheit;
	if (!['starttls', 'ssl', 'keine'].includes(sicherheit)) throw new ApiFehler(400, 'Verschlüsselung: Bitte eine Auswahl treffen.');
	const benutzer = text(e.benutzer, 254);
	const absenderName = text(e.absenderName, 200);
	const absenderAdresse = adresse(e.absenderAdresse, 'Absender');
	const antwortAn = adresse(e.antwortAn, 'Antworten an');
	const bcc = adresse(e.bcc, 'Kopie (BCC)');
	const aktiv = e.aktiv === true || e.aktiv === 'on' || e.aktiv === 'true';
	if (aktiv && (!host || !portRoh || !absenderAdresse))
		throw new ApiFehler(400, 'Zum Einschalten bitte Server, Port und Absender-Adresse ausfüllen.');
	const pw = typeof e.passwort === 'string' && e.passwort !== '' ? e.passwort : null;
	if (pw && pw.length > 500) throw new ApiFehler(400, 'Passwort: höchstens 500 Zeichen.');
	const loeschen = e.passwortLoeschen === true || e.passwortLoeschen === 'on';
	const chiffrat = pw ? verschluessele(pw, 'smtp', k.betriebId) : null;
	const pwHinweis = pw ? hinweis(pw) : null;
	await mitBetrieb(k, async (tx) => {
		const [da] = await tx`select 1 from app.mail_konfig where betrieb_id = ${k.betriebId}`;
		if (!da) {
			await tx`
				insert into app.mail_konfig (betrieb_id, aktiv, host, port, sicherheit, benutzer, passwort, passwort_hinweis, absender_name, absender_adresse, antwort_an, bcc, geaendert_von)
				values (${k.betriebId}, ${aktiv}, ${host}, ${portRoh}, ${sicherheit}, ${benutzer}, ${chiffrat}, ${pwHinweis}, ${absenderName}, ${absenderAdresse}, ${antwortAn}, ${bcc}, ${k.benutzerId})`;
			return;
		}
		await tx`
			update app.mail_konfig set aktiv = ${aktiv}, host = ${host}, port = ${portRoh}, sicherheit = ${sicherheit}, benutzer = ${benutzer},
				absender_name = ${absenderName}, absender_adresse = ${absenderAdresse}, antwort_an = ${antwortAn}, bcc = ${bcc}, geaendert_von = ${k.benutzerId}
			where betrieb_id = ${k.betriebId}`;
		if (chiffrat) await tx`update app.mail_konfig set passwort = ${chiffrat}, passwort_hinweis = ${pwHinweis} where betrieb_id = ${k.betriebId}`;
		else if (loeschen) await tx`update app.mail_konfig set passwort = null, passwort_hinweis = null where betrieb_id = ${k.betriebId}`;
	});
}

/** Testmail an die angegebene Adresse – auch bevor der Versand eingeschaltet ist (nicht in der Vorschau). */
export async function sendeTestmail(k: Kontext, an: unknown): Promise<MailErgebnis> {
	const ziel = adresse(an, 'Testmail an');
	if (!ziel) throw new ApiFehler(400, 'Testmail an: Bitte eine E-Mail-Adresse eingeben.');
	const erlaubt = mailVersandErlaubt();
	const versand = await smtpOhneSchalter(k.betriebId);
	if (!versand) throw new ApiFehler(400, 'Bitte zuerst Server, Port und Absender-Adresse speichern.');
	if (!erlaubt.erlaubt && !hatAttrappe()) throw new ApiFehler(409, erlaubt.grund!);
	const t = 'Diese Testmail kommt aus dem CRM. Wenn Sie sie lesen, funktioniert der Mailversand.';
	return sendeMail(k, { an: ziel, betreff: 'Testmail aus dem CRM', text: t, html: `<p>${t}</p>` }, { art: 'test', versand });
}

export type MailAusgangZeile = { id: string; art: string; an: string; betreff: string; status: string; fehler: string | null; angelegt: string; gesendetAm: string | null };

export async function listeMailAusgang(k: Kontext, limit = 50): Promise<MailAusgangZeile[]> {
	const z = await mitBetrieb(k, (tx) => tx`
		select id, art, an, betreff, status, fehler, angelegt, gesendet_am from app.mail_ausgang
		where betrieb_id = ${k.betriebId} order by angelegt desc limit ${Math.min(Math.max(limit, 1), 200)}`);
	return z.map((r) => ({
		id: r.id,
		art: r.art,
		an: r.an,
		betreff: r.betreff,
		status: r.status,
		fehler: r.fehler,
		angelegt: new Date(r.angelegt).toISOString(),
		gesendetAm: r.gesendet_am ? new Date(r.gesendet_am).toISOString() : null
	}));
}

export type MailStatus = { eingerichtet: boolean; aktiv: boolean; erlaubt: boolean; grund: string | null; fehler24h: number; gesendet24h: number; letzterFehler: string | null };

export async function mailStatus(k: Kontext): Promise<MailStatus> {
	const e = await ladeMailEinstellungen(k);
	const [z] = await mitBetrieb(k, (tx) => tx`
		select count(*) filter (where status = 'fehler')::int as fehler, count(*) filter (where status = 'gesendet')::int as gesendet,
			(select fehler from app.mail_ausgang where betrieb_id = ${k.betriebId} and status = 'fehler' order by angelegt desc limit 1) as letzter
		from app.mail_ausgang where betrieb_id = ${k.betriebId} and angelegt > now() - interval '24 hours'`);
	const erlaubt = mailVersandErlaubt();
	const eingerichtet = !!(e.host && e.port && e.absenderAdresse);
	const grund = !eingerichtet
		? 'Es ist noch kein Postfach eingerichtet.'
		: !e.aktiv
			? 'Das Postfach ist eingerichtet, der Versand aber ausgeschaltet.'
			: erlaubt.grund;
	return { eingerichtet, aktiv: e.aktiv, erlaubt: erlaubt.erlaubt, grund, fehler24h: z.fehler, gesendet24h: z.gesendet, letzterFehler: z.letzter ?? null };
}
