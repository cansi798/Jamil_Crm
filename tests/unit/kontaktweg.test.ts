import { describe, expect, it } from 'vitest';
import { istKontaktweg, KONTAKTWEG_NAMEN, KONTAKTWEG_OPTIONEN, KONTAKTWEGE, kontaktwegFilter } from '../../src/lib/kontaktweg';
import { pruefeKundeEingabe, KUNDE_FELDER } from '../../src/lib/server/kunden';
import { verlaufZeile, type VerlaufEintrag } from '../../src/lib/verlauf';

/** Bevorzugter Kommunikationsweg am Kunden (Jamil, Talk msgs 4289/4291): E-Mail, Chat oder Telefon – leer = keine Angabe. */
describe('Kontaktweg', () => {
	it('genau drei Wege mit deutschen Namen', () => {
		expect(KONTAKTWEGE).toEqual(['email', 'chat', 'telefon']);
		expect(KONTAKTWEG_NAMEN).toEqual({ email: 'E-Mail', chat: 'Chat', telefon: 'Telefon' });
	});
	it('Auswahl im Formular: „Keine Angabe“ zuerst, dann die drei Wege', () => {
		expect(KONTAKTWEG_OPTIONEN.map((o) => o.wert)).toEqual(['', 'email', 'chat', 'telefon']);
		expect(KONTAKTWEG_OPTIONEN[0].text).toBe('Keine Angabe');
	});
	it('istKontaktweg erkennt nur die drei Werte', () => {
		expect(istKontaktweg('chat')).toBe(true);
		expect(istKontaktweg('Chat')).toBe(false);
		expect(istKontaktweg('fax')).toBe(false);
		expect(istKontaktweg(null)).toBe(false);
	});
	it('Filter der Kundenliste: drei Wege oder „ohne“, alles andere = kein Filter', () => {
		expect(kontaktwegFilter('telefon')).toBe('telefon');
		expect(kontaktwegFilter('ohne')).toBe('ohne');
		expect(kontaktwegFilter('fax')).toBeNull();
		expect(kontaktwegFilter(null)).toBeNull();
	});
});

describe('pruefeKundeEingabe: bevorzugter_kontakt', () => {
	it('gehört zu den Formularfeldern des Kunden', () => {
		expect(KUNDE_FELDER).toContain('bevorzugter_kontakt');
	});
	it('fehlt oder leer → null (keine Angabe)', () => {
		expect(pruefeKundeEingabe({ art: 'privat', nachname: 'M' }).bevorzugter_kontakt).toBeNull();
		expect(pruefeKundeEingabe({ art: 'privat', nachname: 'M', bevorzugter_kontakt: '' }).bevorzugter_kontakt).toBeNull();
		expect(pruefeKundeEingabe({ art: 'privat', nachname: 'M', bevorzugter_kontakt: null }).bevorzugter_kontakt).toBeNull();
	});
	it('E-Mail, Chat, Telefon werden übernommen', () => {
		for (const w of ['email', 'chat', 'telefon']) {
			expect(pruefeKundeEingabe({ art: 'firma', firma: 'X GmbH', bevorzugter_kontakt: w }).bevorzugter_kontakt).toBe(w);
		}
	});
	it('andere Werte → 400 mit verständlicher Meldung', () => {
		for (const w of ['fax', 'EMAIL', 42, ['chat'], { a: 1 }]) {
			try {
				pruefeKundeEingabe({ art: 'privat', nachname: 'M', bevorzugter_kontakt: w });
				expect.unreachable();
			} catch (e) {
				expect((e as { status: number }).status).toBe(400);
				expect((e as Error).message).toMatch(/Kontaktweg/);
			}
		}
	});
});

describe('Änderungsprotokoll: bevorzugter Kontaktweg', () => {
	it('zeigt deutschen Feldnamen und Werte', () => {
		const e: VerlaufEintrag = {
			id: '1',
			zeit: '2026-11-02T10:30:00.000Z',
			aktion: 'geaendert',
			benutzerId: 'u',
			benutzerName: 'Chef',
			quelle: 'oberflaeche',
			vorher: { nachname: 'M', bevorzugter_kontakt: null },
			nachher: { nachname: 'M', bevorzugter_kontakt: 'chat' }
		};
		expect(verlaufZeile(e).aenderungen).toEqual([{ feld: 'Bevorzugter Kontaktweg', alt: '–', neu: 'Chat' }]);
	});
});
