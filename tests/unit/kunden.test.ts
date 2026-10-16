import { describe, expect, it } from 'vitest';
import {
	anzeigeName,
	likeMuster,
	pruefeKundeEingabe,
	pruefeObjektEingabe,
	sucheWoerter
} from '../../src/lib/server/kunden';
import { verlaufZeile, type VerlaufEintrag } from '../../src/lib/verlauf';

describe('likeMuster', () => {
	it('maskiert %, _ und \\ und umschließt mit %', () => {
		expect(likeMuster('müller')).toBe('%müller%');
		expect(likeMuster('50%')).toBe('%50\\%%');
		expect(likeMuster('a_b')).toBe('%a\\_b%');
		expect(likeMuster('a\\b')).toBe('%a\\\\b%');
		expect(likeMuster('%_\\')).toBe('%\\%\\_\\\\%');
	});
});

describe('sucheWoerter', () => {
	it('zerlegt an Leerraum, trimmt, ignoriert Leeres, höchstens 5 Wörter', () => {
		expect(sucheWoerter('  Max   Müller ')).toEqual(['Max', 'Müller']);
		expect(sucheWoerter('')).toEqual([]);
		expect(sucheWoerter(null)).toEqual([]);
		expect(sucheWoerter('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e']);
	});
	it('zu lange Suchbegriffe → 400', () => {
		expect(() => sucheWoerter('x'.repeat(101))).toThrow(/zu lang/);
	});
});

describe('pruefeKundeEingabe', () => {
	it('Privatkunde braucht Nachnamen', () => {
		expect(() => pruefeKundeEingabe({ art: 'privat', vorname: 'Max' })).toThrow(/Nachname/);
		expect(() => pruefeKundeEingabe({ art: 'privat', nachname: '   ' })).toThrow(/Nachname/);
	});
	it('Firmenkunde braucht Firmennamen', () => {
		expect(() => pruefeKundeEingabe({ art: 'firma', nachname: 'Müller' })).toThrow(/Firmenname/);
	});
	it('art ist Pflicht und nur privat/firma', () => {
		expect(() => pruefeKundeEingabe({ nachname: 'x' })).toThrow(/Art/);
		expect(() => pruefeKundeEingabe({ art: 'verein', nachname: 'x' })).toThrow(/Art/);
	});
	it('trimmt, leere Strings werden null, PLZ bleibt Freitext', () => {
		const k = pruefeKundeEingabe({
			art: 'privat',
			vorname: '  Max ',
			nachname: ' Müller ',
			email: '',
			telefon: '  ',
			plz: 'CH-8001'
		});
		expect(k).toMatchObject({ vorname: 'Max', nachname: 'Müller', email: null, telefon: null, plz: 'CH-8001', firma: null });
	});
	it('Privatkunde: Firmenfeld wird ignoriert; Firma behält Ansprechpartner', () => {
		expect(pruefeKundeEingabe({ art: 'privat', nachname: 'M', firma: 'Egal GmbH' }).firma).toBeNull();
		expect(pruefeKundeEingabe({ art: 'firma', firma: 'Egal GmbH', nachname: 'M' })).toMatchObject({
			firma: 'Egal GmbH',
			nachname: 'M'
		});
	});
	it('Längengrenzen: Namen 200, Notiz 2000, Telefon 50, PLZ 20', () => {
		const basis = { art: 'privat', nachname: 'M' };
		expect(() => pruefeKundeEingabe({ ...basis, nachname: 'x'.repeat(201) })).toThrow(/höchstens 200/);
		expect(pruefeKundeEingabe({ ...basis, nachname: 'x'.repeat(200) }).nachname).toHaveLength(200);
		expect(() => pruefeKundeEingabe({ ...basis, notiz: 'x'.repeat(2001) })).toThrow(/höchstens 2000/);
		expect(pruefeKundeEingabe({ ...basis, notiz: 'x'.repeat(2000) }).notiz).toHaveLength(2000);
		expect(() => pruefeKundeEingabe({ ...basis, telefon: '1'.repeat(51) })).toThrow(/höchstens 50/);
		expect(() => pruefeKundeEingabe({ ...basis, plz: '1'.repeat(21) })).toThrow(/höchstens 20/);
	});
	it('E-Mail: leichte Formprüfung', () => {
		const basis = { art: 'privat', nachname: 'M' };
		expect(pruefeKundeEingabe({ ...basis, email: ' a@b.de ' }).email).toBe('a@b.de');
		for (const schlecht of ['a', 'a@b', '@b.de', 'a b@c.de', 'a@b@c.de', 'a@.de']) {
			expect(() => pruefeKundeEingabe({ ...basis, email: schlecht }), schlecht).toThrow(/E-Mail/);
		}
	});
	it('Nicht-Strings und NUL-Zeichen → 400', () => {
		expect(() => pruefeKundeEingabe({ art: 'privat', nachname: 42 })).toThrow(/Text/);
		expect(() => pruefeKundeEingabe({ art: 'privat', nachname: ['x'] })).toThrow(/Text/);
		expect(() => pruefeKundeEingabe({ art: 'privat', nachname: 'a\u0000b' })).toThrow(/Zeichen/);
	});
	it('Fehler tragen Status 400', () => {
		try {
			pruefeKundeEingabe({ art: 'privat' });
			throw new Error('sollte werfen');
		} catch (e) {
			expect(e).toMatchObject({ status: 400 });
		}
	});
});

describe('pruefeObjektEingabe', () => {
	it('Bezeichnung ist Pflicht, Grenzen wie bei Kunden', () => {
		expect(() => pruefeObjektEingabe({})).toThrow(/Bezeichnung/);
		expect(() => pruefeObjektEingabe({ bezeichnung: ' ' })).toThrow(/Bezeichnung/);
		expect(() => pruefeObjektEingabe({ bezeichnung: 'x'.repeat(201) })).toThrow(/höchstens 200/);
		expect(() => pruefeObjektEingabe({ bezeichnung: 'x', notiz: 'x'.repeat(2001) })).toThrow(/höchstens 2000/);
		expect(pruefeObjektEingabe({ bezeichnung: ' Haus ', ort: ' Wien ', plz: 'A-1010' })).toMatchObject({
			bezeichnung: 'Haus',
			ort: 'Wien',
			plz: 'A-1010',
			strasse: null
		});
	});
});

describe('anzeigeName', () => {
	it('Firma: Firmenname; Privat: Vor- und Nachname', () => {
		expect(anzeigeName({ art: 'firma', firma: 'Bau GmbH', vorname: null, nachname: null })).toBe('Bau GmbH');
		expect(anzeigeName({ art: 'privat', firma: null, vorname: 'Max', nachname: 'Müller' })).toBe('Max Müller');
		expect(anzeigeName({ art: 'privat', firma: null, vorname: null, nachname: 'Müller' })).toBe('Müller');
	});
});

describe('verlaufZeile', () => {
	const basis: VerlaufEintrag = {
		id: '1',
		zeit: '2026-10-15T10:30:00.000Z',
		aktion: 'angelegt',
		benutzerId: 'u',
		benutzerName: 'Chef',
		quelle: 'oberflaeche',
		vorher: null,
		nachher: { id: 'x', betrieb_id: 'b', nachname: 'Müller' }
	};
	it('angelegt', () => {
		const z = verlaufZeile(basis);
		expect(z.titel).toBe('Angelegt');
		expect(z.wer).toBe('Chef');
		expect(z.aenderungen).toEqual([]);
	});
	it('geändert: nur geänderte Felder mit deutschen Namen, interne Schlüssel ausgeblendet', () => {
		const z = verlaufZeile({
			...basis,
			aktion: 'geaendert',
			vorher: { id: 'x', betrieb_id: 'b', nachname: 'Müller', plz: null, email: 'a@b.de' },
			nachher: { id: 'x', betrieb_id: 'b', nachname: 'Meier', plz: '12345', email: 'a@b.de' }
		});
		expect(z.titel).toBe('Geändert');
		expect(z.aenderungen).toEqual([
			{ feld: 'Nachname', alt: 'Müller', neu: 'Meier' },
			{ feld: 'PLZ', alt: '–', neu: '12345' }
		]);
	});
	it('gelöscht und unbekannter Benutzer', () => {
		const z = verlaufZeile({ ...basis, aktion: 'geloescht', benutzerName: null, benutzerId: null, vorher: basis.nachher, nachher: null });
		expect(z.titel).toBe('Gelöscht');
		expect(z.wer).toBe('System');
	});
	it('Zeit wird in Berliner Zeit formatiert', () => {
		expect(verlaufZeile(basis).zeit).toBe('15.10.2026, 12:30');
	});
});
