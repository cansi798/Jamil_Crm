import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { ladeBoard } from '../../src/lib/server/auftrag-board';
import { listeAuftraege, setzeArbeitsstand, setzeStatus } from '../../src/lib/server/auftraege';
import { untergruppe } from '../../src/lib/auftrag-board';

/** Untergruppen in Anfrage, Angebot, Beauftragt und In Arbeit aus echten Daten (Jamil msgs 3601, 3655, 3658–3660). */
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

	it('Termin (auch vergangen) → „Termin vereinbart“; verschicktes Angebot → „Angebot erstellt“ (vorläufig), Entwurf nicht; Status bleibt', async () => {
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

	it('Beauftragt: kommende Montage/Wartung → „Umsetzung geplant“ (vorläufig); Besichtigung und vergangene Montage nicht', async () => {
		const ohne = await u.neuerAuftrag('beauftragt', 'UG B ohne');
		const besichtigung = await u.neuerAuftrag('beauftragt', 'UG B Besichtigung');
		const vorbei = await u.neuerAuftrag('beauftragt', 'UG B Montage vorbei');
		const montage = await u.neuerAuftrag('beauftragt', 'UG B Montage');
		const wartung = await u.neuerAuftrag('beauftragt', 'UG B Wartung');
		await root`insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, art) values
			(${u.betriebA}, ${besichtigung}, ${u.ids.monteurA}, now() + interval '1 day', now() + interval '1 day 1 hour', 'besichtigung'),
			(${u.betriebA}, ${vorbei}, ${u.ids.monteurA}, now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 'montage'),
			(${u.betriebA}, ${montage}, ${u.ids.monteurA}, now() + interval '7 days', now() + interval '7 days 6 hours', 'montage'),
			(${u.betriebA}, ${wartung}, ${u.ids.monteurA}, now() + interval '3 days', now() + interval '3 days 1 hour', 'wartung')`;

		const board = await ladeBoard(kA(), sicht(), { mitPreisen: false });
		const karte = (id: string) => board.spalten.flatMap((s) => s.karten).find((k) => k.id === id)!;
		expect(untergruppe(karte(ohne))).toBe('planung');
		expect(untergruppe(karte(besichtigung))).toBe('planung');
		expect(untergruppe(karte(vorbei))).toBe('planung');
		expect(untergruppe(karte(montage))).toBe('umsetzung');
		expect(untergruppe(karte(wartung))).toBe('umsetzung');
		expect(karte(montage).status).toBe('beauftragt');
		const liste = await listeAuftraege(kA(), sicht(), {});
		expect(untergruppe(liste.find((a) => a.id === montage)!)).toBe('umsetzung');
		expect(untergruppe(liste.find((a) => a.id === besichtigung)!)).toBe('planung');
	});

	it('In Arbeit: Arbeitsstand setzen, nur im Status „In Arbeit“, Statuswechsel setzt zurück', async () => {
		const id = await u.neuerAuftrag('in_arbeit', 'UG Arbeit');
		const gruppe = async () => untergruppe((await listeAuftraege(kA(), sicht(), {})).find((a) => a.id === id)!);
		expect(await gruppe()).toBe('arbeiten');
		expect((await setzeArbeitsstand(kA(), id, 'qualitaet')).arbeitsstand).toBe('qualitaet');
		expect(await gruppe()).toBe('qualitaet');
		await setzeArbeitsstand(kA(), id, 'abnahme');
		const board = await ladeBoard(kA(), sicht(), { mitPreisen: false });
		expect(untergruppe(board.spalten.flatMap((s) => s.karten).find((k) => k.id === id)!)).toBe('abnahme');
		// zurück auf den Anfang
		expect((await setzeArbeitsstand(kA(), id, 'arbeiten')).arbeitsstand).toBeNull();
		await expect(setzeArbeitsstand(kA(), id, 'fertig')).rejects.toMatchObject({ status: 400 });
		// Statuswechsel leert den Stand (Trigger), auch beim Zurückkommen
		await setzeArbeitsstand(kA(), id, 'abnahme');
		await setzeStatus(kA(), id, 'abgenommen');
		expect((await root`select arbeitsstand from app.auftraege where id = ${id}`)[0].arbeitsstand).toBeNull();
		await expect(setzeArbeitsstand(kA(), id, 'qualitaet')).rejects.toMatchObject({ status: 409 });
		await setzeStatus(kA(), id, 'in_arbeit');
		expect(await gruppe()).toBe('arbeiten');
		// anderer Betrieb sieht den Auftrag nicht
		await expect(setzeArbeitsstand({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, id, 'qualitaet', { alle: true, benutzerId: u.ids.chefB })).rejects.toMatchObject({ status: 404 });
	});
});
