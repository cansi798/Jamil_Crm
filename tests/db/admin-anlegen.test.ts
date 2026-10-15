import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { adminAnlegen, AdminFehler, leseArgumente } from '../../scripts/admin-anlegen';
import { initDb, schliesseDb } from '../../src/lib/server/db';
import { pruefePasswort } from '../../src/lib/server/auth/passwort';
import { leereVersuche } from '../../src/lib/server/auth/ratelimit';
import { VORSITZUNG_COOKIE, bereiteEinrichtungVor, vorsitzungsDaten } from '../../src/lib/server/auth/vorsitzung';
import { actions as anmeldeAktion } from '../../src/routes/anmelden/+page.server';

const PASSWORT = 'erstes-Admin-Passwort-1';

function fakeCookies() {
	const speicher = new Map<string, string>();
	return {
		speicher,
		get: (n: string) => speicher.get(n),
		set: (n: string, wert: string) => void speicher.set(n, wert),
		delete: (n: string) => void speicher.delete(n)
	};
}

/** Formular-Aktion ausführen; redirect() wirft ein Objekt mit status/location. */
async function anmelden(cookies: ReturnType<typeof fakeCookies>, email: string, passwort: string) {
	const form = new FormData();
	form.set('email', email);
	form.set('passwort', passwort);
	const event = {
		request: new Request('http://localhost/anmelden', { method: 'POST', body: form }),
		cookies,
		locals: { nutzer: null },
		url: new URL('http://localhost/anmelden')
	} as never;
	try {
		return { ergebnis: await anmeldeAktion.default(event), umleitung: null };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.status === 'number' && typeof r.location === 'string') {
			return { ergebnis: null, umleitung: { status: r.status, location: r.location } };
		}
		throw e;
	}
}

describe('admin-anlegen (erster Plattform-Admin)', () => {
	let db: TestDb;
	let root: postgres.Sql;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 1, onnotice: () => {} });
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	const anzahl = async () => {
		const [z] = await root`
			select (select count(*)::int from app.benutzer) as benutzer,
				(select count(*)::int from app.plattform_admins) as admins`;
		return z;
	};

	it('legt Benutzer ohne Betrieb plus plattform_admins-Eintrag an (Argon2id, ohne TOTP)', async () => {
		const { id } = await adminAnlegen(db.urlSuper, {
			email: '  Erster.Admin@Beispiel.TEST ',
			name: 'Erste Admin',
			passwort: PASSWORT
		});
		const [b] = await root`
			select b.id, b.email::text as email, b.name, b.betrieb_id, b.rolle_id, b.aktiv, b.passwort_hash,
				b.totp_aktiv, b.totp_geheim, (p.benutzer_id is not null) as ist_admin
			from app.benutzer b left join app.plattform_admins p on p.benutzer_id = b.id
			where b.id = ${id}`;
		expect(b).toMatchObject({
			email: 'erster.admin@beispiel.test',
			name: 'Erste Admin',
			betrieb_id: null,
			rolle_id: null,
			aktiv: true,
			totp_aktiv: false,
			totp_geheim: null,
			ist_admin: true
		});
		expect(b.passwort_hash).toMatch(/^\$argon2id\$/);
		expect(await pruefePasswort(b.passwort_hash, PASSWORT)).toBe(true);
	});

	it('verweigert eine schon vorhandene E-Mail (auch in anderer Schreibweise) und ändert nichts', async () => {
		const vorher = await anzahl();
		await expect(
			adminAnlegen(db.urlSuper, { email: 'ERSTER.ADMIN@beispiel.test', name: 'Zweite', passwort: PASSWORT })
		).rejects.toThrow(AdminFehler);
		await expect(
			adminAnlegen(db.urlSuper, { email: 'erster.admin@beispiel.test', name: 'Zweite', passwort: PASSWORT })
		).rejects.toThrow(/existiert bereits/);
		expect(await anzahl()).toEqual(vorher);
	});

	it('verweigert zu kurze/zu lange Passwörter, leeren Namen und ungültige E-Mail – ohne etwas anzulegen', async () => {
		const vorher = await anzahl();
		await expect(
			adminAnlegen(db.urlSuper, { email: 'kurz@beispiel.test', name: 'Kurz', passwort: '123456789' })
		).rejects.toThrow(/mindestens 10 Zeichen/);
		await expect(
			adminAnlegen(db.urlSuper, { email: 'lang@beispiel.test', name: 'Lang', passwort: 'x'.repeat(1025) })
		).rejects.toThrow(/höchstens 1024 Zeichen/);
		await expect(
			adminAnlegen(db.urlSuper, { email: 'ohne-name@beispiel.test', name: '  ', passwort: PASSWORT })
		).rejects.toThrow(/Name/);
		await expect(
			adminAnlegen(db.urlSuper, { email: 'keine-mail', name: 'X', passwort: PASSWORT })
		).rejects.toThrow(/E-Mail/);
		expect(await anzahl()).toEqual(vorher);
	});

	it('erste Anmeldung: nur Vor-Sitzung, Pflicht-Einrichtung der Zwei-Faktor-Anmeldung', async () => {
		leereVersuche();
		const cookies = fakeCookies();
		const { umleitung } = await anmelden(cookies, 'erster.admin@beispiel.test', PASSWORT);
		expect(umleitung).toEqual({ status: 303, location: '/konto/zwei-faktor' });
		const token = cookies.speicher.get(VORSITZUNG_COOKIE)!;
		expect(token).toBeTruthy();
		expect(await vorsitzungsDaten(token)).toMatchObject({ totpAktiv: false, gesperrt: false });
		// keine volle Sitzung, solange der zweite Faktor fehlt
		const [{ voll }] = await root`
			select count(*)::int as voll from app.sitzungen s join app.benutzer b on b.id = s.benutzer_id
			where b.email = 'erster.admin@beispiel.test' and not s.zweiter_faktor_offen`;
		expect(voll).toBe(0);
		// Die Einrichtung liefert ein neues Geheimnis samt QR-Code
		const einrichtung = await bereiteEinrichtungVor(token);
		expect(einrichtung?.geheimnis).toMatch(/^[A-Z2-7]{16,}$/);
		expect(einrichtung?.qr).toMatch(/^data:image\/png;base64,/);
	});

	describe('Kommandozeile', () => {
		it('leseArgumente: E-Mail, Name, --passwort-stdin; Passwort als Argument wird abgelehnt', () => {
			expect(leseArgumente(['--email', 'a@b.test', '--name', 'A B'])).toEqual({
				email: 'a@b.test',
				name: 'A B',
				passwortStdin: false
			});
			expect(leseArgumente(['--email=a@b.test', '--name=A', '--passwort-stdin']).passwortStdin).toBe(true);
			expect(() => leseArgumente(['--email', 'a@b.test', '--name', 'A', '--passwort', 'geheim123456'])).toThrow(
				/nie als Argument/
			);
			expect(() => leseArgumente(['--email', 'a@b.test', '--name', 'A', '--passwort=geheim123456'])).toThrow(
				/nie als Argument/
			);
			expect(() => leseArgumente(['--name', 'A'])).toThrow(/--email/);
			expect(() => leseArgumente(['--email', 'a@b.test'])).toThrow(/--name/);
			expect(() => leseArgumente(['--email', 'a@b.test', '--name', 'A', 'überzählig'])).toThrow(/Aufruf/);
		});

		const skript = (argumente: string[], eingabe?: string) =>
			spawnSync('npx', ['tsx', 'scripts/admin-anlegen.ts', ...argumente], {
				env: { ...process.env, PGDATABASE: 'crm_test' },
				input: eingabe,
				encoding: 'utf8'
			});

		it('legt per --passwort-stdin an, gibt das Passwort nie aus; zweiter Lauf → Meldung, Exit ≠ 0', () => {
			const geheim = 'stdin-Passwort-0815';
			const args = ['--email', 'cli-admin@beispiel.test', '--name', 'CLI Admin', '--passwort-stdin'];
			const erst = skript(args, `${geheim}\n`);
			expect(erst.status, erst.stderr).toBe(0);
			expect(erst.stdout).toMatch(/Plattform-Admin „cli-admin@beispiel.test“ angelegt/);
			expect(erst.stdout + erst.stderr).not.toContain(geheim);

			const zweit = skript(args, `${geheim}\n`);
			expect(zweit.status).not.toBe(0);
			expect(zweit.stderr).toMatch(/existiert bereits/);
			expect(zweit.stdout + zweit.stderr).not.toContain(geheim);
		}, 60_000);

		it('ohne Terminal und ohne --passwort-stdin: Abbruch statt Klartext-Eingabe; zu kurzes Passwort: Abbruch', async () => {
			const ohneTty = skript(['--email', 'tty@beispiel.test', '--name', 'T'], 'irgendwas-langes-1\n');
			expect(ohneTty.status).not.toBe(0);
			expect(ohneTty.stderr).toMatch(/--passwort-stdin/);
			const kurz = skript(['--email', 'kurz2@beispiel.test', '--name', 'K', '--passwort-stdin'], 'kurz\n');
			expect(kurz.status).not.toBe(0);
			expect(kurz.stderr).toMatch(/mindestens 10 Zeichen/);
			const [{ n }] = await root`
				select count(*)::int as n from app.benutzer where email in ('tty@beispiel.test', 'kurz2@beispiel.test')`;
			expect(n).toBe(0);
		}, 60_000);
	});

	it('gibt bei Erfolg weder Passwort noch Hash auf der Konsole aus', async () => {
		const ausgabe: string[] = [];
		const log = vi.spyOn(console, 'log').mockImplementation((...a) => void ausgabe.push(a.join(' ')));
		try {
			await adminAnlegen(db.urlSuper, { email: 'leise@beispiel.test', name: 'Leise', passwort: PASSWORT });
		} finally {
			log.mockRestore();
		}
		expect(ausgabe.join('\n')).not.toContain(PASSWORT);
		expect(ausgabe.join('\n')).not.toContain('$argon2');
	});
});
