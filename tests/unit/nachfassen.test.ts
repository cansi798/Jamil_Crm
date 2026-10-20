import { describe, expect, it } from 'vitest';
import { fuelle, htmlZuText, mailtoLink, mitSignatur, faelligeStufe, BEISPIEL_WERTE } from '../../src/lib/nachfassen';

describe('Nachfassen: Vorlagen', () => {
	it('Platzhalter füllen; im HTML werden Werte maskiert; unbekannte bleiben leer', () => {
		const w = { 'kunde.name': 'Müller & Söhne <GmbH>', 'angebot.nummer': 'AN-2026-0007' };
		expect(fuelle('Hallo {{kunde.name}}, Angebot {{ angebot.nummer }} {{gibtsnicht}}!', w, false)).toBe(
			'Hallo Müller & Söhne <GmbH>, Angebot AN-2026-0007 !'
		);
		expect(fuelle('<p>{{kunde.name}}</p>', w, true)).toBe('<p>Müller &amp; Söhne &lt;GmbH&gt;</p>');
	});

	it('HTML → Klartext: Absätze, Zeilenumbrüche, Listen, Links, Entities', () => {
		expect(
			htmlZuText('<p>Guten Tag,</p><p>Zeile 1<br>Zeile 2</p><ul><li>A</li><li>B</li></ul><p><a href="https://x.de">Link</a> &amp; mehr&nbsp;Text</p><script>böse()</script>')
		).toBe('Guten Tag,\n\nZeile 1\nZeile 2\n\n- A\n- B\n\nLink (https://x.de) & mehr Text');
	});

	it('Signatur: an der Stelle {{signatur}} oder ans Ende', () => {
		expect(mitSignatur('<p>Hallo</p>{{signatur}}<p>PS</p>', '<p>Jan</p>')).toBe('<p>Hallo</p><p>Jan</p><p>PS</p>');
		expect(mitSignatur('<p>Hallo</p>', '<p>Jan</p>')).toBe('<p>Hallo</p>\n<p>Jan</p>');
		expect(mitSignatur('<p>Hallo</p>', null)).toBe('<p>Hallo</p>');
	});

	it('mailto: Empfänger, Betreff und Text kodiert; zu lange Texte gekürzt', () => {
		const l = mailtoLink('kunde@test.de', 'Ihr Angebot AN-1', 'Hallo\nWelt & Co');
		expect(l).toBe('mailto:kunde%40test.de?subject=Ihr%20Angebot%20AN-1&body=Hallo%0D%0AWelt%20%26%20Co');
		expect(mailtoLink(null, 'x', 'y'.repeat(5000)).length).toBeLessThan(2100);
	});

	it('Beispielwerte für die Vorschau enthalten alle Platzhalter', () => {
		expect(Object.keys(BEISPIEL_WERTE)).toEqual(expect.arrayContaining(['kunde.name', 'angebot.nummer', 'betrag', 'faellig_am', 'link']));
	});
});

describe('Nachfassen: welche Stufe ist fällig?', () => {
	const stufen = [
		{ id: 'a', tage: 3 },
		{ id: 'b', tage: 7 },
		{ id: 'c', tage: 14 }
	];
	it('genau die jüngste fällige Stufe, die noch nicht lief; spätere Läufe sperren frühere', () => {
		expect(faelligeStufe('2026-10-01', '2026-10-03', stufen, [])).toBeNull();
		expect(faelligeStufe('2026-10-01', '2026-10-04', stufen, [])?.id).toBe('a');
		expect(faelligeStufe('2026-10-01', '2026-10-09', stufen, ['a'])?.id).toBe('b');
		expect(faelligeStufe('2026-10-01', '2026-10-09', stufen, ['a', 'b'])).toBeNull();
		// lange nicht geprüft: nur die letzte fällige, nicht alle auf einmal
		expect(faelligeStufe('2026-09-01', '2026-10-20', stufen, [])?.id).toBe('c');
		expect(faelligeStufe('2026-09-01', '2026-10-20', stufen, ['c'])).toBeNull();
	});
});
