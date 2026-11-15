import nodemailer from 'nodemailer';
import type { MailVersand } from './versand';
import { pruefeSmtpHost, type Aufloeser } from '../netz-schutz';

/**
 * Echter Versand über das Postfach des Betriebs (SMTP, nodemailer). Ein Transport je Postfach-Einstellung; das Passwort
 * kommt entschlüsselt nur hier an und wird nie geloggt. Datei- und URL-Zugriffe von nodemailer sind abgeschaltet
 * (Anhänge kommen immer als Bytes).
 *
 * SSRF-Schutz: Vor JEDER Mail wird der Server neu aufgelöst und geprüft (nur öffentliche Adressen, Ports 25/465/587/2525,
 * `netz-schutz.ts`); verbunden wird zur geprüften IP, das TLS-Zertifikat wird gegen den Namen geprüft (servername).
 */

export type SmtpKonfig = {
	host: string;
	port: number;
	sicherheit: 'starttls' | 'ssl' | 'keine';
	benutzer: string | null;
	passwort: string | null;
	absenderName: string | null;
	absenderAdresse: string;
	antwortAn: string | null;
	bcc: string | null;
};

type Transport = { sendMail(m: Record<string, unknown>): Promise<{ messageId?: string }> };
export type TransportFabrik = (optionen: Record<string, unknown>) => Transport;

const standardFabrik: TransportFabrik = (o) => nodemailer.createTransport(o as any) as unknown as Transport;

export function smtpVersand(cfg: SmtpKonfig, fabrik: TransportFabrik = standardFabrik, aufloeser?: Aufloeser): MailVersand {
	return {
		verbunden: true,
		async senden(mail) {
			const ziel = await pruefeSmtpHost(cfg.host, cfg.port, aufloeser);
			const transport = fabrik({
				host: ziel.ip,
				port: cfg.port,
				secure: cfg.sicherheit === 'ssl',
				requireTLS: cfg.sicherheit === 'starttls',
				ignoreTLS: cfg.sicherheit === 'keine',
				...(ziel.servername ? { tls: { servername: ziel.servername } } : {}),
				name: 'crm',
				auth: cfg.benutzer ? { user: cfg.benutzer, pass: cfg.passwort ?? '' } : undefined,
				connectionTimeout: 15_000,
				greetingTimeout: 10_000,
				socketTimeout: 30_000,
				disableFileAccess: true,
				disableUrlAccess: true
			});
			const bcc = [cfg.bcc, ...(mail.bcc ? [mail.bcc] : [])].filter((x): x is string => !!x);
			const info = await transport.sendMail({
				from: { name: cfg.absenderName || cfg.absenderAdresse, address: cfg.absenderAdresse },
				to: mail.an,
				...(mail.cc ? { cc: mail.cc } : {}),
				...(bcc.length ? { bcc } : {}),
				...(cfg.antwortAn ? { replyTo: cfg.antwortAn } : {}),
				subject: mail.betreff,
				text: mail.text,
				html: mail.html,
				attachments: (mail.anhaenge ?? []).map((a) => ({ filename: a.name, content: Buffer.from(a.bytes), contentType: a.typ }))
			});
			return { messageId: info?.messageId };
		}
	};
}
