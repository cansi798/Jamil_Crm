import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitAdmin, schliesseDb } from '../../src/lib/server/db';
import { VORLAGEN, VORLAGEN_NAMEN } from '../../src/lib/server/rechte';
import { pruefeModul } from '../../src/lib/server/tarif';
import {
	adminProtokoll,
	aendereBetrieb,
	holeBetrieb,
	legeBetriebAn,
	listeBetriebe,
	tarifeFuerAdmin
} from '../../src/lib/server/admin';
import { COOKIE_NAME, neueSitzung, pruefeSitzung } from '../../src/lib/server/auth/sitzung';
import { einladungsDaten, nimmEinladungAn } from '../../src/lib/server/auth/einladung';
import { handle } from '../../src/hooks.server';
import { load as layoutLoad } from '../../src/routes/admin/+layout.server';
import { actions as uebersichtAktionen, load as uebersichtLoad } from '../../src/routes/admin/+page.server';
import { actions as detailAktionen, load as detailLoad } from '../../src/routes/admin/betriebe/[id]/+page.server';
import { GET as betriebeGet, POST as betriebePost } from '../../src/routes/api/admin/betriebe/+server';
import { GET as betriebGet, PATCH as betriebPatch } from '../../src/routes/api/admin/betriebe/[id]/+server';

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const UNBEKANNT = '11111111-1111-4111-8111-111111111111';

type Ant = { status: number; koerper: any };

async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	return { status: r.status, koerper: text ? JSON.parse(text) : null };
}

const jsonAnfrage = (methode: string, pfad: string, koerper?: unknown) =>
	new Request(`http://localhost${pfad}`, {
		method: methode,
		headers: { 'content-type': 'application/json' },
		body: koerper === undefined ? undefined : JSON.stringify(koerper)
	});

const formAnfrage = (pfad: string, felder: Record<string, string>) => {
	const body = new URLSearchParams(felder);
	return new Request(`http://localhost${pfad}`, { method: 'POST', body });
};

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: betriebId ? 'aktiv' : null };
}

describe('Plattform-Admin (Basis)', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string;
	let chefAId: string, monteurAId: string, chefBId: string;
	let adminId: string, admin2Id: string;
	let admin: Nutzer, chefA: Nutzer;
	let adminToken: string;

	/** Volle Sitzung direkt in der Datenbank (mit/ohne zweiten Faktor), liefert das Token. */
	const sitzung = async (benutzer: string, mitFaktor: boolean) => {
		const token = randomBytes(32).toString('base64url');
		await root`
			insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
			values (${sha256(token)}, ${benutzer}, now() + interval '1 day', ${mitFaktor})`;
		return token;
	};
	const protokollZeilen = () => root`select * from app.admin_protokoll order by id`;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		const [basis] = await root`select id from app.tarife where schluessel = 'basis'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Alpha GmbH', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status, abo_ende)
			values ('Beta KG', ${basis.id}, 'test', '2026-12-31') returning id`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]})
				returning id`)[0].id as string;
		const benutzer = async (betrieb: string | null, rolleId: string | null, email: string) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betrieb}, ${email}, ${email}, 'x', ${rolleId}) returning id`)[0].id as string;
		chefAId = await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test');
		monteurAId = await benutzer(betriebA, await rolle(betriebA, 'Monteur', VORLAGEN.monteur), 'monteur-a@beispiel.test');
		chefBId = await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test');
		await root`update app.benutzer set letzte_aktivitaet = '2026-10-01T10:00:00Z' where id = ${monteurAId}`;
		adminId = await benutzer(null, null, 'admin@beispiel.test');
		admin2Id = await benutzer(null, null, 'admin2@beispiel.test');
		await root`insert into app.plattform_admins (benutzer_id) values (${adminId}), (${admin2Id})`;
		adminToken = await sitzung(adminId, true);
		admin = nutzerVon(adminId, null, [], true);
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		// Kundendaten, die der Admin nie sehen darf
		await root`insert into app.kunden (betrieb_id, art, nachname) values (${betriebA}, 'privat', 'Geheim')`;
	});

	afterAll(async () => {
		await root?.end();
		await schliesseDb();
	});

	describe('Brief: Kernfälle', () => {
		it('Übersicht listet beide Betriebe mit Benutzeranzahl', async () => {
			const liste = await listeBetriebe(adminId);
			const a = liste.find((b) => b.id === betriebA);
			const b = liste.find((b) => b.id === betriebB);
			expect(a).toMatchObject({ name: 'Alpha GmbH', tarif: 'premium', aboStatus: 'aktiv', aboEnde: null, benutzerAnzahl: 2 });
			expect(a?.letzteAktivitaet).toBe('2026-10-01T10:00:00.000Z');
			expect(b).toMatchObject({ name: 'Beta KG', tarif: 'basis', aboStatus: 'test', aboEnde: '2026-12-31', benutzerAnzahl: 1 });
			expect(b?.letzteAktivitaet).toBeNull();
			// nur Verwaltungsdaten, keine Kunden- oder Benutzerdaten
			expect(Object.keys(a!).sort()).toEqual(
				['aboEnde', 'aboStatus', 'benutzerAnzahl', 'id', 'letzteAktivitaet', 'name', 'tarif'].sort()
			);
		});

		it('crm_admin SELECT auf kunden → permission denied', async () => {
			for (const sql of [
				'select * from app.kunden',
				'select * from app.objekte',
				'select * from app.aenderungen',
				'select passwort_hash from app.benutzer',
				'select totp_geheim from app.benutzer',
				'select * from app.einladungen',
				'select * from app.admin_protokoll'
			]) {
				await expect(mitAdmin(adminId, (tx) => tx.unsafe(sql)), sql).rejects.toThrow(/permission denied/);
			}
		});

		it('Betrieb sperren → laufende Sitzung eines Benutzers dort ungültig', async () => {
			const tokenA = await neueSitzung(monteurAId);
			const tokenB = await sitzung(chefBId, true);
			expect((await pruefeSitzung(tokenA))?.id).toBe(monteurAId);
			await aendereBetrieb(adminId, betriebA, { aboStatus: 'gesperrt' });
			expect(await pruefeSitzung(tokenA)).toBeNull();
			// Sitzungen des gesperrten Betriebs sind zusätzlich gelöscht, fremde Betriebe unberührt
			const [z] = await root`
				select count(*)::int as n from app.sitzungen s join app.benutzer b on b.id = s.benutzer_id
				where b.betrieb_id = ${betriebA}`;
			expect(z.n).toBe(0);
			expect((await pruefeSitzung(tokenB))?.id).toBe(chefBId);
			await aendereBetrieb(adminId, betriebA, { aboStatus: 'aktiv' });
		});

		it('Nicht-Admin GET /admin → 404', async () => {
			for (const nutzer of [null, chefA, nutzerVon(chefAId, betriebA, VORLAGEN.chef, false)]) {
				await expect(layoutLoad({ locals: { nutzer } } as never)).rejects.toMatchObject({ status: 404 });
			}
			await expect(layoutLoad({ locals: { nutzer: admin } } as never)).resolves.toBeDefined();
		});

		it('Tarifwechsel erzeugt admin_protokoll-Eintrag', async () => {
			const vorher = (await protokollZeilen()).length;
			await aendereBetrieb(adminId, betriebB, { tarif: 'profi' });
			const zeilen = await protokollZeilen();
			expect(zeilen).toHaveLength(vorher + 1);
			const e = zeilen[zeilen.length - 1];
			expect(e.admin_id).toBe(adminId);
			expect(e.aktion).toBe('betrieb_geaendert');
			expect(e.details).toMatchObject({ betrieb_id: betriebB, vorher: { tarif: 'basis' }, nachher: { tarif: 'profi' } });
			expect(Math.abs(new Date(e.zeit).getTime() - Date.now())).toBeLessThan(60_000);
			const [b] = await root`select t.schluessel from app.betriebe b join app.tarife t on t.id = b.tarif_id where b.id = ${betriebB}`;
			expect(b.schluessel).toBe('profi');
			await aendereBetrieb(adminId, betriebB, { tarif: 'basis' });
		});
	});

	describe('Datenbank: Rechte und Admin-Identität', () => {
		it('alle Admin-Funktionen: SECURITY DEFINER, Eigentümer crm, fester search_path, EXECUTE nur crm_admin', async () => {
			const f = await root`
				select p.oid::regprocedure::text as sig, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig,
					has_function_privilege('crm_admin', p.oid, 'execute') as admin,
					has_function_privilege('crm_app', p.oid, 'execute') as app,
					has_function_privilege('crm_auth', p.oid, 'execute') as auth,
					exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
						where a.grantee = 0 and a.privilege_type = 'EXECUTE') as oeffentlich
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'app' and p.proname like 'admin\\_%'`;
			expect(f.map((x) => x.sig).sort()).toEqual(
				[
					'app.admin_betrieb(uuid)',
					'app.admin_betrieb_aendern(uuid,text,text,date,boolean)',
					'app.admin_betrieb_anlegen(text,text,citext,text,jsonb)',
					'app.admin_betriebe()',
					'app.admin_protokoll_lesen(uuid)',
					'app.admin_pruefen()',
					'app.admin_tarife()'
				].sort()
			);
			for (const x of f) {
				expect(x.prosecdef, x.sig).toBe(true);
				expect(x.owner, x.sig).toBe('crm');
				expect(x.proconfig, x.sig).toContain('search_path=app, pg_temp');
				expect(x.app, x.sig).toBe(false);
				expect(x.auth, x.sig).toBe(false);
				expect(x.oeffentlich, x.sig).toBe(false);
				// admin_pruefen ist intern (nur für die anderen Funktionen desselben Eigentümers)
				expect(x.admin, x.sig).toBe(x.sig !== 'app.admin_pruefen()');
			}
		});

		it('crm_admin hat keine Tabellenrechte auf kunden, objekte, aenderungen, admin_protokoll und keine Geheimspalten', async () => {
			const [z] = await root`
				select
					bool_or(has_table_privilege('crm_admin', t, p)) as irgendwas
				from unnest(array['app.kunden', 'app.objekte', 'app.aenderungen', 'app.admin_protokoll', 'app.einladungen',
					'app.benutzer', 'app.sitzungen', 'app.plattform_admins', 'app.betriebe', 'app.tarife', 'app.rollen']) t,
					unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p`;
			expect(z.irgendwas).toBe(false);
			for (const spalte of ['passwort_hash', 'totp_geheim', 'totp_aktiv', 'email', 'name']) {
				const [s] = await root`
					select has_column_privilege('crm_admin', 'app.benutzer', ${spalte}, 'SELECT') as lesen,
						has_column_privilege('crm_admin', 'app.benutzer', ${spalte}, 'UPDATE') as schreiben`;
				expect(s, spalte).toEqual({ lesen: false, schreiben: false });
			}
			await expect(
				mitAdmin(adminId, (tx) => tx`select * from app.sitzung_pruefen(${sha256('x')}::bytea)`)
			).rejects.toThrow(/permission denied/);
		});

		it('crm_app und crm_auth dürfen die Admin-Funktionen nicht aufrufen', async () => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			const auth = postgres(db.urlAuth, { max: 1, onnotice: () => {} });
			try {
				for (const s of [app, auth]) {
					await expect(s`select * from app.admin_betriebe()`).rejects.toThrow(/permission denied/);
					await expect(s`select app.admin_betrieb_aendern(${betriebA}, 'basis', null, null, false)`).rejects.toThrow(
						/permission denied/
					);
				}
			} finally {
				await app.end();
				await auth.end();
			}
		});

		it('Admin-Funktionen prüfen app.admin_id in SQL: kein Admin, unbekannt, keine UUID, leer → Fehler', async () => {
			for (const id of [chefAId, UNBEKANNT, 'keine-uuid']) {
				await expect(mitAdmin(id, (tx) => tx`select * from app.admin_betriebe()`), id).rejects.toThrow(
					/kein_plattform_admin/
				);
			}
			const admin = postgres(db.urlAdmin, { max: 1, onnotice: () => {} });
			try {
				await expect(admin`select * from app.admin_betriebe()`).rejects.toThrow(/kein_plattform_admin/);
			} finally {
				await admin.end();
			}
		});

		it('Admin ohne laufende Sitzung mit zweitem Faktor oder deaktiviert → Fehler', async () => {
			// admin2 hat noch keine Sitzung
			await expect(listeBetriebe(admin2Id)).rejects.toMatchObject({ status: 404 });
			const ohne = await sitzung(admin2Id, false);
			await expect(listeBetriebe(admin2Id)).rejects.toMatchObject({ status: 404 });
			await root`delete from app.sitzungen where token_hash = ${sha256(ohne)}`;
			await sitzung(admin2Id, true);
			await expect(listeBetriebe(admin2Id)).resolves.toBeInstanceOf(Array);
			await root`update app.benutzer set aktiv = false where id = ${admin2Id}`;
			await expect(listeBetriebe(admin2Id)).rejects.toMatchObject({ status: 404 });
			await root`update app.benutzer set aktiv = true where id = ${admin2Id}`;
		});

		it('admin_protokoll: kein Zugriff für crm_app; Einträge mit admin_id, aktion, details, zeit', async () => {
			const [z] = await root`
				select has_table_privilege('crm_app', 'app.admin_protokoll', 'SELECT') as app,
					has_table_privilege('crm_auth', 'app.admin_protokoll', 'SELECT') as auth`;
			expect(z).toEqual({ app: false, auth: false });
			const spalten = await root`
				select column_name from information_schema.columns
				where table_schema = 'app' and table_name = 'admin_protokoll' order by ordinal_position`;
			expect(spalten.map((s) => s.column_name)).toEqual(['id', 'admin_id', 'aktion', 'details', 'zeit']);
		});
	});

	describe('Plattform-Admins nur ohne Betrieb (Carry T3)', () => {
		it('Benutzer eines Betriebs kann nicht Plattform-Admin werden', async () => {
			await expect(root`insert into app.plattform_admins (benutzer_id) values (${chefAId})`).rejects.toThrow(
				/Plattform-Admin/
			);
		});

		it('Plattform-Admin bekommt nachträglich keinen Betrieb (betrieb_id ist unveränderlich)', async () => {
			await expect(root`update app.benutzer set betrieb_id = ${betriebA} where id = ${adminId}`).rejects.toThrow(
				/betrieb_id/
			);
		});
	});

	describe('Betriebszugehörigkeit ist unveränderlich (Carry T10)', () => {
		it('auch der Eigentümer kann Zeilen nicht in einen anderen Betrieb verschieben', async () => {
			const [k] = await root`select id from app.kunden where betrieb_id = ${betriebA} limit 1`;
			const [r] = await root`select id from app.rollen where betrieb_id = ${betriebA} limit 1`;
			for (const versuch of [
				root`update app.kunden set betrieb_id = ${betriebB} where id = ${k.id}`,
				root`update app.rollen set betrieb_id = ${betriebB} where id = ${r.id}`,
				root`update app.benutzer set betrieb_id = ${betriebB} where id = ${chefAId}`
			]) {
				await expect(versuch).rejects.toThrow(/betrieb_id/);
			}
		});

		it('Admin-Funktionen ändern keine betrieb_id fachlicher Zeilen', async () => {
			const stand = () => root`
				select 'rollen' as t, id, betrieb_id from app.rollen
				union all select 'benutzer', id, betrieb_id from app.benutzer
				union all select 'kunden', id, betrieb_id from app.kunden
				order by 1, 2`;
			const vorher = await stand();
			await aendereBetrieb(adminId, betriebB, { tarif: 'premium', aboStatus: 'aktiv', aboEnde: '2027-01-31' });
			await aendereBetrieb(adminId, betriebB, { tarif: 'basis', aboStatus: 'test', aboEnde: '2026-12-31' });
			expect(await stand()).toEqual(vorher);
		});
	});

	describe('Betrieb anlegen', () => {
		it('legt Betrieb, die drei Vorlagen-Rollen und eine Chef-Einladung an; liefert nur das Token', async () => {
			const token = await legeBetriebAn(adminId, {
				name: '  Gamma Bau  ',
				tarif: 'profi',
				chefEmail: 'Chef@Gamma.test',
				chefName: 'Gisela Gamma'
			});
			expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			const [b] = await root`
				select b.id, b.name, b.abo_status, t.schluessel from app.betriebe b join app.tarife t on t.id = b.tarif_id
				where b.name = 'Gamma Bau'`;
			expect(b).toMatchObject({ abo_status: 'test', schluessel: 'profi' });
			const rollen = await root`select name, rechte, vorlage from app.rollen where betrieb_id = ${b.id} order by vorlage`;
			expect(rollen.map((r) => r.vorlage).sort()).toEqual(['buero', 'chef', 'monteur']);
			for (const r of rollen) {
				const v = r.vorlage as keyof typeof VORLAGEN;
				expect(r.rechte, v).toEqual([...VORLAGEN[v]]);
				expect(r.name).toBe(VORLAGEN_NAMEN[v]);
			}
			const einladungen = await root`
				select e.email::text as email, e.token_hash, r.vorlage
				from app.einladungen e join app.rollen r on r.id = e.rolle_id where e.betrieb_id = ${b.id}`;
			expect(einladungen).toHaveLength(1);
			expect(einladungen[0]).toMatchObject({ email: 'chef@gamma.test', vorlage: 'chef' });
			expect(Buffer.compare(einladungen[0].token_hash, sha256(token))).toBe(0);
			// Das Token steht nirgends im Klartext (Protokolle)
			const [p] = await root`
				select (select count(*)::int from app.admin_protokoll where details::text like ${'%' + token + '%'}) as admin,
					(select count(*)::int from app.aenderungen where coalesce(vorher, nachher)::text like ${'%' + token + '%'}) as aend`;
			expect(p).toEqual({ admin: 0, aend: 0 });
			const [e] = await root`select * from app.admin_protokoll where aktion = 'betrieb_angelegt' order by id desc limit 1`;
			expect(e.admin_id).toBe(adminId);
			expect(e.details).toMatchObject({ betrieb_id: b.id, name: 'Gamma Bau', tarif: 'profi', chef_email: 'chef@gamma.test' });
			// Der Link funktioniert: Chef nimmt an und hat die Chef-Rolle
			expect(await einladungsDaten(token)).toEqual({ email: 'chef@gamma.test', betrieb: 'Gamma Bau' });
			const annahme = await nimmEinladungAn(token, 'Gisela Gamma', 'ein-gutes-Passwort');
			expect(annahme.art).toBe('ok');
			const [chef] = await root`
				select b.betrieb_id, r.vorlage from app.benutzer b join app.rollen r on r.id = b.rolle_id
				where b.email = 'chef@gamma.test'`;
			expect(chef).toEqual({ betrieb_id: b.id, vorlage: 'chef' });
		});

		it('unbekannter Tarif, leerer Name, ungültige oder vergebene E-Mail → Fehler, nichts angelegt', async () => {
			const anzahl = async () => (await root`select count(*)::int as n from app.betriebe`)[0].n;
			const vorher = await anzahl();
			const gut = { name: 'Delta', tarif: 'basis', chefEmail: 'chef@delta.test', chefName: 'Dora' };
			await expect(legeBetriebAn(adminId, { ...gut, tarif: 'gold' })).rejects.toMatchObject({ status: 400 });
			await expect(legeBetriebAn(adminId, { ...gut, name: '   ' })).rejects.toMatchObject({ status: 400 });
			await expect(legeBetriebAn(adminId, { ...gut, chefName: '' })).rejects.toMatchObject({ status: 400 });
			await expect(legeBetriebAn(adminId, { ...gut, chefEmail: 'kein-at' })).rejects.toMatchObject({ status: 400 });
			await expect(legeBetriebAn(adminId, { ...gut, chefEmail: 'chef-a@beispiel.test' })).rejects.toMatchObject({
				status: 409
			});
			expect(await anzahl()).toBe(vorher);
		});

		it('SQL verlangt vollständige Vorlagen (chef mit einstellungen) – direkter Aufruf mit kaputten Vorlagen scheitert', async () => {
			const kaputt = [
				[],
				[{ vorlage: 'chef', name: 'Chef', rechte: ['kunden.lesen'] }],
				[
					{ vorlage: 'chef', name: 'Chef', rechte: ['kunden.lesen'] },
					{ vorlage: 'buero', name: 'Büro', rechte: [] },
					{ vorlage: 'monteur', name: 'Monteur', rechte: [] }
				]
			];
			for (const v of kaputt) {
				await expect(
					mitAdmin(adminId, (tx) =>
						tx`select app.admin_betrieb_anlegen('Epsilon', 'basis', 'chef@epsilon.test', 'Eva', ${tx.json(v)})`
					)
				).rejects.toThrow(/vorlagen/);
			}
		});
	});

	describe('Betrieb ändern', () => {
		it('Status nur aus der erlaubten Menge, Abo-Ende setzen und leeren, unbekannter Betrieb → 404', async () => {
			await expect(aendereBetrieb(adminId, betriebB, { aboStatus: 'pleite' })).rejects.toMatchObject({ status: 400 });
			await expect(aendereBetrieb(adminId, betriebB, { tarif: 'gold' })).rejects.toMatchObject({ status: 400 });
			await expect(aendereBetrieb(adminId, betriebB, { aboEnde: '31.12.2026' })).rejects.toMatchObject({ status: 400 });
			await expect(aendereBetrieb(adminId, UNBEKANNT, { aboStatus: 'aktiv' })).rejects.toMatchObject({ status: 404 });
			await expect(aendereBetrieb(adminId, 'keine-uuid', { aboStatus: 'aktiv' })).rejects.toMatchObject({ status: 404 });
			await aendereBetrieb(adminId, betriebB, { aboStatus: 'ueberfaellig', aboEnde: '2026-11-30' });
			expect(await holeBetrieb(adminId, betriebB)).toMatchObject({ aboStatus: 'ueberfaellig', aboEnde: '2026-11-30' });
			await aendereBetrieb(adminId, betriebB, { aboEnde: null });
			expect((await holeBetrieb(adminId, betriebB)).aboEnde).toBeNull();
			await aendereBetrieb(adminId, betriebB, { aboStatus: 'test', aboEnde: '2026-12-31' });
		});

		it('ohne Änderung kein Protokolleintrag; Protokoll des Betriebs lesbar', async () => {
			const vorher = (await protokollZeilen()).length;
			await aendereBetrieb(adminId, betriebB, { tarif: 'basis' });
			expect((await protokollZeilen()).length).toBe(vorher);
			const eintraege = await adminProtokoll(adminId, betriebB);
			expect(eintraege.length).toBeGreaterThan(0);
			expect(eintraege[0]).toMatchObject({ adminName: 'admin@beispiel.test' });
			expect(eintraege.every((e) => e.details.betrieb_id === betriebB)).toBe(true);
		});

		it('Tarife für die Auswahl', async () => {
			const t = await tarifeFuerAdmin(adminId);
			expect(t.map((x) => x.schluessel)).toEqual(['basis', 'profi', 'premium', 'test']);
		});
	});

	describe('Seiten und API: nur für Plattform-Admins (sonst 404)', () => {
		const fremde = () => [null, chefA];

		it('Seiten-load und Aktionen: Gast und Betriebsnutzer → 404', async () => {
			for (const nutzer of fremde()) {
				await expect(uebersichtLoad({ locals: { nutzer } } as never)).rejects.toMatchObject({ status: 404 });
				await expect(
					detailLoad({ locals: { nutzer }, params: { id: betriebA } } as never)
				).rejects.toMatchObject({ status: 404 });
				// Carry T12: Aktionen prüfen den Admin, bevor sie den Körper lesen → 404-Fehlerseite, Formular ungelesen
				const anfrageU = formAnfrage('/admin', { name: 'X', tarif: 'basis', chefEmail: 'x@x.test', chefName: 'X' });
				await expect(
					uebersichtAktionen.anlegen({
						locals: { nutzer },
						request: anfrageU,
						url: new URL('http://localhost/admin')
					} as never)
				).rejects.toMatchObject({ status: 404 });
				expect(anfrageU.bodyUsed).toBe(false);
				const anfrageD = formAnfrage(`/admin/betriebe/${betriebA}`, { tarif: 'basis', aboStatus: 'gesperrt', aboEnde: '' });
				await expect(
					detailAktionen.aendern({ locals: { nutzer }, params: { id: betriebA }, request: anfrageD } as never)
				).rejects.toMatchObject({ status: 404 });
				expect(anfrageD.bodyUsed).toBe(false);
			}
			const [b] = await root`select abo_status from app.betriebe where id = ${betriebA}`;
			expect(b.abo_status).toBe('aktiv');
		});

		it('API: Gast und Betriebsnutzer → 404', async () => {
			for (const nutzer of fremde()) {
				expect((await antwort(await betriebeGet({ locals: { nutzer } } as never))).status).toBe(404);
				expect(
					(
						await antwort(
							await betriebePost({
								locals: { nutzer },
								request: jsonAnfrage('POST', '/api/admin/betriebe', { name: 'X' }),
								url: new URL('http://localhost/api/admin/betriebe')
							} as never)
						)
					).status
				).toBe(404);
				expect((await antwort(await betriebGet({ locals: { nutzer }, params: { id: betriebA } } as never))).status).toBe(404);
				expect(
					(
						await antwort(
							await betriebPatch({
								locals: { nutzer },
								params: { id: betriebA },
								request: jsonAnfrage('PATCH', `/api/admin/betriebe/${betriebA}`, { aboStatus: 'gesperrt' })
							} as never)
						)
					).status
				).toBe(404);
			}
		});

		it('Admin: Übersicht-Seite, Anlegen-Aktion zeigt den Link einmal, Detailseite ändert', async () => {
			const u = (await uebersichtLoad({ locals: { nutzer: admin } } as never)) as any;
			expect(u.betriebe.map((b: any) => b.name)).toEqual(expect.arrayContaining(['Alpha GmbH', 'Beta KG']));
			expect(u.tarife.map((t: any) => t.schluessel)).toContain('basis');
			const r = (await uebersichtAktionen.anlegen({
				locals: { nutzer: admin },
				request: formAnfrage('/admin', { name: 'Zeta', tarif: 'basis', chefEmail: 'chef@zeta.test', chefName: 'Zora' }),
				url: new URL('https://crm.beispiel.test/admin')
			} as never)) as any;
			expect(r.link).toMatch(/^https:\/\/crm\.beispiel\.test\/einladung\/[A-Za-z0-9_-]{43}$/);
			const fehler = (await uebersichtAktionen.anlegen({
				locals: { nutzer: admin },
				request: formAnfrage('/admin', { name: 'Zeta 2', tarif: 'gold', chefEmail: 'chef@zeta2.test', chefName: 'Z' }),
				url: new URL('https://crm.beispiel.test/admin')
			} as never)) as any;
			expect(fehler.status).toBe(400);
			expect(fehler.data.fehler).toBe('Unbekannter Tarif.');
			expect(fehler.data.link).toBeUndefined();

			const d = (await detailLoad({ locals: { nutzer: admin }, params: { id: betriebB } } as never)) as any;
			expect(d.betrieb.name).toBe('Beta KG');
			await expect(
				detailLoad({ locals: { nutzer: admin }, params: { id: UNBEKANNT } } as never)
			).rejects.toMatchObject({ status: 404 });
			const a = (await detailAktionen.aendern({
				locals: { nutzer: admin },
				params: { id: betriebB },
				request: formAnfrage(`/admin/betriebe/${betriebB}`, { tarif: 'profi', aboStatus: 'aktiv', aboEnde: '' })
			} as never)) as any;
			expect(a).toMatchObject({ gespeichert: true });
			expect(await holeBetrieb(adminId, betriebB)).toMatchObject({ tarif: 'profi', aboStatus: 'aktiv', aboEnde: null });
			await aendereBetrieb(adminId, betriebB, { tarif: 'basis', aboStatus: 'test', aboEnde: '2026-12-31' });
		});

		it('Admin: API liefert, legt an (201, Link) und ändert', async () => {
			const g = await antwort(await betriebeGet({ locals: { nutzer: admin } } as never));
			expect(g.status).toBe(200);
			expect(g.koerper.betriebe.length).toBeGreaterThanOrEqual(2);
			const p = await antwort(
				await betriebePost({
					locals: { nutzer: admin },
					request: jsonAnfrage('POST', '/api/admin/betriebe', {
						name: 'Eta',
						tarif: 'basis',
						chefEmail: 'chef@eta.test',
						chefName: 'Ella'
					}),
					url: new URL('http://localhost/api/admin/betriebe')
				} as never)
			);
			expect(p.status).toBe(201);
			expect(p.koerper.link).toMatch(/^http:\/\/localhost\/einladung\/[A-Za-z0-9_-]{43}$/);
			const e = await antwort(await betriebGet({ locals: { nutzer: admin }, params: { id: betriebA } } as never));
			expect(e.koerper).toMatchObject({ id: betriebA, name: 'Alpha GmbH' });
			const x = await antwort(
				await betriebPatch({
					locals: { nutzer: admin },
					params: { id: betriebB },
					request: jsonAnfrage('PATCH', `/api/admin/betriebe/${betriebB}`, { aboEnde: '2027-03-31' })
				} as never)
			);
			expect(x.status).toBe(200);
			expect(x.koerper).toMatchObject({ id: betriebB, aboEnde: '2027-03-31' });
			const falsch = await antwort(
				await betriebPatch({
					locals: { nutzer: admin },
					params: { id: betriebB },
					request: jsonAnfrage('PATCH', `/api/admin/betriebe/${betriebB}`, { aboStatus: 'pleite' })
				} as never)
			);
			expect(falsch.status).toBe(400);
		});
	});

	describe('Plattform-Admins ohne Betrieb: Hooks und Mandantenlogik stürzen nicht ab', () => {
		function fakeCookies(start: Record<string, string>) {
			const speicher = new Map(Object.entries(start));
			return {
				get: (n: string) => speicher.get(n),
				set: (n: string, w: string) => void speicher.set(n, w),
				delete: (n: string) => void speicher.delete(n)
			};
		}
		async function durchHook(methode: string, pfad: string, token: string, route?: (e: any) => unknown, koerper?: unknown) {
			const request = new Request(`http://localhost${pfad}`, {
				method: methode,
				headers: koerper === undefined ? {} : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			const event = {
				request,
				url: new URL(request.url),
				cookies: fakeCookies({ [COOKIE_NAME]: token }),
				locals: {} as { nutzer?: Nutzer | null },
				params: {}
			};
			const resolve = vi.fn(async (e: typeof event) => {
				const r = await route?.(e);
				return r instanceof Response ? r : new Response('ok');
			});
			const r = await handle({ event: event as never, resolve: resolve as never });
			return { status: r.status, nutzer: event.locals.nutzer, aufgerufen: resolve.mock.calls.length > 0, r };
		}

		it('Admin-Sitzung mit zweitem Faktor: GET und POST laufen durch (kein Nur-Lese-Absturz)', async () => {
			const g = await durchHook('GET', '/admin', adminToken);
			expect(g.nutzer).toMatchObject({ id: adminId, betriebId: null, istAdmin: true, betriebStatus: null });
			expect(g.aufgerufen).toBe(true);
			const p = await durchHook(
				'POST',
				'/api/admin/betriebe',
				adminToken,
				(e) => betriebePost(e as never),
				{ name: 'Theta', tarif: 'basis', chefEmail: 'chef@theta.test', chefName: 'Theo' }
			);
			expect(p.status).toBe(201);
		});

		it('Admin-Sitzung ohne zweiten Faktor ist keine Sitzung → /admin 404', async () => {
			const ohne = await sitzung(adminId, false);
			const g = await durchHook('GET', '/admin', ohne);
			expect(g.nutzer).toBeNull();
			await expect(layoutLoad({ locals: { nutzer: g.nutzer } } as never)).rejects.toMatchObject({ status: 404 });
		});

		it('Mandanten-Prüfungen weisen den Admin sauber ab (403), statt abzustürzen', async () => {
			await expect(pruefeModul({ nutzer: admin }, 'kunden')).rejects.toMatchObject({ status: 403 });
		});
	});
});
