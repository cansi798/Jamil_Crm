import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { ladeBoard } from '../../src/lib/server/auftrag-board';
import { listeAuftraege } from '../../src/lib/server/auftraege';
import { untergruppe } from '../../src/lib/auftrag-board';

/** Untergruppen „Neu/Termin vereinbart“ und „Noch kein Angebot/Angebot erhalten“ aus echten Daten (Jamil msg 3601). */
describe('Aufträge: Untergruppen in Anfrage und Angebot', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const sicht = () => ({ alle: true, benutzerId: u.ids.chefA });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Termin (auch vergangen) → „Termin vereinbart“; verschicktes Angebot → „Angebot erhalten“, Entwurf nicht; Status bleibt', async () => {
		const neu = await u.neuerAuftrag('anfrage', 'UG neu');
		const mitTermin = await u.neuerAuftrag('anfrage', 'UG Termin');
		const vorbei = await u.neuerAuftrag('anfrage', 'UG Termin vorbei');
		const ohneAngebot = await u.neuerAuftrag('angebot', 'UG ohne Angebot');
		const mitEntwurf = await u.neuerAuftrag('angebot', 'UG Entwurf');
		const mitAngebot = await u.neuerAuftrag('angebot', 'UG verschickt');
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende) values
			(${u.betriebA}, ${mitTermin}, ${u.ids.monteurA}, now() + interval '2 days', now() + interval '2 days 2 hours'),
			(${u.betriebA}, ${vorbei}, ${u.ids.monteurA}, now() - interval '3 days', now() - interval '3 days' + interval '1 hour')`;
		await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${mitEntwurf}, 'entwurf', '2099-12-31')`;
		const [an] = await root`insert into app.angebote (betrieb_id, auftrag_id, status, gueltig_bis) values (${u.betriebA}, ${mitAngebot}, 'entwurf', '2099-12-31') returning id`;
		await root`update app.angebote set status = 'versendet' where id = ${an.id}`;

		const board = await ladeBoard(kA(), sicht(), { mitPreisen: false });
		const karte = (id: string) => board.spalten.flatMap((s) => s.karten).find((k) => k.id === id)!;
		expect(untergruppe(karte(neu))).toBe('neu');
		expect(untergruppe(karte(mitTermin))).toBe('termin');
		expect(untergruppe(karte(vorbei))).toBe('termin');
		expect(untergruppe(karte(ohneAngebot))).toBe('ohne_angebot');
		expect(untergruppe(karte(mitEntwurf))).toBe('ohne_angebot');
		expect(untergruppe(karte(mitAngebot))).toBe('mit_angebot');
		expect(karte(mitAngebot).status).toBe('angebot');
		// Liste liefert dieselben Felder
		const liste = await listeAuftraege(kA(), sicht(), {});
		expect(untergruppe(liste.find((a) => a.id === mitTermin)!)).toBe('termin');
		expect(untergruppe(liste.find((a) => a.id === neu)!)).toBe('neu');
	});
});
