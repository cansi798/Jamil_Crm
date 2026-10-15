import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb, schliesseDb } from '../../src/lib/server/db';
import { ApiFehler } from '../../src/lib/server/fehler';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { ladeEin } from '../../src/lib/server/benutzer';
import { nimmEinladungAn } from '../../src/lib/server/auth/einladung';
import { GET } from '../../src/routes/api/protokoll/+server';

const PASSWORT = 'ein-gutes-Passwort';
const GEHEIM_HASH = '$argon2id$geheimer-passwort-hash-NIEMALS-IM-PROTOKOLL';
const GEHEIM_TOTP = 'JBSWY3DPEHPK3PXP-NIEMALS-IM-PROTOKOLL';

/** Spalten, die ausdrücklich NICHT protokolliert werden – jede neue Spalte muss hier oder im Protokoll landen. */
const BENUTZER_AUSGESCHLOSSEN = [
	'passwort_hash',
	'totp_geheim',
	'totp_aktiv',
	'totp_letzter_schritt',
	'totp_fehlversuche',
	'totp_gesperrt_bis',
	'totp_sperr_stufe',
	'letzte_aktivitaet'
];
const EINLADUNGEN_AUSGESCHLOSSEN = ['token_hash'];

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

type Ant = { status: number; koerper: any };

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const schlafe = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Änderungsprotokoll', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefRolleA: string, monteurRolleA: string, chefRolleB: string;
	let chefAId: string, monteurAId: string, chefBId: string;
	let chefA: Nutzer, monteurA: Nutzer, chefB: Nutzer;

	const alsApp = <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: betrieb, benutzerId: benutzer }, fn);

	const protokoll = (tabelle: string, datensatz: string) =>
		root`select * from app.aenderungen where tabelle = ${tabelle} and datensatz_id = ${datensatz} order by id`;

	const abfrage = async (nutzer: Nutzer | null, suche: Record<string, string>) => {
		const url = new URL('http://localhost/api/protokoll');
		for (const [k, v] of Object.entries(suche)) url.searchParams.set(k, v);
		return antwort(await GET({ locals: { nutzer }, url } as never));
	};

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await root`delete from app.sitzungen`;
		await root`delete from app.einladungen`;
		await root`delete from app.benutzer`;
		await root`delete from app.rollen`;
		await root`delete from app.aenderungen`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]})
				returning id`)[0].id as string;
		chefRolleA = await rolle(betriebA, 'Chef', VORLAGEN.chef);
		monteurRolleA = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		chefRolleB = await rolle(betriebB, 'Chef', VORLAGEN.chef);
		const benutzer = async (betrieb: string, rolle: string, email: string) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id, totp_geheim, totp_aktiv)
				values (${betrieb}, ${email}, ${email}, ${GEHEIM_HASH}, ${rolle}, ${GEHEIM_TOTP}, true) returning id`)[0]
				.id as string;
		chefAId = await benutzer(betriebA, chefRolleA, 'chef-a@beispiel.test');
		monteurAId = await benutzer(betriebA, monteurRolleA, 'monteur-a@beispiel.test');
		chefBId = await benutzer(betriebB, chefRolleB, 'chef-b@beispiel.test');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		monteurA = nutzerVon(monteurAId, betriebA, VORLAGEN.monteur);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
		// Die Ausgangsdaten sollen das Protokoll nicht verfälschen.
		await root`delete from app.aenderungen`;
	});

	describe('Brief', () => {
		it('Rolle ändern erzeugt Eintrag mit vorher/nachher und benutzer_id', async () => {
			await alsApp(
				betriebA,
				chefAId,
				(tx) => tx`update app.rollen set name = 'Obermonteur', rechte = ${['kunden.lesen']} where id = ${monteurRolleA}`
			);
			const z = await protokoll('rollen', monteurRolleA);
			expect(z).toHaveLength(1);
			expect(z[0]).toMatchObject({
				betrieb_id: betriebA,
				benutzer_id: chefAId,
				tabelle: 'rollen',
				datensatz_id: monteurRolleA,
				aktion: 'geaendert',
				quelle: 'oberflaeche'
			});
			expect(z[0].vorher).toMatchObject({ name: 'Monteur', rechte: [...VORLAGEN.monteur] });
			expect(z[0].nachher).toMatchObject({ name: 'Obermonteur', rechte: ['kunden.lesen'] });
			expect(z[0].zeit).toBeInstanceOf(Date);
		});

		it('passwort_hash taucht nie im Protokoll auf', async () => {
			await alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set name = 'Neuer Name' where id = ${monteurAId}`);
			await root`update app.benutzer set passwort_hash = ${GEHEIM_HASH + 'x'}, name = 'Als Root' where id = ${monteurAId}`;
			await root`delete from app.benutzer where id = ${monteurAId}`;
			const alle = await root`select * from app.aenderungen where tabelle = 'benutzer'`;
			expect(alle.length).toBe(3);
			const text = JSON.stringify(alle);
			expect(text).not.toContain('NIEMALS-IM-PROTOKOLL');
			expect(text).not.toContain('passwort_hash');
			expect(text).not.toContain('totp_geheim');
			expect(text).not.toContain('argon2id');
		});

		it('crm_app kann aenderungen nicht löschen (und nicht ändern)', async () => {
			await alsApp(betriebA, chefAId, (tx) => tx`update app.rollen set name = 'X' where id = ${monteurRolleA}`);
			await expect(alsApp(betriebA, chefAId, (tx) => tx`delete from app.aenderungen`)).rejects.toThrow(
				/permission denied/
			);
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.aenderungen set tabelle = 'x'`)
			).rejects.toThrow(/permission denied/);
			await expect(alsApp(betriebA, chefAId, (tx) => tx`truncate app.aenderungen`)).rejects.toThrow(
				/permission denied/
			);
			expect((await root`select count(*)::int as n from app.aenderungen`)[0].n).toBe(1);
		});
	});

	describe('Trigger app.protokolliere()', () => {
		it('protokolliert Anlegen, Ändern und Löschen; Anlegen hat nur nachher, Löschen nur vorher', async () => {
			const [neu] = await alsApp(
				betriebA,
				chefAId,
				(tx) => tx`insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Praktikant', ${[]}) returning id`
			);
			await alsApp(betriebA, chefAId, (tx) => tx`update app.rollen set name = 'Azubi' where id = ${neu.id}`);
			await alsApp(betriebA, chefAId, (tx) => tx`delete from app.rollen where id = ${neu.id}`);
			const z = await protokoll('rollen', neu.id);
			expect(z.map((e) => e.aktion)).toEqual(['angelegt', 'geaendert', 'geloescht']);
			expect(z[0].vorher).toBeNull();
			expect(z[0].nachher).toMatchObject({ name: 'Praktikant' });
			expect(z[2].vorher).toMatchObject({ name: 'Azubi' });
			expect(z[2].nachher).toBeNull();
			expect(z.every((e) => e.benutzer_id === chefAId && e.betrieb_id === betriebA)).toBe(true);
		});

		it('quelle kommt aus app.quelle, sonst "oberflaeche"', async () => {
			await alsApp(betriebA, chefAId, async (tx) => {
				await tx`select set_config('app.quelle', 'sprache', true)`;
				await tx`update app.rollen set name = 'Per Sprache' where id = ${monteurRolleA}`;
			});
			await alsApp(betriebA, chefAId, async (tx) => {
				await tx`select set_config('app.quelle', '', true)`;
				await tx`update app.rollen set name = 'Leer' where id = ${monteurRolleA}`;
			});
			const z = await protokoll('rollen', monteurRolleA);
			expect(z.map((e) => e.quelle)).toEqual(['sprache', 'oberflaeche']);
		});

		it('ein unbrauchbarer app.benutzer_id lässt die Änderung nicht scheitern (benutzer_id NULL)', async () => {
			await root.begin(async (tx) => {
				await tx`select set_config('app.benutzer_id', 'kein-uuid', true)`;
				await tx`update app.rollen set name = 'Trotzdem' where id = ${monteurRolleA}`;
			});
			const z = await protokoll('rollen', monteurRolleA);
			expect(z).toHaveLength(1);
			expect(z[0].benutzer_id).toBeNull();
		});

		it('Änderungen, die nur ausgeschlossene Spalten betreffen, erzeugen keinen Eintrag', async () => {
			await root`update app.benutzer set letzte_aktivitaet = now(), totp_fehlversuche = 3 where id = ${monteurAId}`;
			await root`update app.benutzer set passwort_hash = 'neu' where id = ${monteurAId}`;
			expect(await protokoll('benutzer', monteurAId)).toHaveLength(0);
			await alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set aktiv = false where id = ${monteurAId}`);
			expect(await protokoll('benutzer', monteurAId)).toHaveLength(1);
		});

		it('Benutzer-Eintrag enthält fachliche Spalten, aber keine ausgeschlossene', async () => {
			await alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set aktiv = false where id = ${monteurAId}`);
			const [e] = await protokoll('benutzer', monteurAId);
			expect(e.vorher).toMatchObject({ id: monteurAId, aktiv: true, name: 'monteur-a@beispiel.test', rolle_id: monteurRolleA });
			expect(e.nachher).toMatchObject({ id: monteurAId, aktiv: false });
			for (const spalte of BENUTZER_AUSGESCHLOSSEN) {
				expect(e.vorher).not.toHaveProperty(spalte);
				expect(e.nachher).not.toHaveProperty(spalte);
			}
		});

		it('jede Spalte von benutzer und einladungen ist protokolliert oder ausdrücklich ausgeschlossen', async () => {
			const [{ id }] = await root`
				insert into app.einladungen (betrieb_id, email, rolle_id, token_hash, eingeladen_von)
				values (${betriebA}, 'gast@beispiel.test', ${monteurRolleA}, ${Buffer.alloc(32, 7)}, ${chefAId}) returning id`;
			const pruefe = async (tabelle: string, datensatz: string, ausgeschlossen: string[]) => {
				const spalten = (
					await root`
						select column_name from information_schema.columns
						where table_schema = 'app' and table_name = ${tabelle}`
				).map((s) => s.column_name as string);
				const [angelegt] = await root`
					select nachher from app.aenderungen
					where tabelle = ${tabelle} and datensatz_id = ${datensatz} and aktion = 'angelegt'`;
				const protokolliert = Object.keys(angelegt.nachher);
				for (const s of spalten) {
					const ok = protokolliert.includes(s) !== ausgeschlossen.includes(s);
					expect(ok, `${tabelle}.${s}: entweder protokolliert oder ausgeschlossen, nicht beides/keins`).toBe(true);
				}
			};
			await root`delete from app.aenderungen where tabelle = 'benutzer'`;
			// Benutzer-Anlegen-Eintrag frisch erzeugen
			const [b] = await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betriebA}, 'frisch@beispiel.test', 'Frisch', 'x', ${monteurRolleA}) returning id`;
			await pruefe('benutzer', b.id, BENUTZER_AUSGESCHLOSSEN);
			await pruefe('einladungen', id, EINLADUNGEN_AUSGESCHLOSSEN);
		});

		it('Einladung: token_hash steht nicht im Protokoll, E-Mail und Rolle schon', async () => {
			const { token } = await ladeEin({ betriebId: betriebA, benutzerId: chefAId }, VORLAGEN.chef, {
				email: 'gast@beispiel.test',
				rolleId: monteurRolleA
			});
			const [einl] = await root`select id from app.einladungen`;
			const z = await protokoll('einladungen', einl.id);
			expect(z).toHaveLength(1);
			expect(z[0]).toMatchObject({ aktion: 'angelegt', benutzer_id: chefAId, betrieb_id: betriebA });
			expect(z[0].nachher).toMatchObject({ email: 'gast@beispiel.test', rolle_id: monteurRolleA, eingeladen_von: chefAId });
			expect(z[0].nachher).not.toHaveProperty('token_hash');
			const text = JSON.stringify(await root`select * from app.aenderungen`);
			expect(text).not.toContain('token_hash');
			expect(text).not.toContain(token);
			expect(text).not.toContain(Buffer.from(token).toString('hex'));
		});

		it('Einladung widerrufen (löschen) wird protokolliert', async () => {
			await ladeEin({ betriebId: betriebA, benutzerId: chefAId }, VORLAGEN.chef, {
				email: 'gast@beispiel.test',
				rolleId: monteurRolleA
			});
			const [einl] = await root`select id from app.einladungen`;
			await alsApp(betriebA, chefAId, (tx) => tx`delete from app.einladungen where id = ${einl.id}`);
			const z = await protokoll('einladungen', einl.id);
			expect(z.map((e) => e.aktion)).toEqual(['angelegt', 'geloescht']);
			expect(z[1].vorher).not.toHaveProperty('token_hash');
		});

		it('Einladung annehmen (crm_auth → SECURITY DEFINER als crm) scheitert nicht und protokolliert korrekt', async () => {
			const { token } = await ladeEin({ betriebId: betriebA, benutzerId: chefAId }, VORLAGEN.chef, {
				email: 'nina@beispiel.test',
				rolleId: monteurRolleA
			});
			const r = await nimmEinladungAn(token, 'Nina Neu', PASSWORT);
			expect(r.art).toBe('ok');
			if (r.art !== 'ok') return;

			const benutzer = await protokoll('benutzer', r.benutzerId);
			expect(benutzer).toHaveLength(1);
			expect(benutzer[0]).toMatchObject({
				betrieb_id: betriebA,
				benutzer_id: null, // Systemvorgang: kein Benutzerkontext
				aktion: 'angelegt',
				quelle: 'oberflaeche'
			});
			expect(benutzer[0].nachher).toMatchObject({
				email: 'nina@beispiel.test',
				name: 'Nina Neu',
				rolle_id: monteurRolleA,
				aktiv: true
			});
			const text = JSON.stringify(await root`select * from app.aenderungen`);
			expect(text).not.toContain('argon2id');
			expect(text).not.toContain('passwort_hash');

			const [einl] = await root`select id from app.einladungen where email = 'nina@beispiel.test'`;
			const e = await protokoll('einladungen', einl.id);
			expect(e.map((x) => x.aktion)).toEqual(['angelegt', 'geaendert']);
			expect(e[1].vorher.angenommen).toBeNull();
			expect(e[1].nachher.angenommen).not.toBeNull();
			expect(e[1].benutzer_id).toBeNull();
		});

		it('Löschen eines Betriebs (Kaskade als Eigentümer) scheitert nicht am Protokoll', async () => {
			const [t] = await root`select id from app.tarife where schluessel = 'basis'`;
			const [{ id: weg }] = await root`
				insert into app.betriebe (name, tarif_id, abo_status) values ('Weg GmbH', ${t.id}, 'aktiv') returning id`;
			const [{ id: rolle }] = await root`insert into app.rollen (betrieb_id, name) values (${weg}, 'R') returning id`;
			await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${weg}, 'weg@beispiel.test', 'Weg', 'x', ${rolle})`;
			await root`delete from app.betriebe where id = ${weg}`;
			const z = await root`select aktion from app.aenderungen where betrieb_id = ${weg} order by id`;
			expect(z.map((e) => e.aktion)).toContain('geloescht');
		});

		it('Benutzer ohne Betrieb (Plattform-Admin) wird nicht protokolliert und scheitert nicht', async () => {
			await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash)
				values (null, 'admin@plattform.test', 'Admin', 'x')`;
			expect((await root`select count(*)::int as n from app.aenderungen`)[0].n).toBe(0);
		});
	});

	describe('Rechte und Mandantentrennung der Tabelle', () => {
		beforeEach(async () => {
			await alsApp(betriebA, chefAId, (tx) => tx`update app.rollen set name = 'A-Neu' where id = ${monteurRolleA}`);
			await alsApp(betriebB, chefBId, (tx) => tx`update app.rollen set name = 'B-Neu' where id = ${chefRolleB}`);
		});

		it('crm_app sieht nur Einträge des eigenen Betriebs', async () => {
			const a = await alsApp(betriebA, chefAId, (tx) => tx`select betrieb_id, datensatz_id from app.aenderungen`);
			expect(a).toHaveLength(1);
			expect(a[0].betrieb_id).toBe(betriebA);
			const b = await alsApp(betriebB, chefBId, (tx) => tx`select betrieb_id from app.aenderungen`);
			expect(b.every((z) => z.betrieb_id === betriebB)).toBe(true);
		});

		it('ohne Betriebskontext sieht crm_app nichts', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				expect(await app`select * from app.aenderungen`).toHaveLength(0);
			} finally {
				await app.end();
			}
		});

		it('crm_app kann keine Einträge für einen fremden Betrieb oder im Namen eines anderen Benutzers anlegen', async () => {
			await expect(
				alsApp(
					betriebA,
					chefAId,
					(tx) => tx`
						insert into app.aenderungen (betrieb_id, benutzer_id, tabelle, datensatz_id, aktion, nachher)
						values (${betriebB}, ${chefAId}, 'rollen', ${chefRolleB}, 'angelegt', '{}')`
				)
			).rejects.toThrow(/row-level security/);
			await expect(
				alsApp(
					betriebA,
					chefAId,
					(tx) => tx`
						insert into app.aenderungen (betrieb_id, benutzer_id, tabelle, datensatz_id, aktion, nachher)
						values (${betriebA}, ${monteurAId}, 'rollen', ${monteurRolleA}, 'angelegt', '{}')`
				)
			).rejects.toThrow(/row-level security/);
		});

		it('crm_admin und crm_auth haben keinen Zugriff', async () => {
			for (const url of [db.urlAdmin, db.urlAuth]) {
				const sql = postgres(url, { max: 1, onnotice: () => {} });
				try {
					await expect(sql`select * from app.aenderungen`).rejects.toThrow(/permission denied/);
					await expect(
						sql`insert into app.aenderungen (betrieb_id, tabelle, datensatz_id, aktion, nachher)
							values (${betriebA}, 'rollen', ${monteurRolleA}, 'angelegt', '{}')`
					).rejects.toThrow(/permission denied/);
				} finally {
					await sql.end();
				}
			}
		});

		it('RLS ist aktiv und erzwungen', async () => {
			const [t] = await root`
				select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.aenderungen'::regclass`;
			expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
		});

		it('die Einträge sind in sich stimmig (Check-Constraint)', async () => {
			await expect(
				root`insert into app.aenderungen (betrieb_id, tabelle, datensatz_id, aktion, vorher, nachher)
					values (${betriebA}, 'rollen', ${monteurRolleA}, 'angelegt', '{}', '{}')`
			).rejects.toThrow(/check/);
		});
	});

	describe('Ruling R17', () => {
		it('crm_app kann keine Benutzer löschen', async () => {
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`delete from app.benutzer where id = ${monteurAId}`)
			).rejects.toThrow(/permission denied/);
			expect((await root`select count(*)::int as n from app.benutzer where id = ${monteurAId}`)[0].n).toBe(1);
		});

		it('crm_app kann benutzer.id und benutzer.betrieb_id nicht ändern', async () => {
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set betrieb_id = ${betriebA} where id = ${monteurAId}`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set id = gen_random_uuid() where id = ${monteurAId}`)
			).rejects.toThrow(/permission denied/);
		});

		it('Rolle, Aktiv-Status und Name lassen sich weiterhin ändern', async () => {
			await alsApp(
				betriebA,
				chefAId,
				(tx) => tx`update app.benutzer set rolle_id = ${chefRolleA}, aktiv = false, name = 'Neu' where id = ${monteurAId}`
			);
			const [b] = await root`select rolle_id, aktiv, name from app.benutzer where id = ${monteurAId}`;
			expect(b).toEqual({ rolle_id: chefRolleA, aktiv: false, name: 'Neu' });
		});

		it('doppelte offene Einladung (gleichzeitig) → 409 mit deutscher Meldung statt 500', async () => {
			const k = { betriebId: betriebA, benutzerId: chefAId };
			let eingefuegt!: () => void;
			let freigeben!: () => void;
			const bereit = new Promise<void>((r) => (eingefuegt = r));
			const warte = new Promise<void>((r) => (freigeben = r));
			// Eine offene, noch nicht festgeschriebene Einladung hält den Schlüssel der eindeutigen Prüfung.
			const halter = mitBetrieb(k, async (tx) => {
				await tx`
					insert into app.einladungen (betrieb_id, email, rolle_id, token_hash, eingeladen_von)
					values (${betriebA}, 'doppelt@beispiel.test', ${monteurRolleA}, ${Buffer.alloc(32, 1)}, ${chefAId})`;
				eingefuegt();
				await warte;
			});
			await bereit;
			const zweite = ladeEin(k, VORLAGEN.chef, { email: 'doppelt@beispiel.test', rolleId: monteurRolleA }).then(
				() => null,
				(e) => e
			);
			// warten, bis die zweite Einfügung an der Sperre hängt
			for (let i = 0; i < 100; i++) {
				const [{ n }] = await root`select count(*)::int as n from pg_locks where locktype = 'transactionid' and not granted`;
				if (n > 0) break;
				await schlafe(50);
			}
			freigeben();
			await halter;
			const fehler = await zweite;
			expect(fehler).toBeInstanceOf(ApiFehler);
			expect(fehler.status).toBe(409);
			expect(fehler.message).toBe('Für diese E-Mail gibt es bereits eine offene Einladung.');
			expect((await root`select count(*)::int as n from app.einladungen`)[0].n).toBe(1);
		});
	});

	describe('GET /api/protokoll', () => {
		const rolleAendern = async (n: number) => {
			for (let i = 0; i < n; i++) {
				await alsApp(
					betriebA,
					chefAId,
					(tx) => tx`update app.rollen set name = ${'Name ' + i} where id = ${monteurRolleA}`
				);
			}
		};

		it('liefert den Verlauf eines Datensatzes, neueste zuerst, mit Benutzername', async () => {
			await rolleAendern(2);
			const a = await abfrage(chefA, { tabelle: 'rollen', datensatz: monteurRolleA });
			expect(a.status).toBe(200);
			expect(a.koerper.eintraege).toHaveLength(2);
			expect(a.koerper.eintraege[0]).toMatchObject({
				aktion: 'geaendert',
				benutzerId: chefAId,
				benutzerName: 'chef-a@beispiel.test',
				quelle: 'oberflaeche',
				nachher: { name: 'Name 1' },
				vorher: { name: 'Name 0' }
			});
			expect(a.koerper.eintraege[1].nachher).toMatchObject({ name: 'Name 0' });
			expect(new Date(a.koerper.eintraege[0].zeit).getTime()).not.toBeNaN();
			expect(a.koerper.naechsteVor).toBeNull();
		});

		it('401 ohne Anmeldung, 403 ohne Recht, 403 für Plattform-Admins', async () => {
			const suche = { tabelle: 'rollen', datensatz: monteurRolleA };
			expect((await abfrage(null, suche)).status).toBe(401);
			expect((await abfrage(monteurA, suche)).status).toBe(403);
			expect((await abfrage(nutzerVon(chefAId, null, VORLAGEN.chef, true), suche)).status).toBe(403);
		});

		it('Recht je Tabelle: einstellungen sieht alles, sonst das Leserecht der Tabelle', async () => {
			const verwalter = nutzerVon(chefAId, betriebA, ['benutzer.verwalten']);
			const kundenLeser = nutzerVon(chefAId, betriebA, ['kunden.lesen']);
			const id = monteurAId;
			expect((await abfrage(verwalter, { tabelle: 'benutzer', datensatz: id })).status).toBe(200);
			expect((await abfrage(verwalter, { tabelle: 'einladungen', datensatz: id })).status).toBe(200);
			expect((await abfrage(verwalter, { tabelle: 'rollen', datensatz: id })).status).toBe(403);
			expect((await abfrage(verwalter, { tabelle: 'kunden', datensatz: id })).status).toBe(403);
			expect((await abfrage(kundenLeser, { tabelle: 'kunden', datensatz: id })).status).toBe(200);
			expect((await abfrage(kundenLeser, { tabelle: 'objekte', datensatz: id })).status).toBe(200);
			expect((await abfrage(kundenLeser, { tabelle: 'benutzer', datensatz: id })).status).toBe(403);
			expect((await abfrage(chefA, { tabelle: 'benutzer', datensatz: id })).status).toBe(200);
		});

		it('prüft die Parameter: Tabelle nur aus der Positivliste, Datensatz muss eine UUID sein', async () => {
			for (const tabelle of ['', 'sitzungen', 'aenderungen', 'pg_user', 'rollen; drop table app.rollen', 'ROLLEN']) {
				const a = await abfrage(chefA, { tabelle, datensatz: monteurRolleA });
				expect(a.status, tabelle).toBe(400);
				expect(a.koerper.fehler).toBeTypeOf('string');
			}
			expect((await abfrage(chefA, { datensatz: monteurRolleA })).status).toBe(400);
			for (const datensatz of ['', 'abc', '1', `${monteurRolleA}x`, "' or 1=1 --"]) {
				expect((await abfrage(chefA, { tabelle: 'rollen', datensatz })).status, datensatz).toBe(400);
			}
			expect((await abfrage(chefA, { tabelle: 'rollen' })).status).toBe(400);
			for (const vor of ['abc', '-1', '0', '1.5', '99999999999999999999999']) {
				expect((await abfrage(chefA, { tabelle: 'rollen', datensatz: monteurRolleA, vor })).status, vor).toBe(400);
			}
		});

		it('blättert: 50 pro Seite, danach per vor weiter', async () => {
			await rolleAendern(60);
			const s1 = await abfrage(chefA, { tabelle: 'rollen', datensatz: monteurRolleA });
			expect(s1.koerper.eintraege).toHaveLength(50);
			expect(s1.koerper.eintraege[0].nachher.name).toBe('Name 59');
			expect(s1.koerper.naechsteVor).toBeTypeOf('string');
			const s2 = await abfrage(chefA, { tabelle: 'rollen', datensatz: monteurRolleA, vor: s1.koerper.naechsteVor });
			expect(s2.status).toBe(200);
			expect(s2.koerper.eintraege).toHaveLength(10);
			expect(s2.koerper.eintraege[0].nachher.name).toBe('Name 9');
			expect(s2.koerper.eintraege.at(-1).nachher.name).toBe('Name 0');
			expect(s2.koerper.naechsteVor).toBeNull();
			const ids = [...s1.koerper.eintraege, ...s2.koerper.eintraege].map((e: any) => e.id);
			expect(new Set(ids).size).toBe(60);
		});

		it('mandantengetrennt: fremde Datensätze liefern eine leere Liste, auch mit Recht', async () => {
			await alsApp(betriebB, chefBId, (tx) => tx`update app.rollen set name = 'Nur B' where id = ${chefRolleB}`);
			const a = await abfrage(chefA, { tabelle: 'rollen', datensatz: chefRolleB });
			expect(a.status).toBe(200);
			expect(a.koerper.eintraege).toEqual([]);
			const b = await abfrage(chefB, { tabelle: 'rollen', datensatz: chefRolleB });
			expect(b.koerper.eintraege).toHaveLength(1);
		});

		it('die Antwort enthält keine Geheimnisse', async () => {
			await alsApp(betriebA, chefAId, (tx) => tx`update app.benutzer set aktiv = false where id = ${monteurAId}`);
			const a = await abfrage(chefA, { tabelle: 'benutzer', datensatz: monteurAId });
			const text = JSON.stringify(a.koerper);
			expect(text).not.toContain('NIEMALS-IM-PROTOKOLL');
			expect(text).not.toContain('passwort');
			expect(text).not.toContain('totp');
		});
	});
});
