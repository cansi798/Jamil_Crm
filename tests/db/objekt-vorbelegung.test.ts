import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliesseDb } from '../../src/lib/server/db';
import { load as neuLoad } from '../../src/routes/(app)/kunden/[id]/objekte/neu/+page.server';
import { baueUmgebung, type Umgebung } from './hilfe-1c';

/** Wunsch Jamil (msg 2479): Neues Objekt hat standardmäßig die Adresse des Kunden (änderbar). */
describe('Neues Objekt: Adresse des Kunden vorbelegt', () => {
	let u: Umgebung;
	beforeAll(async () => {
		u = await baueUmgebung();
	});
	afterAll(async () => {
		await schliesseDb();
		await u.root?.end();
	});

	it('Formular startet mit Straße, PLZ und Ort des Kunden', async () => {
		const d = (await neuLoad({ locals: { nutzer: u.chefA }, params: { id: u.kundeA } } as never)) as any;
		expect(d.vorbelegt).toEqual({ strasse: 'Lindenweg 3', plz: '22846', ort: 'Norderstedt' });
	});

	it('Kunde ohne Adresse → leere Felder', async () => {
		const [{ id }] = await u.root`insert into app.kunden (betrieb_id, art, nachname) values (${u.betriebA}, 'privat', 'Ohne Adresse') returning id`;
		const d = (await neuLoad({ locals: { nutzer: u.chefA }, params: { id } } as never)) as any;
		expect(d.vorbelegt).toEqual({ strasse: '', plz: '', ort: '' });
	});
});
