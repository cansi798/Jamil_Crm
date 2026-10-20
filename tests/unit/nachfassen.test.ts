import { describe, expect, it } from 'vitest';
import { fuelle, htmlZuText, mailtoLink, mitSignatur, faelligeStufe, fertigeMail, vorschauDokument, BEISPIEL_WERTE } from '../../src/lib/nachfassen';

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

describe('Nachfassen: Vorschau (msg 2670)', () => {
	it('fertige Mail wie beim Versand: Betreff, HTML mit Signatur, Klartext automatisch oder eigene Fassung', () => {
		const v = { betreff: 'Angebot {{angebot.nummer}}', html: '<p>{{kunde.anrede}},</p><p>Gruß</p>', text: null };
		const m = fertigeMail(v, BEISPIEL_WERTE, '<p>Ihr <b>Team</b></p>');
		expect(m.betreff).toBe('Angebot AN-2026-0042');
		expect(m.html).toBe('<p>Sehr geehrte Familie Müller,</p><p>Gruß</p>\n<p>Ihr <b>Team</b></p>');
		expect(m.text).toBe('Sehr geehrte Familie Müller,\n\nGruß\n\nIhr Team');
		const eigen = fertigeMail({ ...v, text: 'Hallo {{kunde.name}}' }, BEISPIEL_WERTE, '<p>Ihr Team</p>');
		expect(eigen.text).toBe('Hallo Familie Müller\nIhr Team');
		expect(fertigeMail({ ...v, text: '   ' }, BEISPIEL_WERTE, null).text).toBe('Sehr geehrte Familie Müller,\n\nGruß');
	});

	it('Vorschau-Dokument: CSP ohne Skripte, Werte maskiert', () => {
		const d = vorschauDokument(fertigeMail({ betreff: '', html: '<p>{{kunde.name}}</p>', text: null }, { 'kunde.name': '<script>x</script>' }, null).html);
		expect(d).toMatch(/^<!doctype html>/);
		expect(d).toContain(`content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'"`);
		expect(d).toContain('<p>&lt;script&gt;x&lt;/script&gt;</p>');
		expect(d).not.toContain('<script>');
	});
});
