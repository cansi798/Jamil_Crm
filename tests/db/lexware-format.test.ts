import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { baueUmgebung, leereAngebote, antwort, UNBEKANNT, type Umgebung } from './hilfe-1c';
import { legeAngebotAn, speichereAngebot } from '../../src/lib/server/angebote';
import { GET as angebotJson } from '../../src/routes/api/angebote/[id]/lexware-json/+server';

/** „Lexware-JSON herunterladen“ (docs/lexware-format.md): Paket aus echten CRM-Daten, ohne Verbindung, nur mit Preis-Recht. */
describe('Lexware-Format: Export je Angebot', () => {
	let u: Umgebung;
	let root: postgres.Sql;
	const kA = () => ({ betriebId: u.betriebA, benutzerId: u.ids.chefA });

	beforeAll(async () => {
		u = await baueUmgebung();
		root = u.root;
		await leereAngebote(root);
		await root`update app.kunden set plz = 'A-1010', ort = 'Wien', strasse = 'Ring 1', email = 'kunde@a.test' where id = ${u.kundeA}`;
	});
	afterAll(async () => {
		await leereAngebote(root);
		await schliesseDb();
		await root?.end();
	});

	const holen = async (nutzer: Umgebung['chefA'], id: string) => antwort(await angebotJson({ locals: { nutzer }, params: { id } } as never));

	it('Chef: Paket mit Kontakt (noch nicht in Lexware) und gültigem Angebot; Summen in Cent', async () => {
		const an = await legeAngebotAn(kA(), u.auftragA);
		await speichereAngebot(kA(), an.id, {
			positionen: [
				{ bezeichnung: 'Ständerwand einfach beplankt', menge: '24', einheit: 'm²', einzelpreis: '48,00' },
				{ bezeichnung: 'Spachteln Q2', menge: '42', einheit: 'm²', einzelpreis: '9,50' }
			]
		});
		const r = await holen(u.chefA, an.id);
		expect(r.status).toBe(200);
		const p = r.koerper;
		expect(p.format).toBe('lexware-office-v1');
		expect(p.quelle).toMatchObject({ art: 'angebot', id: an.id });
		expect(p.kontakt.pfad).toBe('/v1/contacts');
		expect(p.kontakt.fehler).toEqual([]);
		expect(p.kontakt.body.addresses.billing[0]).toMatchObject({ zip: '1010', city: 'Wien', countryCode: 'AT' });
		expect(p.beleg.pfad).toBe('/v1/quotations');
		expect(p.beleg.fehler).toEqual([]);
		expect(p.beleg.body.address.countryCode).toBe('AT');
		expect(p.beleg.body.lineItems.map((x: any) => x.unitPrice.netAmount)).toEqual([48, 9.5]);
		// 1.152,00 + 399,00 = 1.551,00 € netto → 294,69 € MwSt → 1.845,69 € brutto
		expect(p.beleg.erwartet).toMatchObject({ nettoCent: 155100, steuerCent: 29469, bruttoCent: 184569 });
		// keine Geheimnisse im Paket
		expect(JSON.stringify(p)).not.toMatch(/schluessel|Bearer|apiKey/i);
	});

	it('ohne „Preise sehen“ 403, fremder Betrieb / unbekannt 404', async () => {
		const an = await legeAngebotAn(kA(), u.auftragA);
		expect((await holen(u.ohnePreiseA, an.id)).status).toBe(403);
		expect((await holen(u.chefB, an.id)).status).toBe(404);
		expect((await holen(u.chefA, UNBEKANNT)).status).toBe(404);
	});
});
