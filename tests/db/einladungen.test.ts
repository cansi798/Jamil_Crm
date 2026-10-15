import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, schliesseDb, systemAbfrage } from '../../src/lib/server/db';
import { VORLAGEN } from '../../src/lib/server/rechte';
import { loescheRolle } from '../../src/lib/server/rollen';
import { pruefePasswort } from '../../src/lib/server/auth/passwort';
import { neueSitzung, pruefeSitzung } from '../../src/lib/server/auth/sitzung';
import { GET as einladungenGet, POST as einladungenPost } from '../../src/routes/api/einladungen/+server';
import { DELETE as einladungDelete } from '../../src/routes/api/einladungen/[id]/+server';
import { GET as benutzerGet } from '../../src/routes/api/benutzer/+server';
import { PATCH as benutzerPatch } from '../../src/routes/api/benutzer/[id]/+server';
import { GET as rollenGet } from '../../src/routes/api/rollen/+server';
import { actions as annahmeAktion, load as annahmeLoad } from '../../src/routes/einladung/[token]/+page.server';
import {
	actions as verwaltungAktionen,
	load as verwaltungLoad
} from '../../src/routes/(app)/einstellungen/benutzer/+page.server';

const UNGUELTIG = 'Diese Einladung ist nicht mehr gültig.';
const REGISTRIERT = 'Diese E-Mail ist bereits registriert.';
const SCHUTZ = 'Mindestens ein Benutzer muss die Einstellungen verwalten können.';
const PASSWORT = 'ein-gutes-Passwort';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

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

function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

type Ausgang = { ergebnis: any; umleitung: null | { status: number; location: string } };

/** Führt einen Seiten-Handler aus; redirect() wirft, fail() wird zurückgegeben. */
async function ausfuehren(fn: () => unknown): Promise<Ausgang> {
	try {
		return { ergebnis: await fn(), umleitung: null };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.status === 'number' && typeof r.location === 'string') {
			return { ergebnis: null, umleitung: { status: r.status, location: r.location } };
		}
		throw e;
	}
}

const tokenAus = (link: string) => link.slice(link.lastIndexOf('/') + 1);

describe('Benutzer & Einladungen', () => {
	let db: TestDb;
	let root: postgres.Sql;
	let betriebA: string, betriebB: string, betriebGesperrt: string;
	let chefRolleA: string, monteurRolleA: string, bueroRolleA: string, chefRolleB: string, chefRolleG: string;
	let chefAId: string, monteurAId: string, bueroAId: string, chefBId: string;
	let chefA: Nutzer, monteurA: Nutzer, bueroA: Nutzer, chefB: Nutzer;

	/** Büro mit Benutzerverwaltung, aber ohne 'einstellungen'. */
	const BUERO_VERWALTER = [...VORLAGEN.buero, 'benutzer.verwalten'];

	const einladen = async (nutzer: Nutzer | null, koerper: unknown) =>
		antwort(
			await einladungenPost({
				locals: { nutzer },
				request: jsonAnfrage('POST', '/api/einladungen', koerper),
				url: new URL('http://localhost/api/einladungen')
			} as never)
		);
	const patch = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(
			await benutzerPatch({
				locals: { nutzer },
				params: { id },
				request: jsonAnfrage('PATCH', `/api/benutzer/${id}`, koerper)
			} as never)
		);

	const annahmeEvent = (token: string, felder: Record<string, string>) => {
		const form = new FormData();
		for (const [k, v] of Object.entries(felder)) form.set(k, v);
		const url = new URL(`http://localhost/einladung/${token}`);
		return {
			request: new Request(url, { method: 'POST', body: form }),
			params: { token },
			locals: { nutzer: null },
			url
		} as never;
	};
	const annehmen = (token: string, felder: Partial<Record<'name' | 'passwort' | 'passwort2', string>> = {}) =>
		ausfuehren(() =>
			annahmeAktion.default(
				annahmeEvent(token, { name: 'Neue Person', passwort: PASSWORT, passwort2: PASSWORT, ...felder })
			)
		);
	let kopfzeilen: Record<string, string> = {};
	const ladeAnnahme = async (token: string) => {
		kopfzeilen = {};
		return (await annahmeLoad({
			params: { token },
			locals: { nutzer: null },
			url: new URL('http://localhost/'),
			setHeaders: (h: Record<string, string>) => Object.assign(kopfzeilen, h)
		} as never)) as any;
	};

	const konten = async (email: string) =>
		root`select id, betrieb_id, rolle_id, name, passwort_hash, aktiv from app.benutzer where email = ${email}`;
	const rolleVon = async (id: string) =>
		(await root`select rolle_id from app.benutzer where id = ${id}`)[0].rolle_id as string;
	const aktivVon = async (id: string) => (await root`select aktiv from app.benutzer where id = ${id}`)[0].aktiv as boolean;

	beforeAll(async () => {
		db = await frischeTestDb();
		initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
		root = postgres(db.urlSuper, { max: 4, onnotice: () => {} });
		// Tarif „premium“ (30 Benutzer): Die Grenzen werden je Test über den Tarif des Betriebs gesteuert.
		const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
		[{ id: betriebA }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb A', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebB }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Betrieb B', ${premium.id}, 'aktiv') returning id`;
		[{ id: betriebGesperrt }] = await root`
			insert into app.betriebe (name, tarif_id, abo_status) values ('Gesperrt GmbH', ${premium.id}, 'aktiv') returning id`;
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
		await root`update app.betriebe set abo_status = 'aktiv', abo_ende = null`;
		await root`update app.betriebe set tarif_id = (select id from app.tarife where schluessel = 'premium')`;
		const rolle = async (betrieb: string, name: string, rechte: readonly string[]) =>
			(await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betrieb}, ${name}, ${rechte as string[]})
				returning id`)[0].id as string;
		chefRolleA = await rolle(betriebA, 'Chef', VORLAGEN.chef);
		monteurRolleA = await rolle(betriebA, 'Monteur', VORLAGEN.monteur);
		bueroRolleA = await rolle(betriebA, 'Büro-Verwaltung', BUERO_VERWALTER);
		chefRolleB = await rolle(betriebB, 'Chef', VORLAGEN.chef);
		chefRolleG = await rolle(betriebGesperrt, 'Chef', VORLAGEN.chef);
		const benutzer = async (betrieb: string, rolle: string, email: string) =>
			(await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betrieb}, ${email}, ${email}, 'x', ${rolle}) returning id`)[0].id as string;
		chefAId = await benutzer(betriebA, chefRolleA, 'chef-a@beispiel.test');
		monteurAId = await benutzer(betriebA, monteurRolleA, 'monteur-a@beispiel.test');
		bueroAId = await benutzer(betriebA, bueroRolleA, 'buero-a@beispiel.test');
		chefBId = await benutzer(betriebB, chefRolleB, 'chef-b@beispiel.test');
		await benutzer(betriebGesperrt, chefRolleG, 'chef-g@beispiel.test');
		chefA = nutzerVon(chefAId, betriebA, VORLAGEN.chef);
		monteurA = nutzerVon(monteurAId, betriebA, VORLAGEN.monteur);
		bueroA = nutzerVon(bueroAId, betriebA, BUERO_VERWALTER);
		chefB = nutzerVon(chefBId, betriebB, VORLAGEN.chef);
	});

	/** Lädt ein und liefert das Token aus dem Link. */
	async function neueEinladung(email = 'neu@beispiel.test', rolleId = monteurRolleA, von: Nutzer = chefA) {
		const a = await einladen(von, { email, rolleId });
		expect(a.status, JSON.stringify(a.koerper)).toBe(201);
		return tokenAus(a.koerper.link);
	}

	describe('Brief: Einladen und Annehmen', () => {
		it('Einladung annehmen legt Benutzer mit Rolle an', async () => {
			const a = await einladen(chefA, { email: '  Neu@Beispiel.TEST ', rolleId: monteurRolleA });
			expect(a.status).toBe(201);
			expect(a.koerper.link).toMatch(/^http:\/\/localhost\/einladung\/[A-Za-z0-9_-]{43}$/);
			const token = tokenAus(a.koerper.link);
			// Gespeichert wird nur der SHA-256, gültig 7 Tage
			const [e] = await root`
				select email::text, betrieb_id, rolle_id, token_hash, extract(epoch from (laeuft_ab - now())) as sek
				from app.einladungen`;
			expect(e.email).toBe('neu@beispiel.test');
			expect(e.betrieb_id).toBe(betriebA);
			expect(Buffer.from(e.token_hash).equals(sha256(token))).toBe(true);
			expect(Number(e.sek)).toBeGreaterThan(7 * 86400 - 60);
			expect(Number(e.sek)).toBeLessThanOrEqual(7 * 86400);

			const geladen = await ladeAnnahme(token);
			expect(geladen).toMatchObject({ gueltig: true, email: 'neu@beispiel.test', betrieb: 'Betrieb A' });
			expect(kopfzeilen).toMatchObject({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });

			const r = await annehmen(token, { name: '  Nina Neu ' });
			expect(r.umleitung).toEqual({ status: 303, location: '/anmelden?hinweis=eingerichtet' });
			const [k] = await konten('neu@beispiel.test');
			expect(k).toMatchObject({ betrieb_id: betriebA, rolle_id: monteurRolleA, name: 'Nina Neu', aktiv: true });
			expect(k.passwort_hash).toMatch(/^\$argon2id\$/);
			expect(await pruefePasswort(k.passwort_hash, PASSWORT)).toBe(true);
			const [angenommen] = await root`select angenommen from app.einladungen`;
			expect(angenommen.angenommen).not.toBeNull();
		});

		it('zweite Annahme desselben Tokens → ungültig, kein zweites Konto', async () => {
			const token = await neueEinladung();
			expect((await annehmen(token)).umleitung?.location).toBe('/anmelden?hinweis=eingerichtet');
			const zweite = await annehmen(token, { name: 'Andere', passwort: 'anderes-Passwort', passwort2: 'anderes-Passwort' });
			expect(zweite.umleitung).toBeNull();
			expect(zweite.ergebnis.data).toMatchObject({ fehler: UNGUELTIG, ungueltig: true });
			expect(await konten('neu@beispiel.test')).toHaveLength(1);
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
		});

		it('abgelaufen → ungültig', async () => {
			const token = await neueEinladung();
			await root`update app.einladungen set laeuft_ab = now() - interval '1 second'`;
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
			const r = await annehmen(token);
			expect(r.ergebnis.data).toMatchObject({ fehler: UNGUELTIG, ungueltig: true });
			expect(await konten('neu@beispiel.test')).toHaveLength(0);
		});

		it('bekannte E-Mail einladen → 409', async () => {
			// eigener Betrieb, anderer Betrieb, andere Schreibweise: immer dieselbe Meldung
			for (const email of ['monteur-a@beispiel.test', 'chef-b@beispiel.test', 'CHEF-B@Beispiel.test']) {
				const a = await einladen(chefA, { email, rolleId: monteurRolleA });
				expect(a, email).toEqual({ status: 409, koerper: { fehler: REGISTRIERT } });
			}
			expect(await root`select 1 from app.einladungen`).toHaveLength(0);
		});

		it('deaktivierter Benutzer: bestehende Sitzung ungültig', async () => {
			const token = await neueSitzung(monteurAId);
			expect((await pruefeSitzung(token))?.id).toBe(monteurAId);
			const a = await patch(chefA, monteurAId, { aktiv: false });
			expect(a.status).toBe(200);
			expect(a.koerper).toMatchObject({ id: monteurAId, aktiv: false });
			expect(await pruefeSitzung(token)).toBeNull();
			expect(await root`select 1 from app.sitzungen where benutzer_id = ${monteurAId}`).toHaveLength(0);
		});
	});

	describe('Einladung: Eingaben und Rechte', () => {
		it('ohne Anmeldung 401, ohne Recht benutzer.verwalten 403, Plattform-Admin 403', async () => {
			expect((await einladen(null, { email: 'x@beispiel.test', rolleId: monteurRolleA })).status).toBe(401);
			expect((await einladen(monteurA, { email: 'x@beispiel.test', rolleId: monteurRolleA })).status).toBe(403);
			const admin = nutzerVon(randomBytes(4).toString('hex'), null, [], true);
			expect((await einladen(admin, { email: 'x@beispiel.test', rolleId: monteurRolleA })).status).toBe(403);
		});

		it('ungültige E-Mail oder Rolle → 400; Rolle eines anderen Betriebs → 400', async () => {
			for (const email of ['', 'kein-at', 'a@b', 'a b@c.de', 'x'.repeat(250) + '@b.de', 7]) {
				expect((await einladen(chefA, { email, rolleId: monteurRolleA })).status, String(email)).toBe(400);
			}
			expect((await einladen(chefA, { email: 'x@beispiel.test', rolleId: 'kein-uuid' })).status).toBe(400);
			expect((await einladen(chefA, { email: 'x@beispiel.test' })).status).toBe(400);
			const fremd = await einladen(chefA, { email: 'x@beispiel.test', rolleId: chefRolleB });
			expect(fremd).toEqual({ status: 400, koerper: { fehler: 'Rolle nicht gefunden.' } });
			expect(await root`select 1 from app.einladungen`).toHaveLength(0);
		});

		it('erneutes Einladen derselben E-Mail ersetzt die offene Einladung (alter Link ungültig)', async () => {
			const alt = await neueEinladung();
			const neu = await neueEinladung('NEU@beispiel.test');
			expect(await root`select 1 from app.einladungen`).toHaveLength(1);
			expect(await ladeAnnahme(alt)).toEqual({ gueltig: false });
			expect((await ladeAnnahme(neu)).gueltig).toBe(true);
		});

		it('Verwalter ohne einstellungen darf nicht in eine Rolle mit fremden Rechten einladen (Carry T9)', async () => {
			const a = await einladen(bueroA, { email: 'chef2@beispiel.test', rolleId: chefRolleA });
			expect(a).toEqual({
				status: 403,
				koerper: { fehler: 'Sie können nur Rollen vergeben, deren Rechte Sie selbst haben.' }
			});
			expect(await root`select 1 from app.einladungen`).toHaveLength(0);
			// in eine Rolle, deren Rechte er selbst hat, schon
			expect((await einladen(bueroA, { email: 'm2@beispiel.test', rolleId: monteurRolleA })).status).toBe(201);
			expect((await einladen(bueroA, { email: 'b2@beispiel.test', rolleId: bueroRolleA })).status).toBe(201);
		});

		it('GET /api/einladungen listet offene Einladungen des eigenen Betriebs; DELETE widerruft', async () => {
			const token = await neueEinladung();
			await neueEinladung('fremd@beispiel.test', chefRolleB, chefB);
			const liste = await antwort(await einladungenGet({ locals: { nutzer: chefA } } as never));
			expect(liste.status).toBe(200);
			expect(liste.koerper).toHaveLength(1);
			expect(liste.koerper[0]).toMatchObject({ email: 'neu@beispiel.test', rolleId: monteurRolleA, rolleName: 'Monteur' });
			expect(liste.koerper[0]).not.toHaveProperty('tokenHash');
			expect(liste.koerper[0]).not.toHaveProperty('token_hash');
			const id = liste.koerper[0].id;
			const fremdId = (await root`select id from app.einladungen where betrieb_id = ${betriebB}`)[0].id;
			const del = async (nutzer: Nutzer, eid: string) =>
				antwort(await einladungDelete({ locals: { nutzer }, params: { id: eid } } as never));
			expect((await del(chefA, fremdId)).status).toBe(404);
			expect((await del(monteurA, id)).status).toBe(403);
			expect((await del(chefA, id)).status).toBe(204);
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
			expect(await root`select 1 from app.einladungen where betrieb_id = ${betriebB}`).toHaveLength(1);
		});
	});

	describe('Annahme: Eingaben und Sonderfälle', () => {
		it('Passwort unter 10 Zeichen, ungleiche Wiederholung, fehlender Name → 400, Einladung bleibt gültig', async () => {
			const token = await neueEinladung();
			const kurz = await annehmen(token, { passwort: '123456789', passwort2: '123456789' });
			expect(kurz.ergebnis.status).toBe(400);
			expect(kurz.ergebnis.data.fehler).toMatch(/mindestens 10 Zeichen/);
			const ungleich = await annehmen(token, { passwort2: 'etwas-anderes' });
			expect(ungleich.ergebnis.status).toBe(400);
			expect(ungleich.ergebnis.data.fehler).toMatch(/stimmen nicht überein/);
			const ohneName = await annehmen(token, { name: '   ' });
			expect(ohneName.ergebnis.status).toBe(400);
			const langerName = await annehmen(token, { name: 'x'.repeat(101) });
			expect(langerName.ergebnis.status).toBe(400);
			expect(await konten('neu@beispiel.test')).toHaveLength(0);
			expect((await ladeAnnahme(token)).gueltig).toBe(true);
			expect((await annehmen(token)).umleitung?.location).toBe('/anmelden?hinweis=eingerichtet');
		});

		it('unbekanntes oder kaputtes Token → ungültig', async () => {
			for (const token of ['unbekannt', randomBytes(32).toString('base64url'), 'x'.repeat(500)]) {
				expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
				const r = await annehmen(token);
				expect(r.ergebnis.data).toMatchObject({ fehler: UNGUELTIG, ungueltig: true });
			}
		});

		it('gesperrter Betrieb → ungültig', async () => {
			const [rolle] = await root`select id from app.rollen where betrieb_id = ${betriebGesperrt}`;
			const chefG = nutzerVon((await root`select id from app.benutzer where betrieb_id = ${betriebGesperrt}`)[0].id, betriebGesperrt, VORLAGEN.chef);
			const token = await neueEinladung('g@beispiel.test', rolle.id, chefG);
			await root`update app.betriebe set abo_status = 'gesperrt' where id = ${betriebGesperrt}`;
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
			expect((await annehmen(token)).ergebnis.data.ungueltig).toBe(true);
			expect(await konten('g@beispiel.test')).toHaveLength(0);
		});

		it('Betrieb im Nur-Lesezugriff → ungültig', async () => {
			const token = await neueEinladung();
			await root`
				update app.betriebe set abo_status = 'gekuendigt',
					abo_ende = (now() at time zone 'Europe/Berlin')::date - 1
				where id = ${betriebA}`;
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
			expect((await annehmen(token)).ergebnis.data.ungueltig).toBe(true);
		});

		it('E-Mail wurde inzwischen (z. B. in einem anderen Betrieb) registriert → ungültig, kein Konto', async () => {
			const token = await neueEinladung();
			await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betriebB}, 'neu@beispiel.test', 'Woanders', 'x', ${chefRolleB})`;
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
			expect((await annehmen(token)).ergebnis.data.ungueltig).toBe(true);
			expect(await konten('neu@beispiel.test')).toHaveLength(1);
		});

		it('gleichzeitige Annahme desselben Tokens: genau ein Konto', async () => {
			const token = await neueEinladung();
			const ergebnisse = await Promise.all([annehmen(token), annehmen(token), annehmen(token)]);
			expect(ergebnisse.filter((r) => r.umleitung !== null)).toHaveLength(1);
			expect(await konten('neu@beispiel.test')).toHaveLength(1);
		});

		it('Rolle wird gelöscht → Einladung verfällt', async () => {
			const [{ id: leer }] = await root`
				insert into app.rollen (betrieb_id, name, rechte) values (${betriebA}, 'Praktikum', ${['kunden.lesen']}) returning id`;
			const token = await neueEinladung('p@beispiel.test', leer);
			// über die Fachlogik als crm_app (nicht als Superuser): der Fremdschlüssel nimmt die Einladung mit
			await loescheRolle({ betriebId: betriebA, benutzerId: chefAId }, leer);
			expect(await root`select 1 from app.einladungen`).toHaveLength(0);
			expect(await ladeAnnahme(token)).toEqual({ gueltig: false });
		});
	});

	describe('Benutzergrenze (Carry T9 aus T8)', () => {
		/** Tarif mit genau `n` Benutzern für Betrieb A. */
		const grenzeA = async (n: number | null) => {
			const schluessel = `t-${randomBytes(4).toString('hex')}`;
			const [t] = await root`
				insert into app.tarife (schluessel, name, grenzen) values (${schluessel}, 'T', ${root.json({ benutzer: n })})
				returning id`;
			await root`update app.betriebe set tarif_id = ${t.id} where id = ${betriebA}`;
		};

		it('offene Einladungen belegen einen Platz: bei voller Grenze → 409', async () => {
			await grenzeA(4); // 3 aktive Benutzer
			await neueEinladung('eins@beispiel.test'); // 4 von 4
			const a = await einladen(chefA, { email: 'zwei@beispiel.test', rolleId: monteurRolleA });
			expect(a).toEqual({ status: 409, koerper: { fehler: 'Benutzergrenze des Tarifs erreicht' } });
			// dieselbe E-Mail erneut einladen ersetzt die alte Einladung und geht deshalb
			expect((await einladen(chefA, { email: 'eins@beispiel.test', rolleId: monteurRolleA })).status).toBe(201);
			// abgelaufene Einladungen zählen nicht
			await root`update app.einladungen set laeuft_ab = now() - interval '1 second'`;
			expect((await einladen(chefA, { email: 'zwei@beispiel.test', rolleId: monteurRolleA })).status).toBe(201);
		});

		it('deaktivierte Benutzer zählen nicht; Widerruf gibt den Platz frei', async () => {
			await grenzeA(3);
			expect((await einladen(chefA, { email: 'x@beispiel.test', rolleId: monteurRolleA })).status).toBe(409);
			await patch(chefA, monteurAId, { aktiv: false });
			await neueEinladung('x@beispiel.test');
			const [{ id }] = await root`select id from app.einladungen`;
			expect((await einladen(chefA, { email: 'y@beispiel.test', rolleId: monteurRolleA })).status).toBe(409);
			await einladungDelete({ locals: { nutzer: chefA }, params: { id } } as never);
			expect((await einladen(chefA, { email: 'y@beispiel.test', rolleId: monteurRolleA })).status).toBe(201);
		});

		it('Annahme prüft die Grenze erneut: ist der Betrieb inzwischen voll, entsteht kein Konto', async () => {
			await grenzeA(4);
			const token = await neueEinladung();
			// ein weiterer aktiver Benutzer (z. B. reaktiviert, als die Grenze noch höher war)
			await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betriebA}, 'voll@beispiel.test', 'Voll', 'x', ${monteurRolleA})`;
			const r = await annehmen(token);
			expect(r.umleitung).toBeNull();
			expect(r.ergebnis.status).toBe(409);
			expect(r.ergebnis.data.fehler).toMatch(/Benutzergrenze/);
			expect(await konten('neu@beispiel.test')).toHaveLength(0);
			// die Einladung ist nicht verbraucht
			expect((await root`select angenommen from app.einladungen`)[0].angenommen).toBeNull();
		});

		it('gleichzeitige Annahmen verschiedener Einladungen überschreiten die Grenze nie', async () => {
			await grenzeA(6); // 3 aktiv + 3 Einladungen
			const tokens = [
				await neueEinladung('r1@beispiel.test'),
				await neueEinladung('r2@beispiel.test'),
				await neueEinladung('r3@beispiel.test')
			];
			await grenzeA(4); // Grenze sinkt: nur noch eine Annahme passt
			const ergebnisse = await Promise.all(tokens.map((t) => annehmen(t)));
			expect(ergebnisse.filter((r) => r.umleitung !== null)).toHaveLength(1);
			const [{ n }] = await root`select count(*)::int as n from app.benutzer where betrieb_id = ${betriebA} and aktiv`;
			expect(n).toBe(4);
		});

		it('Reaktivieren prüft die Grenze', async () => {
			await grenzeA(3);
			await patch(chefA, monteurAId, { aktiv: false });
			await neueEinladung('x@beispiel.test'); // 3 von 3
			const a = await patch(chefA, monteurAId, { aktiv: true });
			expect(a).toEqual({ status: 409, koerper: { fehler: 'Benutzergrenze des Tarifs erreicht' } });
			expect(await aktivVon(monteurAId)).toBe(false);
		});

		it('unbegrenzt (null) erlaubt Einladung und Annahme', async () => {
			await grenzeA(null);
			const token = await neueEinladung();
			expect((await annehmen(token)).umleitung).not.toBeNull();
		});
	});

	describe('Benutzer ändern (PATCH /api/benutzer/[id])', () => {
		it('Rolle wechseln; Wechsel in eine Rolle mit einstellungen beendet die Sitzungen des Benutzers', async () => {
			const token = await neueSitzung(monteurAId);
			const a = await patch(chefA, monteurAId, { rolleId: bueroRolleA });
			expect(a.status).toBe(200);
			expect(a.koerper).toMatchObject({ id: monteurAId, rolleId: bueroRolleA, aktiv: true });
			expect(await pruefeSitzung(token)).not.toBeNull(); // Büro hat kein einstellungen
			const b = await patch(chefA, monteurAId, { rolleId: chefRolleA });
			expect(b.status).toBe(200);
			expect(await rolleVon(monteurAId)).toBe(chefRolleA);
			expect(await root`select 1 from app.sitzungen where benutzer_id = ${monteurAId}`).toHaveLength(0);
		});

		it('ohne Recht 403, unbekannter oder fremder Benutzer 404, fremde Rolle 400, leere Änderung 400', async () => {
			expect((await patch(monteurA, monteurAId, { aktiv: false })).status).toBe(403);
			expect((await patch(null, monteurAId, { aktiv: false })).status).toBe(401);
			expect((await patch(chefA, chefBId, { aktiv: false })).status).toBe(404);
			expect(await aktivVon(chefBId)).toBe(true);
			expect((await patch(chefA, '00000000-0000-4000-8000-000000000000', { aktiv: false })).status).toBe(404);
			expect((await patch(chefA, 'kein-uuid', { aktiv: false })).status).toBe(404);
			expect((await patch(chefA, monteurAId, { rolleId: chefRolleB })).koerper).toEqual({ fehler: 'Rolle nicht gefunden.' });
			expect(await rolleVon(monteurAId)).toBe(monteurRolleA);
			expect((await patch(chefA, monteurAId, {})).status).toBe(400);
			expect((await patch(chefA, monteurAId, { aktiv: 'nein' })).status).toBe(400);
			expect((await patch(chefA, monteurAId, { rolleId: null })).status).toBe(400);
		});

		it('sich selbst deaktivieren → 400', async () => {
			const a = await patch(chefA, chefAId, { aktiv: false });
			expect(a).toEqual({ status: 400, koerper: { fehler: 'Sie können sich nicht selbst deaktivieren.' } });
			expect(await aktivVon(chefAId)).toBe(true);
		});

		it('letzter Verwalter der Einstellungen kann seine Rolle nicht abgeben (Schutzregel)', async () => {
			const a = await patch(chefA, chefAId, { rolleId: monteurRolleA });
			expect(a).toEqual({ status: 409, koerper: { fehler: SCHUTZ } });
			expect(await rolleVon(chefAId)).toBe(chefRolleA);
		});

		it('zwei Chefs entziehen sich gleichzeitig gegenseitig die Rolle: genau einer gelingt', async () => {
			const [{ id: chef2 }] = await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (${betriebA}, 'chef2@beispiel.test', 'Chef 2', 'x', ${chefRolleA}) returning id`;
			const chefA2 = nutzerVon(chef2, betriebA, VORLAGEN.chef);
			for (let i = 0; i < 8; i++) {
				await root`update app.benutzer set aktiv = true, rolle_id = ${chefRolleA} where id in (${chefAId}, ${chef2})`;
				const [x, y] = await Promise.all([
					patch(chefA, chef2, { aktiv: false }),
					patch(chefA2, chefAId, { rolleId: monteurRolleA })
				]);
				expect([x.status, y.status].sort()).toEqual([200, 409]);
				const [{ n }] = await root`
					select count(*)::int as n from app.benutzer b join app.rollen r on r.id = b.rolle_id
					where b.betrieb_id = ${betriebA} and b.aktiv and 'einstellungen' = any (r.rechte)`;
				expect(n).toBe(1);
			}
		});

		describe('Verwalter ohne einstellungen (Carry T9)', () => {
			const KEINE = 'Sie können nur Rollen vergeben, deren Rechte Sie selbst haben.';
			const HOEHER = 'Diesen Benutzer können Sie nicht ändern, weil er Rechte hat, die Sie selbst nicht haben.';

			it('darf niemanden in eine Rolle mit Rechten setzen, die er nicht hat – auch sich selbst nicht', async () => {
				expect(await patch(bueroA, monteurAId, { rolleId: chefRolleA })).toEqual({ status: 403, koerper: { fehler: KEINE } });
				expect(await patch(bueroA, bueroAId, { rolleId: chefRolleA })).toEqual({ status: 403, koerper: { fehler: KEINE } });
				expect(await rolleVon(monteurAId)).toBe(monteurRolleA);
				expect(await rolleVon(bueroAId)).toBe(bueroRolleA);
			});

			it('darf Benutzer mit höheren Rechten weder umsetzen noch deaktivieren', async () => {
				expect(await patch(bueroA, chefAId, { aktiv: false })).toEqual({ status: 403, koerper: { fehler: HOEHER } });
				expect(await patch(bueroA, chefAId, { rolleId: monteurRolleA })).toEqual({ status: 403, koerper: { fehler: HOEHER } });
				expect(await aktivVon(chefAId)).toBe(true);
				expect(await rolleVon(chefAId)).toBe(chefRolleA);
			});

			it('darf innerhalb der eigenen Rechte ändern', async () => {
				expect((await patch(bueroA, monteurAId, { rolleId: bueroRolleA })).status).toBe(200);
				expect((await patch(bueroA, monteurAId, { aktiv: false })).status).toBe(200);
				expect((await patch(bueroA, monteurAId, { aktiv: true, rolleId: monteurRolleA })).status).toBe(200);
			});

			it('Rollenliste: GET /api/rollen ist mit benutzer.verwalten lesbar, ohne beide Rechte 403', async () => {
				const a = await antwort(await rollenGet({ locals: { nutzer: bueroA } } as never));
				expect(a.status).toBe(200);
				expect(a.koerper.map((r: any) => r.name).sort()).toEqual(['Büro-Verwaltung', 'Chef', 'Monteur']);
				expect((await antwort(await rollenGet({ locals: { nutzer: monteurA } } as never))).status).toBe(403);
			});
		});
	});

	describe('GET /api/benutzer', () => {
		it('listet die Benutzer des eigenen Betriebs mit Rolle, ohne Geheimnisse', async () => {
			const a = await antwort(await benutzerGet({ locals: { nutzer: chefA } } as never));
			expect(a.status).toBe(200);
			expect(a.koerper.map((b: any) => b.email).sort()).toEqual([
				'buero-a@beispiel.test', 'chef-a@beispiel.test', 'monteur-a@beispiel.test'
			]);
			const m = a.koerper.find((b: any) => b.id === monteurAId);
			expect(m).toMatchObject({ rolleId: monteurRolleA, rolleName: 'Monteur', aktiv: true });
			expect(JSON.stringify(a.koerper)).not.toMatch(/passwort|totp/i);
			expect((await antwort(await benutzerGet({ locals: { nutzer: monteurA } } as never))).status).toBe(403);
		});
	});

	describe('Seite /einstellungen/benutzer', () => {
		const seitenEvent = (nutzer: Nutzer | null, felder?: Record<string, string>) => {
			const url = new URL('http://localhost/einstellungen/benutzer');
			let request: Request | undefined;
			if (felder) {
				const form = new FormData();
				for (const [k, v] of Object.entries(felder)) form.set(k, v);
				request = new Request(url, { method: 'POST', body: form });
			}
			return { locals: { nutzer }, url, request } as never;
		};

		it('load: ohne Anmeldung → /anmelden; ohne Recht → 403; Verwalter sieht nur vergebbare Rollen als wählbar', async () => {
			expect((await ausfuehren(() => verwaltungLoad(seitenEvent(null)))).umleitung?.location).toBe('/anmelden');
			await expect(verwaltungLoad(seitenEvent(monteurA))).rejects.toMatchObject({ status: 403 });
			const d = (await verwaltungLoad(seitenEvent(bueroA))) as any;
			expect(d.benutzer).toHaveLength(3);
			const vergebbar = d.rollen.filter((r: any) => r.vergebbar).map((r: any) => r.name).sort();
			expect(vergebbar).toEqual(['Büro-Verwaltung', 'Monteur']);
		});

		it('Aktion einladen zeigt den Link; aendern und aktiv wirken; widerrufen löscht', async () => {
			const r = (await verwaltungAktionen.einladen(
				seitenEvent(chefA, { email: 'seite@beispiel.test', rolleId: monteurRolleA })
			)) as any;
			expect(r.link).toMatch(/\/einladung\/[A-Za-z0-9_-]{43}$/);
			expect(r.email).toBe('seite@beispiel.test');
			const fehler = (await verwaltungAktionen.einladen(
				seitenEvent(chefA, { email: 'chef-b@beispiel.test', rolleId: monteurRolleA })
			)) as any;
			expect(fehler.status).toBe(409);
			expect(fehler.data.fehler).toBe(REGISTRIERT);

			await verwaltungAktionen.aendern(seitenEvent(chefA, { id: monteurAId, rolleId: bueroRolleA }));
			expect(await rolleVon(monteurAId)).toBe(bueroRolleA);
			await verwaltungAktionen.aktiv(seitenEvent(chefA, { id: monteurAId, aktiv: 'false' }));
			expect(await aktivVon(monteurAId)).toBe(false);
			const [{ id }] = await root`select id from app.einladungen`;
			await verwaltungAktionen.widerrufen(seitenEvent(chefA, { id }));
			expect(await root`select 1 from app.einladungen`).toHaveLength(0);
		});
	});

	describe('Datenbank: Rechte und Funktionen', () => {
		const alsApp = async <T>(betriebId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) => {
			const app = postgres(db.urlApp, { max: 1, onnotice: () => {} });
			try {
				return (await app.begin(async (tx) => {
					await tx`select set_config('app.betrieb_id', ${betriebId}, true)`;
					return fn(tx);
				})) as T;
			} finally {
				await app.end();
			}
		};

		it('R6: crm_app darf keine Benutzer anlegen (weder mit noch ohne Passwort-Hash oder TOTP-Spalten)', async () => {
			await expect(
				alsApp(betriebA, (tx) => tx`
					insert into app.benutzer (betrieb_id, email, name, passwort_hash)
					values (${betriebA}, 'boese@beispiel.test', 'B', 'x')`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`
					insert into app.benutzer (betrieb_id, email, name, passwort_hash, totp_geheim, totp_aktiv)
					values (${betriebA}, 'boese@beispiel.test', 'B', 'x', 'AAAA', true)`)
			).rejects.toThrow(/permission denied/);
			const [z] = await root`
				select has_table_privilege('crm_app', 'app.benutzer', 'insert') as tabelle,
					has_any_column_privilege('crm_app', 'app.benutzer', 'insert') as spalte`;
			expect(z).toEqual({ tabelle: false, spalte: false });
		});

		it('einladungen: RLS (nur eigener Betrieb), token_hash nicht lesbar, Ablauf und Annahme nicht frei setzbar', async () => {
			await neueEinladung();
			await neueEinladung('b@beispiel.test', chefRolleB, chefB);
			const zeilen = await alsApp(betriebA, (tx) => tx`select id, betrieb_id from app.einladungen`);
			expect(zeilen.map((z) => z.betrieb_id)).toEqual([betriebA]);
			await expect(alsApp(betriebA, (tx) => tx`select token_hash from app.einladungen`)).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`
					insert into app.einladungen (betrieb_id, email, rolle_id, token_hash)
					values (${betriebB}, 'x@beispiel.test', ${chefRolleB}, ${sha256('x')})`)
			).rejects.toThrow(/row-level security/);
			await expect(
				alsApp(betriebA, (tx) => tx`
					insert into app.einladungen (betrieb_id, email, rolle_id, token_hash, laeuft_ab)
					values (${betriebA}, 'x@beispiel.test', ${monteurRolleA}, ${sha256('x')}, now() + interval '10 years')`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`update app.einladungen set angenommen = now()`)
			).rejects.toThrow(/permission denied/);
			// Rolle eines anderen Betriebs (Fremdschlüssel prüft den Betrieb mit)
			await expect(
				alsApp(betriebA, (tx) => tx`
					insert into app.einladungen (betrieb_id, email, rolle_id, token_hash)
					values (${betriebA}, 'x@beispiel.test', ${chefRolleB}, ${sha256('y')})`)
			).rejects.toThrow(/foreign key|violates/);
			const [r] = await root`
				select c.relrowsecurity, c.relforcerowsecurity from pg_class c
				join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relname = 'einladungen'`;
			expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
			const [admin] = await root`
				select has_table_privilege('crm_admin', 'app.einladungen', 'select') as s,
					has_table_privilege('crm_auth', 'app.einladungen', 'select') as a`;
			expect(admin).toEqual({ s: false, a: false });
		});

		it('R7/R10: Funktionen gehören crm, SECURITY DEFINER, fester search_path; Annahme nur für crm_auth', async () => {
			const funktionen = await root`
				select p.proname, pg_get_userbyid(p.proowner) as eigentuemer, p.prosecdef, p.proconfig,
					has_function_privilege('crm_auth', p.oid, 'execute') as auth_darf,
					has_function_privilege('crm_app', p.oid, 'execute') as app_darf,
					has_function_privilege('crm_admin', p.oid, 'execute') as admin_darf,
					has_function_privilege('public', p.oid, 'execute') as public_darf
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'app' and p.proname in ('einladung_annehmen', 'einladung_pruefen', 'email_vergeben')
				order by p.proname`;
			expect(funktionen.map((f) => f.proname)).toEqual(['einladung_annehmen', 'einladung_pruefen', 'email_vergeben']);
			for (const f of funktionen) {
				expect(f.eigentuemer, f.proname).toBe('crm');
				expect(f.prosecdef, f.proname).toBe(true);
				expect(String(f.proconfig), f.proname).toMatch(/search_path=app, pg_temp/);
				expect(f.admin_darf, f.proname).toBe(false);
				expect(f.public_darf, f.proname).toBe(false);
			}
			const [annehmen, pruefen, vergeben] = funktionen;
			expect([annehmen.auth_darf, annehmen.app_darf]).toEqual([true, false]);
			expect([pruefen.auth_darf, pruefen.app_darf]).toEqual([true, false]);
			expect([vergeben.auth_darf, vergeben.app_darf]).toEqual([false, true]);
		});

		it('crm_app kann eine Einladung nicht selbst annehmen', async () => {
			const token = await neueEinladung();
			await expect(
				alsApp(betriebA, (tx) => tx`select app.einladung_annehmen(${sha256(token)}::bytea, 'X', '$argon2id$x')`)
			).rejects.toThrow(/permission denied/);
			await expect(
				alsApp(betriebA, (tx) => tx`select * from app.einladung_pruefen(${sha256(token)}::bytea)`)
			).rejects.toThrow(/permission denied/);
		});

		it('einladung_annehmen verweigert Eingaben, die kein Argon2id-Hash oder kein Name sind', async () => {
			const token = await neueEinladung();
			for (const [name, hash] of [['X', 'klartext'], ['  ', '$argon2id$v=19$x'], ['X', null]] as const) {
				await expect(
					systemAbfrage((sql) => sql`select app.einladung_annehmen(${sha256(token)}::bytea, ${name}, ${hash})`)
				).rejects.toThrow();
			}
			expect(await konten('neu@beispiel.test')).toHaveLength(0);
		});
	});

	describe('R13: volle Sitzung braucht den zweiten Faktor, wenn er Pflicht ist', () => {
		const sitzung = async (benutzer: string, mitFaktor: boolean) => {
			const token = randomBytes(32).toString('base64url');
			await root`
				insert into app.sitzungen (token_hash, benutzer_id, laeuft_ab, mit_zweitem_faktor)
				values (${sha256(token)}, ${benutzer}, now() + interval '1 day', ${mitFaktor})`;
			return token;
		};

		it('Chef ohne Kennzeichen wird abgewiesen, mit Kennzeichen akzeptiert', async () => {
			expect(await pruefeSitzung(await sitzung(chefAId, false))).toBeNull();
			expect((await pruefeSitzung(await sitzung(chefAId, true)))?.id).toBe(chefAId);
		});

		it('Monteur ist nicht betroffen', async () => {
			expect((await pruefeSitzung(await sitzung(monteurAId, false)))?.id).toBe(monteurAId);
		});

		it('Plattform-Admin ohne Kennzeichen wird abgewiesen', async () => {
			const [{ id }] = await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash)
				values (null, 'admin@beispiel.test', 'Admin', 'x') returning id`;
			await root`insert into app.plattform_admins (benutzer_id) values (${id})`;
			expect(await pruefeSitzung(await sitzung(id, false))).toBeNull();
			expect((await pruefeSitzung(await sitzung(id, true)))?.id).toBe(id);
		});

		it('Rolle bekommt einstellungen während einer laufenden Sitzung ohne Faktor → Sitzung ungültig', async () => {
			const token = await sitzung(monteurAId, false);
			await root`update app.rollen set rechte = array_append(rechte, 'einstellungen') where id = ${monteurRolleA}`;
			expect(await pruefeSitzung(token)).toBeNull();
		});
	});
});
