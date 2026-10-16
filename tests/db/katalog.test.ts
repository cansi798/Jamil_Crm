import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { berlinTag } from '../../src/lib/zeit';
import { antwort, baueUmgebung, jsonAnfrage, leereAngebote, type Umgebung } from './hilfe-1c';
import {
	deaktivierePosition,
	holePosition,
	legePositionAn,
	listeKatalog,
	uebernimmVorlagen
} from '../../src/lib/server/katalog';
import { GET as katalogGet, POST as katalogPost } from '../../src/routes/api/katalog/+server';
import {
	DELETE as positionDelete,
	GET as positionGet,
	PATCH as positionPatch
} from '../../src/routes/api/katalog/[id]/+server';
import { GET as vorlagenGet, POST as vorlagenPost } from '../../src/routes/api/katalog/vorlagen/+server';
import { actions as listeAktionen, load as listeLoad } from '../../src/routes/(app)/katalog/+page.server';
import { actions as neuAktionen } from '../../src/routes/(app)/katalog/neu/+page.server';
import { actions as detailAktionen, load as detailLoad } from '../../src/routes/(app)/katalog/[id]/+page.server';

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

describe('Leistungskatalog – Dienst, API, Seiten', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	const liste = async (nutzer: Nutzer | null, params: Record<string, string> = {}) => {
		const url = new URL('http://localhost/api/katalog');
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		return antwort(await katalogGet({ locals: { nutzer }, url } as never));
	};
	const post = async (nutzer: Nutzer | null, koerper: unknown) =>
		antwort(await katalogPost({ locals: { nutzer }, request: jsonAnfrage('POST', koerper) } as never));
	const get = async (nutzer: Nutzer | null, id: string) =>
		antwort(await positionGet({ locals: { nutzer }, params: { id } } as never));
	const patch = async (nutzer: Nutzer | null, id: string, koerper: unknown) =>
		antwort(await positionPatch({ locals: { nutzer }, params: { id }, request: jsonAnfrage('PATCH', koerper) } as never));
	const del = async (nutzer: Nutzer | null, id: string) =>
		antwort(await positionDelete({ locals: { nutzer }, params: { id } } as never));
	const vorlagen = async (nutzer: Nutzer | null) => antwort(await vorlagenGet({ locals: { nutzer } } as never));
	const uebernehmen = async (nutzer: Nutzer | null, gewerk: unknown) =>
		antwort(await vorlagenPost({ locals: { nutzer }, request: jsonAnfrage('POST', { gewerk }) } as never));

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
		await root`delete from app.katalog_positionen`;
	});

	it('Startvorlage „fliesen“ übernehmen: alle mit Preis 0; zweites Mal neu: 0; Liste der Vorlagen je Gewerk', async () => {
		const [{ n }] = await root`select count(*)::int as n from app.katalog_vorlagen where gewerk = 'fliesen'`;
		const r1 = await uebernehmen(u.chefA, 'fliesen');
		expect(r1).toMatchObject({ status: 200, koerper: { neu: n } });
		const r2 = await uebernehmen(u.bueroA, 'fliesen');
		expect(r2).toMatchObject({ status: 200, koerper: { neu: 0 } });
		const pos = (await liste(u.chefA, { gewerk: 'fliesen' })).koerper;
		expect(pos).toHaveLength(n);
		for (const p of pos) expect(p).toMatchObject({ gewerk: 'fliesen', lohnCent: 0, materialCent: 0, einzelpreisCent: 0, aktiv: true });
		expect(pos.every((p: any) => p.vorlageId)).toBe(true);
		const v = await vorlagen(u.chefA);
		expect(v.status).toBe(200);
		expect(v.koerper.map((g: any) => g.gewerk)).toEqual(['bad_sanitaer', 'fliesen', 'maler', 'trockenbau']);
		const fliesen = v.koerper.find((g: any) => g.gewerk === 'fliesen');
		expect(fliesen).toMatchObject({ name: 'Fliesen', anzahl: n, offen: 0 });
		expect(v.koerper.find((g: any) => g.gewerk === 'maler').offen).toBeGreaterThanOrEqual(10);
		expect((await uebernehmen(u.chefA, 'elektro')).status).toBe(400);
		expect((await uebernehmen(u.nurAngeboteA, 'maler')).status).toBe(403);
		// Betrieb B ist unberührt
		expect((await liste(u.chefB)).koerper).toHaveLength(0);
	});

	it('Anlegen mit Komma-Beträgen, Preis negativ → 400, Einheit/Gewerk geprüft, Ändern', async () => {
		const r = await post(u.chefA, { bezeichnung: 'Fliesen verlegen', einheit: 'm²', gewerk: 'fliesen', nummer: 'F-01', lohn: '1.234,56', material: '2,5' });
		expect(r.status).toBe(201);
		expect(r.koerper).toMatchObject({ lohnCent: 123456, materialCent: 250, einzelpreisCent: 123706, nummer: 'F-01', aktiv: true });
		for (const falsch of [
			{ bezeichnung: 'x', einheit: 'm²', lohn: '-1' },
			{ bezeichnung: 'x', einheit: 'm²', material: '1,234' },
			{ bezeichnung: 'x', einheit: 'Eimer' },
			{ bezeichnung: 'x', einheit: 'm²', gewerk: 'elektro' },
			{ bezeichnung: '', einheit: 'm²' },
			{ bezeichnung: 'x', einheit: 'm²', nummer: '1'.repeat(21) }
		]) {
			expect((await post(u.chefA, falsch)).status, JSON.stringify(falsch)).toBe(400);
		}
		const p = await patch(u.chefA, r.koerper.id, { lohn: 4500, aktiv: false, beschreibung: 'Neu' });
		expect(p.koerper).toMatchObject({ lohnCent: 450000, materialCent: 250, aktiv: false, beschreibung: 'Neu', bezeichnung: 'Fliesen verlegen' });
		expect((await patch(u.chefA, r.koerper.id, { lohn: '-5' })).status).toBe(400);
		expect((await patch(u.chefA, r.koerper.id, {})).status).toBe(400);
		expect((await get(u.chefB, r.koerper.id)).status).toBe(404);
		expect((await patch(u.chefB, r.koerper.id, { bezeichnung: 'x' })).status).toBe(404);
		expect((await get(u.chefA, 'kaputt')).status).toBe(404);
		expect((await liste(u.chefA, { nurAktive: '1' })).koerper).toHaveLength(0);
		expect((await liste(u.chefA)).koerper).toHaveLength(1);
	});

	it('Löschen: unbenutzt → gelöscht; in einem Angebot verwendet → nur aktiv=false', async () => {
		const frei = (await post(u.chefA, { bezeichnung: 'Frei', einheit: 'Stk' })).koerper;
		const benutzt = (await post(u.chefA, { bezeichnung: 'Benutzt', einheit: 'Stk', lohn: '10' })).koerper;
		await u.alsApp(u.betriebA, u.ids.chefA, async (tx) => {
			const [a] = await tx`
				insert into app.angebote (betrieb_id, auftrag_id, gueltig_bis) values (${u.betriebA}, ${u.auftragA}, current_date + 30) returning id`;
			await tx`
				insert into app.angebot_positionen (betrieb_id, angebot_id, pos, katalog_position_id, bezeichnung, menge, einheit, einzelpreis_cent)
				values (${u.betriebA}, ${a.id}, 1, ${benutzt.id}, 'Benutzt', 1, 'Stk', 1000)`;
		});
		expect(await del(u.chefA, frei.id)).toMatchObject({ status: 200, koerper: { ergebnis: 'geloescht' } });
		expect((await get(u.chefA, frei.id)).status).toBe(404);
		expect(await del(u.chefA, benutzt.id)).toMatchObject({ status: 200, koerper: { ergebnis: 'deaktiviert' } });
		expect((await get(u.chefA, benutzt.id)).koerper).toMatchObject({ aktiv: false });
		expect(await deaktivierePosition(kA(), benutzt.id)).toBe('deaktiviert');
		expect((await del(u.nurAngeboteA, benutzt.id)).status).toBe(403);
	});

	it('Rechte: Büro liest mit Preisen; ohne preise.sehen fehlen Preisfelder; Monteur 403; Tarif ohne Katalog 402', async () => {
		await post(u.chefA, { bezeichnung: 'Wände streichen', einheit: 'm²', gewerk: 'maler', lohn: '8,50', material: '1,20' });
		const buero = await liste(u.bueroA);
		expect(buero.koerper[0]).toMatchObject({ lohnCent: 850, materialCent: 120, einzelpreisCent: 970 });
		for (const n of [u.nurAngeboteA, u.ohnePreiseA]) {
			const r = await liste(n);
			expect(r.status).toBe(200);
			expect(r.koerper).toHaveLength(1);
			for (const feld of ['lohnCent', 'materialCent', 'einzelpreisCent']) expect(feld in r.koerper[0], feld).toBe(false);
			const einzel = await get(n, r.koerper[0].id);
			expect('lohnCent' in einzel.koerper).toBe(false);
		}
		// ohne preise.sehen keine Preise setzen (wohl aber Texte)
		const id = buero.koerper[0].id;
		expect((await patch(u.ohnePreiseA, id, { lohn: '1' })).status).toBe(403);
		const t = await patch(u.ohnePreiseA, id, { bezeichnung: 'Wände streichen 2×' });
		expect(t.status).toBe(200);
		expect('lohnCent' in t.koerper).toBe(false);
		expect((await post(u.ohnePreiseA, { bezeichnung: 'x', einheit: 'm²', material: '2' })).status).toBe(403);
		expect((await liste(u.monteurA)).status).toBe(403);
		expect((await get(u.monteurA, id)).status).toBe(403);
		expect((await liste(u.chefC)).status).toBe(402);
		expect((await liste(null)).status).toBe(401);
		expect((await liste(u.admin)).status).toBe(403);
	});

	it('Suche über Nummer/Bezeichnung/Beschreibung, Groß-/Kleinschreibung egal, LIKE-Zeichen wirken nicht', async () => {
		await uebernimmVorlagen(kA(), 'maler');
		await legePositionAn(kA(), { bezeichnung: '100% Rabattaktion', einheit: 'psch' }, true);
		const treffer = await listeKatalog(kA(), { suche: 'WÄNDE dispersion' }, true);
		expect(treffer.map((p) => p.bezeichnung)).toEqual(['Wände streichen Dispersion 2×']);
		expect((await listeKatalog(kA(), { suche: '%' }, true)).map((p) => p.bezeichnung)).toEqual(['100% Rabattaktion']);
		expect((await listeKatalog(kA(), { gewerk: 'maler' }, false)).every((p) => !('lohnCent' in p))).toBe(true);
		const p = await holePosition(kA(), treffer[0].id, true);
		expect(p.einheit).toBe('m²');
	});

	it('Seiten: Liste mit/ohne Preise, Vorlage per Formular, Neu und Bearbeiten', async () => {
		await expect(listeLoad({ locals: { nutzer: u.monteurA }, url: new URL('http://localhost/katalog') } as never)).rejects.toMatchObject({ status: 403 });
		const form = (felder: Record<string, string>) =>
			new Request('http://localhost/katalog', { method: 'POST', body: new URLSearchParams(felder) });
		const erg = await listeAktionen.vorlage({ locals: { nutzer: u.chefA }, request: form({ gewerk: 'trockenbau' }) } as never);
		expect(erg).toMatchObject({ uebernommen: { gewerk: 'trockenbau' } });
		expect((erg as any).uebernommen.neu).toBeGreaterThanOrEqual(10);
		const d = (await listeLoad({ locals: { nutzer: u.chefA }, url: new URL('http://localhost/katalog?gewerk=trockenbau') } as never)) as any;
		expect(d.positionen.length).toBeGreaterThanOrEqual(10);
		expect(d.mitPreisen).toBe(true);
		expect(d.darfBearbeiten).toBe(true);
		const ohne = (await listeLoad({ locals: { nutzer: u.nurAngeboteA }, url: new URL('http://localhost/katalog') } as never)) as any;
		expect(ohne.mitPreisen).toBe(false);
		expect(ohne.darfBearbeiten).toBe(false);
		expect(JSON.stringify(ohne)).not.toMatch(/lohnCent|materialCent|einzelpreisCent/);
		// Neu
		await expect(
			neuAktionen.default({ locals: { nutzer: u.chefA }, request: form({ bezeichnung: 'Q4 spachteln', einheit: 'm²', lohn: '12,00', material: '' }) } as never)
		).rejects.toMatchObject({ status: 303 });
		const neu = (await listeKatalog(kA(), { suche: 'Q4' }, true))[0];
		expect(neu.lohnCent).toBe(1200);
		const fehl = await neuAktionen.default({ locals: { nutzer: u.chefA }, request: form({ bezeichnung: 'x', einheit: 'm²', lohn: '-3' }) } as never);
		expect(fehl).toMatchObject({ status: 400 });
		// Bearbeiten
		const dd = (await detailLoad({ locals: { nutzer: u.chefA }, params: { id: neu.id } } as never)) as any;
		expect(dd.position.id).toBe(neu.id);
		await expect(
			detailAktionen.speichern({
				locals: { nutzer: u.chefA },
				params: { id: neu.id },
				request: form({ bezeichnung: 'Q4 spachteln', einheit: 'm²', lohn: '13,5', material: '1', gewerk: 'maler', nummer: '', beschreibung: '', aktiv: 'on' })
			} as never)
		).rejects.toMatchObject({ status: 303 });
		expect((await holePosition(kA(), neu.id, true)).einzelpreisCent).toBe(1450);
		await expect(
			detailAktionen.loeschen({ locals: { nutzer: u.chefA }, params: { id: neu.id }, request: form({}) } as never)
		).rejects.toMatchObject({ status: 303 });
		await expect(holePosition(kA(), neu.id, true)).rejects.toMatchObject({ status: 404 });
	});
});
