import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { KEIN_VERSAND, mailVersandFuer, sendeMail, setzeMailVersand, type Mail } from '../../src/lib/server/mail/versand';
import { ladeMailEinstellungen, listeMailAusgang, mailStatus, sendeTestmail, speichereMailEinstellungen } from '../../src/lib/server/mail/konfig';

/** Mailversand vorbereitet (Plan Lexware Phase 1, Task 2; Migration 118). */
describe('Mailversand (SMTP je Betrieb, Versandprotokoll)', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const mail: Mail = { an: 'kunde@beispiel.test', betreff: 'Hallo', html: '<p>Hallo</p>', text: 'Hallo', anhaenge: [{ name: 'Angebot Müller.pdf', typ: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }] };
	const oeffentlich = async () => [{ address: '212.227.15.183', family: 4 }];
	const eingabe = { aktiv: false, host: 'smtp.ionos.de', port: 587, sicherheit: 'starttls', benutzer: 'buero@bauwelt.test', passwort: 'Sehr-Geheim-123', absenderName: 'Bauwelt', absenderAdresse: 'buero@bauwelt.test', antwortAn: '', bcc: 'kopie@bauwelt.test' };

	beforeAll(async () => {
		process.env.CRM_GEHEIMNIS_SCHLUESSEL ||= 'test-schluessel-'.repeat(3);
		u = await baueUmgebung();
		root = u.root;
	});
	afterEach(() => setzeMailVersand(null));
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('ohne Einrichtung: kein Versand, im Protokoll „kein_versand“', async () => {
		expect(await mailVersandFuer(u.betriebA)).toBe(KEIN_VERSAND);
		const r = await sendeMail(kA(), mail, { art: 'angebot' });
		expect(r.status).toBe('kein_versand');
		const [z] = await root`select status, an, art, anhaenge from app.mail_ausgang where id = ${r.id}`;
		expect(z).toMatchObject({ status: 'kein_versand', an: 'kunde@beispiel.test', art: 'angebot' });
		expect(z.anhaenge[0]).toMatchObject({ name: 'Angebot_Mueller.pdf', bytes: 3, sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' });
	});

	it('Attrappe: gesendet mit message_id; Fehler der Attrappe → „fehler“ mit Text, kein Wurf', async () => {
		const gesendet: Mail[] = [];
		setzeMailVersand({ verbunden: true, senden: async (m) => (gesendet.push(m), { messageId: '<m1@test>' }) });
		const r = await sendeMail(kA(), mail, { art: 'ab', bezugTyp: 'auftrag', bezugId: u.auftragA });
		expect(r.status).toBe('gesendet');
		expect(gesendet[0].anhaenge![0].name).toBe('Angebot_Mueller.pdf');
		expect((await root`select status, message_id, gesendet_am from app.mail_ausgang where id = ${r.id}`)[0]).toMatchObject({ status: 'gesendet', message_id: '<m1@test>' });
		setzeMailVersand({ verbunden: true, senden: async () => { throw Object.assign(new Error('535 Authentication failed for 10.0.0.3'), { code: 'EAUTH' }); } });
		const f = await sendeMail(kA(), mail, { art: 'ab' });
		expect(f).toMatchObject({ status: 'fehler', fehler: 'Anmeldung am Postfach fehlgeschlagen – Benutzername und Passwort prüfen.' });
		expect((await root`select fehler from app.mail_ausgang where id = ${f.id}`)[0].fehler).not.toContain('10.0.0.3');
		await expect(sendeMail(kA(), { ...mail, an: 'kaputt' }, { art: 'ab' })).rejects.toMatchObject({ status: 400 });
	});

	it('Einstellungen: Passwort verschlüsselt, für crm_app nicht lesbar, nie zurückgegeben; RLS zwischen Betrieben', async () => {
		await speichereMailEinstellungen(kA(), eingabe, oeffentlich);
		const e = await ladeMailEinstellungen(kA());
		expect(e).toMatchObject({ host: 'smtp.ionos.de', port: 587, aktiv: false, passwortGesetzt: true, passwortHinweis: '…-123' });
		expect(JSON.stringify(e)).not.toContain('Sehr-Geheim');
		const [roh] = await root`select passwort from app.mail_konfig where betrieb_id = ${u.betriebA}`;
		expect(Buffer.from(roh.passwort).toString('latin1')).not.toContain('Sehr-Geheim');
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select passwort from app.mail_konfig`)).rejects.toThrow(/permission denied/);
		expect(await u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`select host from app.mail_konfig`)).toHaveLength(0);
		expect((await ladeMailEinstellungen(kB())).host).toBeNull();
		// leeres Passwortfeld beim Speichern = altes Passwort bleibt
		await speichereMailEinstellungen(kA(), { ...eingabe, passwort: '', absenderName: 'Bauwelt Handwerk' }, oeffentlich);
		expect((await ladeMailEinstellungen(kA())).passwortGesetzt).toBe(true);
		// eingeschaltet, aber Vorschau/Testmodus-Sperre aus: SMTP-Versand mit entschlüsseltem Passwort
		await speichereMailEinstellungen(kA(), { ...eingabe, passwort: '', aktiv: true }, oeffentlich);
		const vorher = process.env.CRM_MAILVERSAND;
		process.env.CRM_MAILVERSAND = 'aus';
		expect(await mailVersandFuer(u.betriebA)).toBe(KEIN_VERSAND);
		process.env.CRM_MAILVERSAND = 'an';
		const v = await mailVersandFuer(u.betriebA);
		expect(v.verbunden).toBe(true);
		expect(v).not.toBe(KEIN_VERSAND);
		if (vorher === undefined) delete process.env.CRM_MAILVERSAND;
		else process.env.CRM_MAILVERSAND = vorher;
		// Betrieb B bleibt ohne Versand
		expect(await mailVersandFuer(u.betriebB)).toBe(KEIN_VERSAND);
	});

	it('Prüfung der Eingaben: einschalten nur vollständig, Adressen/Port gültig', async () => {
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, aktiv: true, host: '' }, oeffentlich)).rejects.toMatchObject({ status: 400 });
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, port: 5432 }, oeffentlich)).rejects.toMatchObject({ status: 400 });
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, absenderAdresse: 'kein-at' }, oeffentlich)).rejects.toMatchObject({ status: 400 });
		// SSRF: interne Server (echte Auflösung im Docker-Netz bzw. IP direkt) werden abgelehnt
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, host: 'crm-db' })).rejects.toMatchObject({ status: 400 });
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, host: '127.0.0.1' })).rejects.toMatchObject({ status: 400 });
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, host: '169.254.169.254' })).rejects.toMatchObject({ status: 400 });
		await expect(speichereMailEinstellungen(kB(), { ...eingabe, host: 'smtp.x.de\r\nRCPT' }, oeffentlich)).rejects.toMatchObject({ status: 400 });
	});

	it('Testmail und Status: Protokoll zeigt die Testmail, Status nennt Fehler der letzten 24 Stunden', async () => {
		const gesendet: Mail[] = [];
		setzeMailVersand({ verbunden: true, senden: async (m) => void gesendet.push(m) });
		const r = await sendeTestmail(kA(), 'chef@beispiel.test');
		expect(r.status).toBe('gesendet');
		expect(gesendet[0].betreff).toMatch(/Testmail/);
		const liste = await listeMailAusgang(kA());
		expect(liste[0]).toMatchObject({ art: 'test', status: 'gesendet', an: 'chef@beispiel.test' });
		expect(await listeMailAusgang(kB())).toHaveLength(0);
		const s = await mailStatus(kA());
		expect(s.eingerichtet).toBe(true);
		expect(s.fehler24h).toBeGreaterThanOrEqual(1);
	});
});
