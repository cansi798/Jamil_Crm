import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, type Umgebung } from './hilfe-1c';
import { legeAuftragAn, listeAuftraege, setzeStatus } from '../../src/lib/server/auftraege';
import { listeQuellen, speichereAblauf, speichereQuelle } from '../../src/lib/server/quellen';
import { ladeBoard } from '../../src/lib/server/auftrag-board';
import { schrittUebersprungen, untergruppe } from '../../src/lib/auftrag-board';

/** Ablauf je Auftragsquelle (Jamil msg 3703, Migration 112): speichern, Protokoll, Start, Statusschritte, Anzeige. */
describe('Ablauf je Auftragsquelle', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const kB = () => ({ betriebId: u.betriebB, benutzerId: u.ids.chefB });
	const sicht = () => ({ alle: true, benutzerId: u.ids.chefA });
	let partner: string;
	let normal: string;

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await speichereQuelle(kA(), null, { name: 'Ablauf Partner' });
		await speichereQuelle(kA(), null, { name: 'Ablauf Direkt' });
		const qs = await listeQuellen(kA());
		partner = qs.find((q) => q.name === 'Ablauf Partner')!.id;
		normal = qs.find((q) => q.name === 'Ablauf Direkt')!.id;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Standard: alles gilt; neue Quelle ohne übersprungene Schritte', async () => {
		const qs = await listeQuellen(kA());
		expect(qs.every((q) => q.uebersprungen.length === 0)).toBe(true);
		const a = await legeAuftragAn(kA(), { titel: 'AB Standard', kundeId: u.kundeA, quelleId: normal });
		expect(a.status).toBe('anfrage');
		expect(a.quelleUebersprungen).toEqual([]);
	});

	it('speichern: nur bekannte Schritte, nur eigene Quellen, sauber sortiert, im Änderungsprotokoll', async () => {
		await expect(speichereAblauf(kA(), { [partner]: ['quatsch'] })).rejects.toMatchObject({ status: 400 });
		await expect(speichereAblauf(kB(), { [partner]: ['neu'] })).rejects.toMatchObject({ status: 404 });
		await speichereAblauf(kA(), { [partner]: ['ohne_angebot', 'neu', 'neu'] });
		const [q] = await root`select uebersprungen from app.auftrag_quellen where id = ${partner}`;
		expect(q.uebersprungen).toEqual(['neu', 'ohne_angebot']);
		const [p] = await root`select nachher from app.aenderungen where tabelle = 'auftrag_quellen' and datensatz_id = ${partner} order by id desc limit 1`;
		expect(p.nachher.uebersprungen).toEqual(['neu', 'ohne_angebot']);
		// Datenbank lässt nur bekannte Schritte zu
		await expect(root`update app.auftrag_quellen set uebersprungen = '{erfunden}' where id = ${partner}`).rejects.toThrow();
	});

	it('neuer Auftrag beginnt im ersten geltenden Status; bestehende bleiben, wo sie sind', async () => {
		const vorher = await legeAuftragAn(kA(), { titel: 'AB vorher', kundeId: u.kundeA, quelleId: normal });
		const a = await legeAuftragAn(kA(), { titel: 'AB Partner', kundeId: u.kundeA, quelleId: partner });
		expect(a.status).toBe('beauftragt');
		expect((await root`select status from app.auftraege where id = ${vorher.id}`)[0].status).toBe('anfrage');
	});

	it('Schritt vor/zurück lässt übersprungene Status aus; der Sprung (Statusleiste) darf jeden setzen', async () => {
		await speichereAblauf(kA(), { [partner]: ['ohne_angebot'] });
		const a = await legeAuftragAn(kA(), { titel: 'AB Schritte', kundeId: u.kundeA, quelleId: partner });
		expect(a.status).toBe('anfrage');
		// Nachbar „Angebot“ ist übersprungen → landet in „Beauftragt“
		expect((await setzeStatus(kA(), a.id, 'angebot')).status).toBe('beauftragt');
		expect((await setzeStatus(kA(), a.id, 'anfrage')).status).toBe('anfrage');
		expect((await setzeStatus(kA(), a.id, 'beauftragt')).status).toBe('beauftragt');
		await expect(setzeStatus(kA(), a.id, 'abgenommen')).rejects.toMatchObject({ status: 409 });
		// ausdrücklicher Sprung auf den übersprungenen Status bleibt möglich
		const b = await setzeStatus(kA(), a.id, 'angebot', sicht(), { sprung: true });
		expect(b.status).toBe('angebot');
		// Board/Liste: kein geltender Schritt → „Schritt übersprungen“
		const board = await ladeBoard(kA(), sicht(), { mitPreisen: false });
		const karte = board.spalten.flatMap((s) => s.karten).find((k) => k.id === a.id)!;
		expect(karte.quelleUebersprungen).toEqual(['ohne_angebot']);
		expect(untergruppe(karte)).toBeNull();
		expect(schrittUebersprungen(karte)).toBe(true);
		const liste = await listeAuftraege(kA(), sicht(), {});
		expect(schrittUebersprungen(liste.find((x) => x.id === a.id)!)).toBe(true);
	});

	it('zurück auf Standard: alles gilt wieder', async () => {
		await speichereAblauf(kA(), { [partner]: [] });
		expect((await listeQuellen(kA())).find((q) => q.id === partner)!.uebersprungen).toEqual([]);
		expect((await legeAuftragAn(kA(), { titel: 'AB wieder normal', kundeId: u.kundeA, quelleId: partner })).status).toBe('anfrage');
	});
});
