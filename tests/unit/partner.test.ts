import { describe, expect, it } from 'vitest';
import { nachweisStatus } from '../../src/lib/partner';
import { nachweisDateityp, pruefePartnerEingabe } from '../../src/lib/server/partner';

const fehler = (fn: () => unknown) => {
	try {
		fn();
		return null;
	} catch (e) {
		return (e as Error).message;
	}
};

describe('Partner (Jamil msg 2856) – Nachweise', () => {
	it('Status: abgelaufen, läuft in 30 Tagen ab, gültig, ohne Datum', () => {
		expect(nachweisStatus('2026-10-20', '2026-10-21')).toBe('abgelaufen');
		expect(nachweisStatus('2026-10-21', '2026-10-21')).toBe('bald');
		expect(nachweisStatus('2026-11-20', '2026-10-21')).toBe('bald');
		expect(nachweisStatus('2026-11-21', '2026-10-21')).toBe('ok');
		expect(nachweisStatus(null, '2026-10-21')).toBe('ohne');
	});

	it('Dateityp an den ersten Bytes (PDF, JPEG, PNG) – sonst abgelehnt, auch mit falscher Endung', () => {
		expect(nachweisDateityp(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('application/pdf');
		expect(fehler(() => nachweisDateityp(new TextEncoder().encode('<html><script>')))).toMatch(/PDF oder ein Foto/);
		expect(fehler(() => nachweisDateityp(new Uint8Array(11 * 1024 * 1024)))).toMatch(/zu groß/);
	});
});

describe('Partner – Eingaben', () => {
	const gut = { art: 'subunternehmer', name: 'Elektro Kaya' };
	it('Pflicht: Art und Name; Prozente mit Komma; Zahlungsziel ganze Tage', () => {
		expect(pruefePartnerEingabe({ ...gut, provisionProzent: '7,5', rabattProzent: '3 %', zahlungszielTage: '14' })).toMatchObject({ provisionProzent: 7.5, rabattProzent: 3, zahlungszielTage: 14, aktiv: true });
		expect(fehler(() => pruefePartnerEingabe({ ...gut, art: 'kunde' }))).toMatch(/Art/);
		expect(fehler(() => pruefePartnerEingabe({ ...gut, name: ' ' }))).toMatch(/Name/);
		expect(fehler(() => pruefePartnerEingabe({ ...gut, provisionProzent: '120' }))).toMatch(/0 bis 100/);
		expect(fehler(() => pruefePartnerEingabe({ ...gut, zahlungszielTage: '1,5' }))).toMatch(/Zahlungsziel/);
		expect(fehler(() => pruefePartnerEingabe({ ...gut, email: 'keine-mail' }))).toMatch(/E-Mail/);
	});
	it('Portal-Link: nur http/https, keine Zugangsdaten in der Adresse', () => {
		expect(pruefePartnerEingabe({ ...gut, portalUrl: 'portal.obi.de' }).portalUrl).toBe('https://portal.obi.de/');
		expect(fehler(() => pruefePartnerEingabe({ ...gut, portalUrl: 'javascript:alert(1)' }))).toMatch(/http/);
		expect(fehler(() => pruefePartnerEingabe({ ...gut, portalUrl: 'https://nutzer:passwort@portal.de' }))).toMatch(/Zugangsdaten/);
	});
});
