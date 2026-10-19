import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { kiVerbrauch, verbrauche } from '../../src/lib/server/ki/kontingent';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

describe('KI-Kontingent (grenzen.ki_pro_monat)', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let betriebKlein: string, chefKlein: string, betriebNull: string, chefNull: string, betriebOhne: string, chefOhne: string;

	const k = (betriebId: string, benutzerId: string) => ({ betriebId, benutzerId });
	const fehlerVon = (p: Promise<unknown>) => p.then(() => null, (e) => e);

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		const tarif = async (schluessel: string, grenzen: string) =>
			(await root`
				insert into app.tarife (schluessel, name, module, grenzen)
				values (${schluessel}, ${schluessel}, ${['kunden', 'auftraege', 'sprache', 'ki_angebote']}, (${grenzen}::text)::jsonb) returning id`)[0]
				.id as string;
		const betrieb = async (name: string, tarifId: string) =>
			(await root`insert into app.betriebe (name, tarif_id, abo_status) values (${name}, ${tarifId}, 'aktiv') returning id`)[0].id as string;
		const chef = async (b: string, email: string) => {
			const [r] = await root`insert into app.rollen (betrieb_id, name, rechte) values (${b}, 'Chef', ${['einstellungen']}) returning id`;
			return (await root`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id) values (${b}, ${email}, 'Chef', 'x', ${r.id}) returning id`)[0]
				.id as string;
		};
		betriebKlein = await betrieb('Klein', await tarif('ki-zwei', '{"benutzer": 5, "ki_pro_monat": 2}'));
		chefKlein = await chef(betriebKlein, 'ki-klein@beispiel.test');
		betriebNull = await betrieb('Unbegrenzt', await tarif('ki-null', '{"benutzer": 5, "ki_pro_monat": null}'));
		chefNull = await chef(betriebNull, 'ki-null@beispiel.test');
		betriebOhne = await betrieb('Ohne Grenze', await tarif('ki-ohne', '{"benutzer": 5}'));
		chefOhne = await chef(betriebOhne, 'ki-ohne@beispiel.test');
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});
	beforeEach(async () => {
		await root`delete from app.ki_nutzung`;
	});

	it('Grenze 2: zwei Aufrufe ok, der dritte 429 „KI-Kontingent dieses Monats aufgebraucht“', async () => {
		await verbrauche(k(betriebKlein, chefKlein), 'aktion');
		await verbrauche(k(betriebKlein, chefKlein), 'entwurf');
		const f = await fehlerVon(verbrauche(k(betriebKlein, chefKlein), 'aktion'));
		expect(f).toMatchObject({ status: 429, message: 'KI-Kontingent dieses Monats aufgebraucht' });
		expect(await kiVerbrauch(k(betriebKlein, chefKlein))).toEqual({ anzahl: 2, grenze: 2 });
		// Zeile gehört dem Kalendermonat in Berlin
		const [z] = await root`select monat::text as monat, anzahl from app.ki_nutzung where betrieb_id = ${betriebKlein}`;
		expect(z.anzahl).toBe(2);
		const [{ monat }] = await root`select date_trunc('month', now() at time zone 'Europe/Berlin')::date::text as monat`;
		expect(z.monat).toBe(monat);
	});

	it('parallel 10 Aufrufe bei Grenze 5 → genau 5 ok', async () => {
		await root`update app.tarife set grenzen = '{"benutzer": 5, "ki_pro_monat": 5}' where schluessel = 'ki-zwei'`;
		try {
			const ergebnisse = await Promise.all(
				Array.from({ length: 10 }, () => verbrauche(k(betriebKlein, chefKlein), 'aktion').then(() => 'ok', (e) => e.status))
			);
			expect(ergebnisse.filter((x) => x === 'ok')).toHaveLength(5);
			expect(ergebnisse.filter((x) => x === 429)).toHaveLength(5);
			const [z] = await root`select anzahl from app.ki_nutzung where betrieb_id = ${betriebKlein}`;
			expect(z.anzahl).toBe(5);
		} finally {
			await root`update app.tarife set grenzen = '{"benutzer": 5, "ki_pro_monat": 2}' where schluessel = 'ki-zwei'`;
		}
	});

	it('Grenze 0 (Tarif Basis) → sofort 429, nichts gezählt', async () => {
		const [basis] = await root`select id from app.tarife where schluessel = 'basis'`;
		const [b] = await root`insert into app.betriebe (name, tarif_id, abo_status) values ('Basis', ${basis.id}, 'aktiv') returning id`;
		const f = await fehlerVon(verbrauche(k(b.id, u.ids.chefA), 'aktion'));
		expect(f).toMatchObject({ status: 429 });
		expect((await root`select count(*)::int as n from app.ki_nutzung where betrieb_id = ${b.id}`)[0].n).toBe(0);
	});

	it('null = ausdrücklich unbegrenzt; fehlende Grenze = Konfigurationsfehler (nie unbegrenzt)', async () => {
		for (let i = 0; i < 5; i++) await verbrauche(k(betriebNull, chefNull), 'aktion');
		expect(await kiVerbrauch(k(betriebNull, chefNull))).toEqual({ anzahl: 5, grenze: null });
		const f = await fehlerVon(verbrauche(k(betriebOhne, chefOhne), 'aktion'));
		expect(f).toBeInstanceOf(Error);
		expect(f.status).toBeUndefined();
		expect((await root`select count(*)::int as n from app.ki_nutzung where betrieb_id = ${betriebOhne}`)[0].n).toBe(0);
	});

	it('Mandantentrennung: Zählung je Betrieb, crm_app sieht nur die eigene Zeile und kann sie nicht direkt ändern', async () => {
		await verbrauche(k(u.betriebA, u.ids.chefA), 'aktion');
		await verbrauche(k(u.betriebB, u.ids.chefB), 'aktion');
		await verbrauche(k(u.betriebB, u.ids.chefB), 'aktion');
		expect((await kiVerbrauch(k(u.betriebA, u.ids.chefA))).anzahl).toBe(1);
		expect((await kiVerbrauch(k(u.betriebB, u.ids.chefB))).anzahl).toBe(2);
		const sichtbar = await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select betrieb_id from app.ki_nutzung`);
		expect(sichtbar.map((z) => z.betrieb_id)).toEqual([u.betriebA]);
		for (const anweisung of [
			(tx: postgres.TransactionSql) => tx`update app.ki_nutzung set anzahl = 0`,
			(tx: postgres.TransactionSql) => tx`delete from app.ki_nutzung`,
			(tx: postgres.TransactionSql) =>
				tx`insert into app.ki_nutzung (betrieb_id, monat, anzahl) values (${u.betriebA}, '2026-01-01', 0)`
		]) {
			const f = await fehlerVon(u.alsApp(u.betriebA, u.ids.chefA, anweisung));
			expect(f?.code).toBe('42501');
		}
		// Ohne Betriebskontext kein Verbrauch
		const ohne = await fehlerVon(
			u.alsApp(u.betriebA, u.ids.chefA, async (tx) => {
				await tx`select set_config('app.betrieb_id', '', true)`;
				return tx`select app.ki_verbrauche()`;
			})
		);
		expect(ohne?.code).toBe('42501');
	});

	it('Tabelle hat RLS aktiviert und erzwungen', async () => {
		const [t] = await root`
			select relrowsecurity, relforcerowsecurity from pg_class where oid = 'app.ki_nutzung'::regclass`;
		expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
	});
});
