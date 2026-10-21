import { describe, expect, it } from 'vitest';
import {
	BEISPIELE_ALLE,
	briefAnrede,
	MAIL_ZWECKE,
	PLATZHALTER_JE_ZWECK,
	PLATZHALTER_TEXTE,
	platzhalterIn,
	STANDARD_MAIL_VORLAGEN,
	unbekanntePlatzhalter
} from '../../src/lib/mail-vorlagen';
import { fertigeMail } from '../../src/lib/nachfassen';
import { pruefeVorlage } from '../../src/lib/server/mail-vorlagen';

describe('E-Mail-Vorlagen (Jamil msg 2789) – Platzhalter', () => {
	it('findet Platzhalter (Leerzeichen, Groß-/Kleinschreibung, doppelt)', () => {
		expect(platzhalterIn('{{kunde.name}} {{ Kunde.Name }} {{betrag}} {{}} {{x y}}')).toEqual(['kunde.name', 'betrag', '', 'x y']);
	});

	it('meldet Platzhalter, die es für den Zweck nicht gibt', () => {
		expect(unbekanntePlatzhalter(['{{kunde.anrede}} {{termin}}', '{{portal.link}}', null], 'buchungsbestaetigung')).toEqual(['portal.link']);
		expect(unbekanntePlatzhalter(['{{kunde.nmae}}'], 'allgemein')).toEqual(['kunde.nmae']);
		expect(unbekanntePlatzhalter(['{{ab.nummer}}'], 'auftragsbestaetigung')).toEqual([]);
	});

	it('jeder erlaubte Platzhalter ist beschrieben und hat einen Beispielwert (außer signatur)', () => {
		for (const z of MAIL_ZWECKE) {
			for (const p of PLATZHALTER_JE_ZWECK[z]) {
				expect(PLATZHALTER_TEXTE[p], p).toBeTruthy();
				if (p !== 'signatur') expect(BEISPIELE_ALLE[p], p).toBeTruthy();
			}
		}
	});

	it('die eingebauten Standard-Vorlagen benutzen nur bekannte Platzhalter und werden vollständig gefüllt', () => {
		for (const z of MAIL_ZWECKE) {
			const v = STANDARD_MAIL_VORLAGEN[z];
			expect(unbekanntePlatzhalter([v.betreff, v.html], z), z).toEqual([]);
			const m = fertigeMail({ ...v, text: null }, BEISPIELE_ALLE, '<p>Muster GmbH</p>');
			expect(`${m.betreff} ${m.html} ${m.text}`, z).not.toContain('{{');
			expect(m.html, z).toContain('Muster GmbH');
		}
	});

	it('Werte werden im HTML maskiert (auch in Link-Attributen)', () => {
		const m = fertigeMail({ betreff: 'x', html: '<a href="{{portal.link}}">{{kunde.name}}</a>', text: null }, { 'portal.link': 'https://a.de/?q="><script>', 'kunde.name': '<b>Ali</b>' }, null);
		expect(m.html).toBe('<a href="https://a.de/?q=&quot;&gt;&lt;script&gt;">&lt;b&gt;Ali&lt;/b&gt;</a>');
	});

	it('Briefanrede', () => {
		expect(briefAnrede({ art: 'firma' })).toBe('Sehr geehrte Damen und Herren');
		expect(briefAnrede({ anrede: 'Frau', nachname: 'Yılmaz' })).toBe('Sehr geehrte Frau Yılmaz');
		expect(briefAnrede({ vorname: 'Murat', nachname: 'K.' })).toBe('Guten Tag Murat K.');
		expect(briefAnrede({ einmalName: 'Familie Kaya' })).toBe('Guten Tag Familie Kaya');
		expect(briefAnrede({})).toBe('Guten Tag');
	});
});

describe('E-Mail-Vorlagen – Eingaben prüfen', () => {
	const gut = { name: 'Test', betreff: 'Hallo {{kunde.name}}', html: '<p>{{kunde.anrede}} {{termin}}</p>' };
	it('Zweck: leer = allgemein, unbekannt = 400; unbekannte Platzhalter kommen als Hinweis zurück', () => {
		expect(pruefeVorlage(gut)).toMatchObject({ zweck: 'allgemein', mitSignatur: true, unbekannt: ['termin'] });
		expect(pruefeVorlage({ ...gut, zweck: 'buchungsbestaetigung' }).unbekannt).toEqual([]);
		expect(() => pruefeVorlage({ ...gut, zweck: 'spam' })).toThrow(/Zweck/);
	});
	it('Signatur: Formular ohne Häkchen = aus, API ohne Feld = an', () => {
		expect(pruefeVorlage({ ...gut, mitSignatur: '' }).mitSignatur).toBe(false);
		expect(pruefeVorlage({ ...gut, mitSignatur: 'on' }).mitSignatur).toBe(true);
	});
	it('Pflichtfelder', () => {
		expect(() => pruefeVorlage({ ...gut, name: ' ' })).toThrow(/Name/);
		expect(() => pruefeVorlage({ ...gut, betreff: '' })).toThrow(/Betreff/);
		expect(() => pruefeVorlage({ ...gut, html: '' })).toThrow(/Mailtext/);
	});
});
