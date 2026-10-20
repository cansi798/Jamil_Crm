import { describe, expect, it } from 'vitest';
import { domainVon, pruefeLinkEingabe, pruefeLinkUrl } from '../../src/lib/server/auftrag-links';

const fehler = (w: unknown) => {
	try {
		pruefeLinkUrl(w);
		return null;
	} catch (e) {
		return (e as { status: number; message: string }).status + ' ' + (e as Error).message;
	}
};

describe('Links am Auftrag – Adresse prüfen (Jamil msg 2850)', () => {
	it('erlaubt http und https, normalisiert, ergänzt https:// ohne Schema', () => {
		expect(pruefeLinkUrl('https://portal.partner.de/abnahme?id=7')).toBe('https://portal.partner.de/abnahme?id=7');
		expect(pruefeLinkUrl('  http://Partner.DE  ')).toBe('http://partner.de/');
		expect(pruefeLinkUrl('portal.partner.de/auftrag/123')).toBe('https://portal.partner.de/auftrag/123');
	});

	it('lehnt gefährliche oder unsinnige Schemata ab (javascript:, data:, vbscript:, file:, ftp:, mailto:)', () => {
		for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', 'file:///etc/passwd', 'ftp://partner.de/x', 'mailto:a@b.de']) {
			expect(fehler(u), u).toMatch(/^400 /);
		}
	});

	it('lehnt Zugangsdaten, Leerzeichen und kaputte Adressen ab', () => {
		expect(fehler('https://nutzer:geheim@partner.de/')).toMatch(/Zugangsdaten/);
		expect(fehler('https://nutzer@partner.de/')).toMatch(/Zugangsdaten/);
		expect(fehler('https://')).toMatch(/^400 /);
		expect(fehler('https://partner')).toMatch(/Domain/);
		expect(fehler('')).toMatch(/Bitte eine Webadresse/);
		expect(fehler(42)).toMatch(/Bitte eine Webadresse/);
		expect(fehler(`https://partner.de/${'x'.repeat(2000)}`)).toMatch(/zu lang/);
	});

	it('kodiert Sonderzeichen; was nicht kodiert werden kann, wird abgelehnt (passt zur Datenbank-Regel)', () => {
		expect(pruefeLinkUrl('https://partner.de/a b"<c>')).toBe('https://partner.de/a%20b%22%3Cc%3E');
		expect(fehler('https://partner.de/?q=`x`')).toMatch(/ungültige Zeichen/);
		expect(fehler('https://partner.de/?q=a\\b')).toMatch(/ungültige Zeichen/);
	});

	it('Domain zur Anzeige ohne www; Titel fällt auf die Domain zurück; Portal nur ausdrücklich', () => {
		expect(domainVon('https://www.obi.de/x')).toBe('obi.de');
		expect(domainVon('kaputt')).toBe('');
		expect(pruefeLinkEingabe({ url: 'https://www.obi.de/abnahme', titel: ' ' })).toEqual({ titel: 'obi.de', url: 'https://www.obi.de/abnahme', notiz: null, imPortal: false });
		expect(pruefeLinkEingabe({ url: 'obi.de', titel: 'Abnahme', notiz: 'Zugang beim Bauleiter', imPortal: 'on' })).toMatchObject({ titel: 'Abnahme', notiz: 'Zugang beim Bauleiter', imPortal: true });
	});
});
