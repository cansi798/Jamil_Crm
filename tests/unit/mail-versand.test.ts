import { describe, expect, it } from 'vitest';
import { smtpVersand, type SmtpKonfig } from '../../src/lib/server/mail/smtp';
import { mailFehlerText, mailVersandErlaubt, sichererDateiname } from '../../src/lib/server/mail/versand';

const oeffentlich = async () => [{ address: '212.227.15.183', family: 4 }];

const cfg: SmtpKonfig = {
	host: 'smtp.ionos.de',
	port: 587,
	sicherheit: 'starttls',
	benutzer: 'buero@bauwelt-handwerk.de',
	passwort: 'pw-geheim',
	absenderName: 'Bauwelt Handwerk',
	absenderAdresse: 'buero@bauwelt-handwerk.de',
	antwortAn: 'jamil@bauwelt-handwerk.de',
	bcc: 'kopie@bauwelt-handwerk.de'
};

function fabrik() {
	const aufrufe: { optionen: any; mails: any[] } = { optionen: null, mails: [] };
	const f = (o: any) => {
		aufrufe.optionen = o;
		return { sendMail: async (m: any) => (aufrufe.mails.push(m), { messageId: '<abc@test>' }) } as any;
	};
	return { f, aufrufe };
}

describe('SMTP-Versand (nodemailer)', () => {
	it('STARTTLS: requireTLS, nicht secure, Anmeldung, keine Datei-/URL-Zugriffe', async () => {
		const { f, aufrufe } = fabrik();
		const v = smtpVersand(cfg, f, oeffentlich);
		expect(v.verbunden).toBe(true);
		const r = await v.senden({ an: 'kunde@beispiel.test', betreff: 'Angebot', html: '<p>Hallo</p>', text: 'Hallo', anhaenge: [{ name: 'Angebot_AN-1.pdf', typ: 'application/pdf', bytes: new Uint8Array([1, 2]) }] });
		expect(r).toEqual({ messageId: '<abc@test>' });
		expect(aufrufe.optionen).toMatchObject({ host: '212.227.15.183', tls: { servername: 'smtp.ionos.de' }, port: 587, secure: false, requireTLS: true, auth: { user: 'buero@bauwelt-handwerk.de', pass: 'pw-geheim' }, disableFileAccess: true, disableUrlAccess: true });
		const m = aufrufe.mails[0];
		expect(m.from).toEqual({ name: 'Bauwelt Handwerk', address: 'buero@bauwelt-handwerk.de' });
		expect(m.to).toBe('kunde@beispiel.test');
		expect(m.replyTo).toBe('jamil@bauwelt-handwerk.de');
		expect(m.bcc).toEqual(['kopie@bauwelt-handwerk.de']);
		expect(m.attachments[0]).toMatchObject({ filename: 'Angebot_AN-1.pdf', contentType: 'application/pdf' });
		expect(Buffer.isBuffer(m.attachments[0].content)).toBe(true);
	});

	it('SSL (Port 465): secure; ohne Benutzer keine Anmeldung', async () => {
		const { f, aufrufe } = fabrik();
		await smtpVersand({ ...cfg, port: 465, sicherheit: 'ssl', benutzer: null, passwort: null }, f, oeffentlich).senden({ an: 'a@b.de', betreff: 'x', html: '', text: '' });
		expect(aufrufe.optionen.secure).toBe(true);
		expect(aufrufe.optionen.requireTLS).toBe(false);
		expect(aufrufe.optionen.auth).toBeUndefined();
	});

	it('SSRF: interner Server wird beim Senden abgelehnt (jede Mail prüft neu), kein Transport entsteht', async () => {
		const { f, aufrufe } = fabrik();
		const v = smtpVersand({ ...cfg, host: 'crm-db' }, f, async () => [{ address: '172.18.0.3', family: 4 }]);
		await expect(v.senden({ an: 'a@b.de', betreff: 'x', html: '', text: '' })).rejects.toMatchObject({ status: 400 });
		expect(aufrufe.optionen).toBeNull();
		await expect(smtpVersand({ ...cfg, port: 5432 }, f, oeffentlich).senden({ an: 'a@b.de', betreff: 'x', html: '', text: '' })).rejects.toMatchObject({ status: 400 });
	});

	it('Fehlermeldungen an Nutzer sind allgemein (keine rohe Server-Antwort)', () => {
		expect(mailFehlerText(Object.assign(new Error('Invalid login: 535 5.7.8 Error: authentication failed: geheim'), { code: 'EAUTH' }))).toBe('Anmeldung am Postfach fehlgeschlagen – Benutzername und Passwort prüfen.');
		expect(mailFehlerText(Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:587'), { code: 'ESOCKET' }))).toBe('Verbindung zum Mailserver fehlgeschlagen.');
		expect(mailFehlerText(Object.assign(new Error('550 no such user'), { code: 'EENVELOPE' }))).toBe('Der Mailserver hat den Empfänger abgelehnt.');
		expect(mailFehlerText(new Error('irgendwas internes 10.0.0.3'))).toBe('Versand fehlgeschlagen.');
	});

	it('Dateinamen für Anhänge sind ASCII-sicher (mit Endung)', () => {
		expect(sichererDateiname('Rechnung Müller & Söhne RE-1042.pdf')).toBe('Rechnung_Mueller_Soehne_RE-1042.pdf');
		expect(sichererDateiname('Straße/..\\x.pdf')).toBe('Strasse_x.pdf');
		expect(sichererDateiname('')).toBe('Anhang');
	});

	it('Echter Versand nur, wenn der Server es erlaubt (CRM_MAILVERSAND; im Testmodus standardmäßig aus)', () => {
		expect(mailVersandErlaubt({})).toEqual({ erlaubt: true, grund: null });
		expect(mailVersandErlaubt({ CRM_MAILVERSAND: 'aus' }).erlaubt).toBe(false);
		expect(mailVersandErlaubt({ CRM_TESTMODUS: '1' }).erlaubt).toBe(false);
		expect(mailVersandErlaubt({ CRM_TESTMODUS: '1', CRM_MAILVERSAND: 'an' }).erlaubt).toBe(true);
	});
});
