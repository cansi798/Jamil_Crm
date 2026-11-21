import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { aendereKunde, holeKunde, legeKundeAn } from '../../src/lib/server/kunden';
import { legeAuftragAn, uebernimmEinmalKunde } from '../../src/lib/server/auftraege';
import { legeAngebotAn, ladePdfDaten, speichereAngebot } from '../../src/lib/server/angebote';
import { belegEingabe } from '../../src/lib/server/lexware/angebote';
import { angebotZuLexwareQuotation } from '../../src/lib/server/lexware/format';
import { kontaktAusKunde } from '../../src/lib/server/lexware/kontakte';
import { actions as neuAktionen } from '../../src/routes/(app)/kunden/neu/+page.server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Migration 125 (Can #6739): Land, USt-IdNr., Steuernummer am Kunden; Land am Einmal-Kunden; Weg bis ins Lexware-Format. */
describe('Kunden: Land, USt-IdNr., Steuernummer', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
	});
	afterAll(async () => {
		await schliesseDb();
		await root?.end();
	});

	it('Bestand: Land Standard DE; Firma mit USt-IdNr. (normalisiert) und Steuernummer; Privat ohne Steuerdaten', async () => {
		expect((await holeKunde(kA(), u.kundeA)).land).toBe('DE');
		const f = await legeKundeAn(kA(), { art: 'firma', firma: 'Bau AG', land: 'AT', ust_id: 'atu 1234 5678', steuernummer: '12/345/67890', plz: '1010', ort: 'Wien' });
		expect(f).toMatchObject({ land: 'AT', ust_id: 'ATU12345678', steuernummer: '12/345/67890' });
		const p = await legeKundeAn(kA(), { art: 'privat', nachname: 'Huber', ust_id: 'DE123456789', steuernummer: '12/345/67890' });
		expect(p).toMatchObject({ land: 'DE', ust_id: null, steuernummer: null });
		// teilweise ändern lässt die Steuerdaten stehen
		expect(await aendereKunde(kA(), f.id, { ort: 'Graz' })).toMatchObject({ ort: 'Graz', ust_id: 'ATU12345678', land: 'AT' });
		expect(await aendereKunde(kA(), f.id, { ust_id: '' })).toMatchObject({ ust_id: null });
	});

	it('Prüfung: falsche USt-IdNr., Steuernummer, unbekanntes Land → 400; Datenbank lehnt kaputte Werte ab', async () => {
		const anlegen = async (e: Record<string, unknown>) => legeKundeAn(kA(), e);
		await expect(anlegen({ art: 'firma', firma: 'X', ust_id: 'DE12345' })).rejects.toMatchObject({ status: 400 });
		await expect(anlegen({ art: 'firma', firma: 'X', steuernummer: 'abc' })).rejects.toMatchObject({ status: 400 });
		await expect(anlegen({ art: 'firma', firma: 'X', land: 'XX' })).rejects.toMatchObject({ status: 400 });
		await expect(root`update app.kunden set land = 'de' where id = ${u.kundeA}`).rejects.toThrow(/kunden_land/);
		await expect(root`update app.kunden set ust_id = '1234' where id = ${u.kundeA}`).rejects.toThrow(/kunden_ust_id/);
	});

	it('Formular „Kunde anlegen“ nimmt Land und Steuerdaten an; Fehler bleibt im Formular', async () => {
		const form = (felder: Record<string, string>) => {
			const fd = new FormData();
			for (const [k, v] of Object.entries(felder)) fd.set(k, v);
			return { locals: { nutzer: u.chefA }, request: new Request('http://localhost/kunden/neu', { method: 'POST', body: fd }) } as never;
		};
		const falsch = (await neuAktionen.anlegen(form({ art: 'firma', firma: 'Form GmbH', land: 'DE', ust_id: 'DE1' }))) as any;
		expect(falsch.status).toBe(400);
		expect(falsch.data.fehler).toMatch(/USt-IdNr/);
		await expect(neuAktionen.anlegen(form({ art: 'firma', firma: 'Form GmbH', land: 'CH', ust_id: 'CHE-123.456.789 MWST' }))).rejects.toMatchObject({ status: 303 });
		expect((await root`select land, ust_id from app.kunden where firma = 'Form GmbH'`)[0]).toEqual({ land: 'CH', ust_id: 'CHE-123.456.789MWST' });
	});

	it('Einmal-Kunde mit Land: am Auftrag, im Angebot (Lexware-Adresse) und beim Übernehmen als Kunde', async () => {
		const a = await legeAuftragAn(kA(), { titel: 'Ferienhaus', kundeArt: 'einmal', einmalName: 'Frau Gruber', einmalPlz: '6020', einmalOrt: 'Innsbruck', einmalLand: 'AT' });
		expect(a.einmalKunde).toMatchObject({ land: 'AT' });
		const an = await legeAngebotAn(kA(), a.id);
		await speichereAngebot(kA(), an.id, { positionen: [{ bezeichnung: 'Fliesen', menge: '2', einheit: 'm²', einzelpreis: '50,00' }] });
		expect((await ladePdfDaten(kA(), an.id)).kunde).toMatchObject({ land: 'AT', plz: '6020' });
		const q = angebotZuLexwareQuotation(await belegEingabe(kA(), an.id));
		expect(q.body.address).toMatchObject({ name: 'Frau Gruber', zip: '6020', city: 'Innsbruck', countryCode: 'AT' });
		const neu = await uebernimmEinmalKunde(kA(), a.id);
		expect((await holeKunde(kA(), neu.kundeId!)).land).toBe('AT');
		// Deutschland wird als „keine Angabe“ gespeichert
		const d = await legeAuftragAn(kA(), { titel: 'Kiel', kundeArt: 'einmal', einmalName: 'Herr Kiel', einmalLand: 'DE' });
		expect(d.einmalKunde?.land).toBeNull();
		await expect(legeAuftragAn(kA(), { titel: 'x', kundeArt: 'einmal', einmalName: 'Y', einmalLand: 'ZZ' })).rejects.toMatchObject({ status: 400 });
	});

	it('§ 13b: USt-IdNr. fehlt → Fehler im Lexware-Format; Kontakt bekommt USt-IdNr. und Land', async () => {
		const f = await legeKundeAn(kA(), { art: 'firma', firma: 'Dach GmbH', plz: '24103', ort: 'Kiel' });
		await root`update app.kunden set bauleister_13b = true, bescheinigung_13b_bis = '2099-12-31' where id = ${f.id}`;
		const a = await legeAuftragAn(kA(), { titel: 'Dach', kundeArt: 'kunde', kundeId: f.id });
		const an = await legeAngebotAn(kA(), a.id);
		await speichereAngebot(kA(), an.id, { positionen: [{ bezeichnung: 'Dach', menge: '1', einheit: 'psch', einzelpreis: '1000,00' }] });
		const ohne = angebotZuLexwareQuotation(await belegEingabe(kA(), an.id));
		expect(ohne.fehler.join(' ')).toMatch(/USt-IdNr\./);
		await aendereKunde(kA(), f.id, { ust_id: 'DE123456789' });
		const e = await belegEingabe(kA(), an.id);
		expect(e.kunde.ustId).toBe('DE123456789');
		const k = kontaktAusKunde({ ...(await holeKunde(kA(), f.id)), ustId: 'DE123456789', steuernummer: null } as never);
		expect(k).toMatchObject({ company: { name: 'Dach GmbH', vatRegistrationId: 'DE123456789' }, addresses: { billing: [{ countryCode: 'DE' }] } });
	});
});
