import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, nutzerVon, testPng, type Umgebung } from './hilfe-1c';
import { istNachtragen, ladeHistorie, ladeSchaetzung, schaetze, uebernimm, verwirf } from '../../src/lib/server/foto-aufmass';
import { setzeKiAnbieter } from '../../src/lib/server/ki/anbieter';
import { FakeKi } from '../../src/lib/server/ki/fake';

/** Foto-Aufmaß (Jamil msgs 2770–2774 Punkt 8, 2780): Schätzung, Datensparsamkeit, Übernahme, Lernen, Rechte. */
describe('Foto-Aufmaß', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	let ki: FakeKi;
	let katalogId: string;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });
	const sichtA = () => ({ alle: true, benutzerId: u.ids.chefA });
	const eingaben = { raumart: 'bad', wandM2: '20', bodenM2: '4', hoeheM: '2,5', dusche: '1', wc: '1', waschtisch: '1' };

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		const [kp] = await root`insert into app.katalog_positionen (betrieb_id, gewerk, bezeichnung, einheit, lohn_cent, material_cent)
			values (${u.betriebA}, 'fliesen', 'Abdichtung Verbundabdichtung', 'm²', 2500, 800) returning id`;
		katalogId = kp.id;
		ki = new FakeKi();
		setzeKiAnbieter(ki);
	});
	afterAll(async () => {
		setzeKiAnbieter(null);
		await schliesseDb();
		await root?.end();
	});

	it('Rechte: wie der KI-Angebotsentwurf; Monteur 403, Betrieb ohne Modul 402/403', async () => {
		await expect(schaetze({ nutzer: u.monteurA }, u.auftragA, eingaben, [], false)).rejects.toMatchObject({ status: 403 });
		await expect(schaetze({ nutzer: u.ohnePreiseA }, u.auftragA, eingaben, [], false)).rejects.toMatchObject({ status: 403 });
	});

	it('Schätzung: Fotos nur mit Zustimmung; an die KI gehen nur Fotos, Zahlen und Katalog ohne Preise', async () => {
		const foto = testPng(8, 8);
		await expect(schaetze({ nutzer: u.chefA }, u.auftragA, eingaben, [foto], false)).rejects.toMatchObject({ status: 400 });
		await expect(schaetze({ nutzer: u.chefA }, u.auftragA, { ...eingaben, wandM2: '' }, [], false)).rejects.toMatchObject({ status: 400 });
		await expect(schaetze({ nutzer: u.chefA }, u.auftragA, eingaben, [foto, foto, foto, foto, foto], true)).rejects.toMatchObject({ status: 400 });
		const id = await schaetze({ nutzer: u.chefA }, u.auftragA, eingaben, [foto], true);
		const a = ki.letzteBildAnfrage!;
		expect(a.bilder).toHaveLength(1);
		const gesendet = a.system + a.text;
		expect(gesendet).not.toMatch(/Müller|Lindenweg|Norderstedt|Badsanierung|2500|25,00|800/);
		expect(gesendet).toContain('K1 | Abdichtung Verbundabdichtung | m²');
		expect(gesendet).toMatch(/schätze sie NICHT neu/);
		const s = await ladeSchaetzung(kA(), sichtA(), id, u.auftragA);
		expect(s).toMatchObject({ status: 'entwurf', basisN: 0, konfidenz: 0.55, fotos: 1 });
		expect(s.mengen.find((m) => m.schluessel === 'silikon_lfm')).toMatchObject({ ki: 16, vorschlag: 16, faktor: null });
		expect(s.positionen).toEqual([expect.objectContaining({ katalogPositionId: katalogId, ki: 6, vorschlag: 6 })]);
		// keine Fotos und keine Kundendaten gespeichert
		const [roh] = await root`select eingaben::text as e, ki::text as k from app.aufmass_schaetzungen where id = ${id}`;
		expect(roh.e + roh.k).not.toMatch(/Müller|Lindenweg|base64|PNG/);
	});

	it('Übernehmen → Angebotsentwurf mit „Schätzung – vor Ort prüfen“; danach lernt die nächste Schätzung (Faktor, Beispiel)', async () => {
		for (const silikon of ['20', '24']) {
			const id = await schaetze({ nutzer: u.chefA }, u.auftragA, eingaben, [], false);
			const angebotId = await uebernimm({ nutzer: u.chefA }, u.auftragA, id, {
				mengen: { silikon_lfm: silikon, fliesenkleber_kg: '120' },
				positionen: [{ katalogPositionId: katalogId, menge: '9', nehmen: true }]
			});
			expect(angebotId).toBeTruthy();
			const [p] = await root`select menge, beschreibung from app.angebot_positionen where angebot_id = ${angebotId}`;
			expect(Number(p.menge)).toBe(9);
			expect(p.beschreibung).toMatch(/Schätzung – vor Ort prüfen/);
			await expect(uebernimm({ nutzer: u.chefA }, u.auftragA, id, { mengen: {}, positionen: [] })).rejects.toMatchObject({ status: 409 });
		}
		const h = await ladeHistorie(kA(), 'bad');
		expect(h).toHaveLength(2);
		const id3 = await schaetze({ nutzer: u.chefA }, u.auftragA, eingaben, [], false);
		expect(ki.letzteBildAnfrage!.system).toMatch(/Frühere Aufträge dieses Betriebs/);
		expect(ki.letzteBildAnfrage!.system).toMatch(/silikon_lfm=2[04]/);
		const s3 = await ladeSchaetzung(kA(), sichtA(), id3, u.auftragA);
		expect(s3.basisN).toBe(2);
		// KI 16 → übernommen 20 und 24 → Faktor 1,375 (Median 1,25/1,5) → 22,1 (Faktor gerundet 1,38)
		expect(s3.mengen.find((m) => m.schluessel === 'silikon_lfm')).toMatchObject({ ki: 16, vorschlag: 22.1, faktor: { faktor: 1.38, n: 2 } });
		expect(s3.positionen[0]).toMatchObject({ vorschlag: 9, faktor: { faktor: 1.5, n: 2 } });
		await verwirf({ nutzer: u.chefA }, u.auftragA, id3);
		expect((await ladeSchaetzung(kA(), sichtA(), id3, u.auftragA)).status).toBe('verworfen');
	});

	it('Ist-Verbrauch nach Abnahme aus dem Material; Ist schlägt den übernommenen Wert beim Lernen', async () => {
		await root`insert into app.auftrag_material (betrieb_id, auftrag_id, bezeichnung, einheit, menge, quelle) values (${u.betriebA}, ${u.auftragA}, 'Fliesenkleber flex 25 kg', 'Sack', 4, 'zusatz')`;
		await root`update app.auftraege set status = 'abgenommen' where id = ${u.auftragA}`;
		expect(await istNachtragen(kA())).toBe(2);
		const h = await ladeHistorie(kA(), 'bad');
		expect(h.every((x) => x.ist?.fliesenkleber_kg === 100)).toBe(true);
	});

	it('Sicherheit: nur eigene Aufträge → fremde Schätzung nicht laden, übernehmen oder verwerfen (404)', async () => {
		const fremd = await u.neuerAuftrag('anfrage', 'Fremd');
		const id = await schaetze({ nutzer: u.chefA }, fremd, eingaben, [], false);
		const nurEigene = nutzerVon(u.ids.monteurA, u.betriebA, ['kunden.lesen', 'auftraege.lesen', 'angebote.bearbeiten', 'preise.sehen']);
		await expect(verwirf({ nutzer: nurEigene }, fremd, id)).rejects.toMatchObject({ status: 404 });
		await expect(uebernimm({ nutzer: nurEigene }, fremd, id, { mengen: {}, positionen: [] })).rejects.toMatchObject({ status: 404 });
		await expect(ladeSchaetzung({ betriebId: u.betriebA, benutzerId: u.ids.monteurA }, { alle: false, benutzerId: u.ids.monteurA }, id, fremd)).rejects.toMatchObject({ status: 404 });
		await expect(schaetze({ nutzer: nurEigene }, fremd, eingaben, [], false)).rejects.toMatchObject({ status: 404 });
		// anderer Betrieb: nichts
		await expect(ladeSchaetzung({ betriebId: u.betriebB, benutzerId: u.ids.chefB }, { alle: true, benutzerId: u.ids.chefB }, id, fremd)).rejects.toMatchObject({ status: 404 });
	});
});
