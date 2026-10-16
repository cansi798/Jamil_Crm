import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { berlinTag } from '../../src/lib/zeit';
import { baueUmgebung, leereAngebote, type Umgebung } from './hilfe-1c';

const JAHR = berlinTag(new Date()).slice(0, 4);

describe('Katalog, Briefkopf, Angebote – Schema', () => {
	let u: Umgebung;
	let root: postgres.Sql;

	/** Angebot direkt als crm_app (Nummer vom Trigger) mit einer Position. */
	const sqlAngebot = async (betrieb: string, benutzer: string, auftrag: string) =>
		u.alsApp(betrieb, benutzer, async (tx) => {
			const [a] = await tx`
				insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis)
				values (${betrieb}, ${auftrag}, current_date + 30) returning id, nummer, status`;
			const [p] = await tx`
				insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${betrieb}, ${a.id}, 1, 'Fliesen verlegen', 2.5, 'm²', 4999) returning id`;
			return { ...(a as { id: string; nummer: string; status: string }), positionId: p.id as string };
		});

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});

	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	beforeEach(async () => {
		await leereAngebote(root);
		await root`delete from app.angebot_nummern`;
		await root`delete from app.katalog_positionen`;
		await root`delete from app.betrieb_profil`;
	});

	it('Startvorlagen: je Gewerk mindestens 10, ohne Preisspalten, für crm_app nur lesbar', async () => {
		const z = await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
			select gewerk, count(*)::int as n from app.katalog_vorlagen group by gewerk order by gewerk`);
		expect(z.map((r) => r.gewerk)).toEqual(['bad_sanitaer', 'fliesen', 'maler', 'trockenbau']);
		for (const r of z) expect(r.n, r.gewerk).toBeGreaterThanOrEqual(10);
		const spalten = await root`
			select column_name from information_schema.columns where table_schema = 'app' and table_name = 'katalog_vorlagen'`;
		for (const s of spalten) expect(s.column_name).not.toMatch(/cent|preis|lohn|material/);
		const namen = (await root`select bezeichnung from app.katalog_vorlagen`).map((r) => r.bezeichnung);
		expect(namen).toEqual(
			expect.arrayContaining([
				'Demontage Altbad',
				'Bodengleiche Dusche einbauen',
				'WC wandhängend inkl. Vorwandelement montieren',
				'Bodenfliesen verlegen bis 60×60',
				'Abdichtung im Verbund',
				'Wände streichen Dispersion 2×',
				'Spachteln Q3',
				'Ständerwand einfach beplankt',
				'Decke abhängen'
			])
		);
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.katalog_vorlagen set bezeichnung = 'x'`)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
				insert into app.katalog_vorlagen (gewerk, bezeichnung, einheit) values ('maler', 'x', 'm²')`)
		).rejects.toMatchObject({ code: '42501' });
	});

	it('Angebotsnummern AN-<Jahr>-0001/0002 je Betrieb; nicht wählbar; Status beginnt als Entwurf', async () => {
		const a1 = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		const a2 = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		const b1 = await sqlAngebot(u.betriebB, u.ids.chefB, u.auftragB);
		expect(a1.nummer).toBe(`AN-${JAHR}-0001`);
		expect(a2.nummer).toBe(`AN-${JAHR}-0002`);
		expect(b1.nummer).toBe(`AN-${JAHR}-0001`);
		expect(a1.status).toBe('entwurf');
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
				insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, nummer)
				values (${u.betriebA}, ${u.auftragA}, current_date + 30, 'AN-1')`)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
				insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis, status)
				values (${u.betriebA}, ${u.auftragA}, current_date + 30, 'angenommen')`)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select app.naechste_angebotsnummer(${u.betriebA}::uuid)`)
		).rejects.toMatchObject({ code: '42501' });
		await expect(u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`select * from app.angebot_nummern`)).rejects.toMatchObject({
			code: '42501'
		});
	});

	it('RLS: Betrieb B sieht und ändert nichts von A (Katalog, Profil, Angebote, Positionen)', async () => {
		const a = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		await root`
			insert into app.katalog_positionen (betrieb_id, bezeichnung, einheit, lohn_cent) values (${u.betriebA}, 'Fliesen', 'm²', 3000)`;
		await root`insert into app.betrieb_profil (betrieb_id, firmenname) values (${u.betriebA}, 'Firma A')`;
		const sicht = await u.alsApp(u.betriebB, u.ids.chefB, async (tx) => ({
			k: await tx`select 1 from app.katalog_positionen`,
			p: await tx`select 1 from app.betrieb_profil`,
			a: await tx`select 1 from app.angebote`,
			ap: await tx`select 1 from app.angebot_positionen`,
			ku: await tx`update app.katalog_positionen set lohn_cent = 1 returning id`,
			pu: await tx`update app.betrieb_profil set firmenname = 'Gehackt' returning betrieb_id`,
			ad: await tx`delete from app.angebot_positionen returning id`
		}));
		for (const [name, z] of Object.entries(sicht)) expect(z, name).toHaveLength(0);
		await expect(
			u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`
				insert into app.katalog_positionen (betrieb_id, bezeichnung, einheit) values (${u.betriebA}, 'x', 'm²')`)
		).rejects.toMatchObject({ code: '42501' });
		// Angebot auf einen fremden Auftrag bzw. Position auf ein fremdes Angebot: Fremdschlüssel (23503)
		await expect(
			u.alsApp(u.betriebB, u.ids.chefB, (tx) => tx`
				insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis) values (${u.betriebB}, ${u.auftragA}, current_date + 30)`)
		).rejects.toMatchObject({ code: '23503' });
		await expect(
			root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebB}, ${a.id}, 2, 'x', 1, 'Stk', 0)`
		).rejects.toMatchObject({ code: '23503' });
		const tabellen = ['katalog_positionen', 'betrieb_profil', 'angebote', 'angebot_positionen', 'angebot_nummern'];
		const rls = await root`
			select relname, relrowsecurity, relforcerowsecurity from pg_class
			where relnamespace = 'app'::regnamespace and relname = any(${tabellen})`;
		expect(rls).toHaveLength(5);
		for (const z of rls) expect([z.relrowsecurity, z.relforcerowsecurity], z.relname).toEqual([true, true]);
		for (const url of [u.db.urlAdmin, u.db.urlAuth]) {
			const s = postgres(url, { max: 1, onnotice: () => {} });
			try {
				for (const t of tabellen) await expect(s.unsafe(`select 1 from app.${t}`)).rejects.toMatchObject({ code: '42501' });
			} finally {
				await s.end();
			}
		}
	});

	it('versendetes Angebot ist eingefroren: Positionen und Kopf → 55000; Status wechselt weiter', async () => {
		const a = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.angebote set status = 'versendet' where id = ${a.id}`);
		const versuche = [
			(tx: postgres.TransactionSql) => tx`update app.angebot_positionen set menge = 3 where id = ${a.positionId}`,
			(tx: postgres.TransactionSql) => tx`delete from app.angebot_positionen where id = ${a.positionId}`,
			(tx: postgres.TransactionSql) => tx`
				insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 2, 'Zusatz', 1, 'Stk', 100)`,
			(tx: postgres.TransactionSql) => tx`update app.angebote set einleitung = 'Neu' where id = ${a.id}`,
			(tx: postgres.TransactionSql) => tx`update app.angebote set mwst_satz = 7 where id = ${a.id}`,
			(tx: postgres.TransactionSql) => tx`delete from app.angebote where id = ${a.id}`
		];
		for (const v of versuche) {
			await expect(u.alsApp(u.betriebA, u.ids.chefA, v)).rejects.toMatchObject({
				code: '55000',
				message: 'Angebot ist nicht mehr änderbar'
			});
		}
		await u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`update app.angebote set status = 'angenommen' where id = ${a.id}`);
		const [z] = await root`select status from app.angebote where id = ${a.id}`;
		expect(z.status).toBe('angenommen');
		// Entwurf bleibt frei änderbar und löschbar (Positionen fallen mit)
		const e = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		await u.alsApp(u.betriebA, u.ids.chefA, async (tx) => {
			await tx`update app.angebot_positionen set menge = 3 where id = ${e.positionId}`;
			await tx`delete from app.angebote where id = ${e.id}`;
		});
		expect(await root`select 1 from app.angebot_positionen where angebot_id = ${e.id}`).toHaveLength(0);
		// Ein Betrieb mit versendeten Angeboten lässt sich trotzdem (als Plattform) löschen – Kaskade wird nicht blockiert
		const [tmp] = await root`
			insert into app.betriebe (name, tarif_id, abo_status)
			select 'Tmp', tarif_id, 'aktiv' from app.betriebe where id = ${u.betriebA} returning id`;
		const [kunde] = await root`insert into app.kunden (betrieb_id, art, nachname) values (${tmp.id}, 'privat', 'X') returning id`;
		const [auftrag] = await root`
			insert into app.auftraege (betrieb_id, titel, kunde_id) values (${tmp.id}, 'x', ${kunde.id}) returning id`;
		const [ta] = await root`
			insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis) values (${tmp.id}, ${auftrag.id}, current_date + 30) returning id`;
		await root`
			insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
			values (${tmp.id}, ${ta.id}, 1, 'x', 1, 'Stk', 1)`;
		await root`update app.angebote set status = 'versendet' where id = ${ta.id}`;
		await root`delete from app.betriebe where id = ${tmp.id}`;
		expect(await root`select 1 from app.angebote where betrieb_id = ${tmp.id}`).toHaveLength(0);
	});

	it('Check-Constraints: Menge > 0, Preise ≥ 0, Einheit aus der Liste, MwSt 0/7/19, gültig bis ≥ Datum', async () => {
		const a = await sqlAngebot(u.betriebA, u.ids.chefA, u.auftragA);
		const faelle = [
			root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 2, 'x', 0, 'Stk', 1)`,
			root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 2, 'x', 1, 'Stk', -1)`,
			root`insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 2, 'x', 1, 'Eimer', 1)`,
			root`update app.angebote set mwst_satz = 16 where id = ${a.id}`,
			root`update app.angebote set gueltig_bis = datum - 1 where id = ${a.id}`,
			root`insert into app.katalog_positionen (betrieb_id, bezeichnung, einheit, lohn_cent) values (${u.betriebA}, 'x', 'm²', -5)`,
			root`insert into app.katalog_positionen (betrieb_id, bezeichnung, einheit) values (${u.betriebA}, '  ', 'm²')`,
			root`insert into app.katalog_positionen (betrieb_id, bezeichnung, einheit, nummer) values (${u.betriebA}, 'x', 'm²', ${'1'.repeat(21)})`,
			root`insert into app.betrieb_profil (betrieb_id, logo) values (${u.betriebA}, ${Buffer.from('x')})`
		];
		for (const f of faelle) await expect(f).rejects.toMatchObject({ code: '23514' });
		// Positionsnummern sind je Angebot eindeutig (am Ende der Transaktion)
		await expect(
			u.alsApp(u.betriebA, u.ids.chefA, (tx) => tx`
				insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 1, 'doppelt', 1, 'Stk', 1)`)
		).rejects.toMatchObject({ code: '23505' });
		// … vorübergehend doppelt innerhalb einer Transaktion ist erlaubt (Neuordnen)
		await u.alsApp(u.betriebA, u.ids.chefA, async (tx) => {
			await tx`
				insert into app.angebot_positionen (betrieb_id, angebot_id, pos, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 1, 'neu', 1, 'Stk', 1)`;
			await tx`update app.angebot_positionen set pos = 2 where id = ${a.positionId}`;
		});
	});

	it('Logo-Bytes erscheinen nie im Änderungsprotokoll; der Logo-Wechsel schon (logo_typ, logo_geaendert)', async () => {
		await root`delete from app.aenderungen where tabelle = 'betrieb_profil'`;
		const marke = Buffer.from('\x89PNG-NIEMALS-IM-PROTOKOLL');
		await u.alsApp(u.betriebA, u.ids.chefA, async (tx) => {
			await tx`
				insert into app.betrieb_profil (betrieb_id, firmenname, logo, logo_typ, logo_geaendert)
				values (${u.betriebA}, 'Bauwelt', ${marke}, 'image/png', now())`;
			await tx`update app.betrieb_profil set logo = ${Buffer.from('\x89PNG-NIEMALS-ZWEI')}, logo_geaendert = now() + interval '1 second'`;
		});
		const eintraege = await root`select vorher, nachher from app.aenderungen where tabelle = 'betrieb_profil'`;
		expect(eintraege).toHaveLength(2);
		const text = JSON.stringify(eintraege);
		expect(text).not.toContain(marke.toString('hex'));
		expect(text).not.toContain(Buffer.from('\x89PNG-NIEMALS-ZWEI').toString('hex'));
		expect(text).not.toContain('NIEMALS');
		for (const e of eintraege) expect(Object.keys(e.nachher)).not.toContain('logo');
		expect(eintraege[0].nachher).toMatchObject({ firmenname: 'Bauwelt', logo_typ: 'image/png' });
	});
});
