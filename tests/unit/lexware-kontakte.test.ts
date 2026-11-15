import { describe, expect, it } from 'vitest';
import { kontaktAusKunde, markeFuer, passtZuKunde } from '../../src/lib/server/lexware/kontakte';

const ID = '3f2b0c4e-8a51-4c1d-9b77-0a1b2c3d4e5f';

describe('Kunde → Lexware-Kontakt (Felder laut developers.lexware.io „Contacts“)', () => {
	it('Privatkunde → person, Kundenrolle, Rechnungsadresse DE, private Mail/Telefon, Marke in note', () => {
		expect(
			kontaktAusKunde({ id: ID, art: 'privat', firma: null, anrede: 'Frau', vorname: 'Inge', nachname: 'Musterfrau', email: 'inge@beispiel.test', telefon: '040 123', strasse: 'Lindenweg 3', plz: '22846', ort: 'Norderstedt' })
		).toEqual({
			version: 0,
			roles: { customer: {} },
			person: { salutation: 'Frau', firstName: 'Inge', lastName: 'Musterfrau' },
			addresses: { billing: [{ street: 'Lindenweg 3', zip: '22846', city: 'Norderstedt', countryCode: 'DE' }] },
			emailAddresses: { private: ['inge@beispiel.test'] },
			phoneNumbers: { private: ['040 123'] },
			note: `CRM-Kunde ${ID}`
		});
	});

	it('Firmenkunde → company mit Ansprechpartner; leere Felder fehlen ganz; version für PUT', () => {
		const k = kontaktAusKunde({ id: ID, art: 'firma', firma: 'Bau-Meier GmbH', anrede: null, vorname: 'Max', nachname: 'Meier', email: 'info@bau-meier.test', telefon: null, strasse: null, plz: null, ort: null }, 4);
		expect(k).toEqual({
			version: 4,
			roles: { customer: {} },
			company: { name: 'Bau-Meier GmbH', contactPersons: [{ firstName: 'Max', lastName: 'Meier', primary: true, emailAddress: 'info@bau-meier.test' }] },
			emailAddresses: { business: ['info@bau-meier.test'] },
			note: `CRM-Kunde ${ID}`
		});
		expect(kontaktAusKunde({ id: ID, art: 'firma', firma: 'X GmbH', anrede: null, vorname: null, nachname: null, email: null, telefon: null, strasse: null, plz: null, ort: null }).company).toEqual({ name: 'X GmbH' });
	});

	it('Zuordnung: Marke in note gewinnt, sonst eindeutige E-Mail', () => {
		expect(markeFuer(ID)).toBe(`CRM-Kunde ${ID}`);
		expect(passtZuKunde({ note: `Notiz\nCRM-Kunde ${ID}` }, { id: ID, email: null })).toBe('marke');
		expect(passtZuKunde({ emailAddresses: { private: ['INGE@beispiel.test'] } }, { id: ID, email: 'inge@beispiel.test' })).toBe('email');
		expect(passtZuKunde({ emailAddresses: { private: ['x@y.test'] } }, { id: ID, email: 'inge@beispiel.test' })).toBeNull();
	});
});
