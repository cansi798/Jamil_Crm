import { describe, expect, it } from 'vitest';
import { erinnerungAusFeld, erinnerungsTeile, vorlaufAusText, vorlaufText } from '../../src/lib/erinnerungen';

describe('Erinnerungen (msg 2679)', () => {
	it('Texte', () => {
		expect(vorlaufText(60)).toBe('1 Stunde vorher');
		expect(vorlaufText(300)).toBe('5 Stunden vorher');
		expect(vorlaufText(1440)).toBe('1 Tag vorher');
		expect(vorlaufText(2880)).toBe('2 Tage vorher');
		expect(vorlaufText(10080)).toBe('1 Woche vorher');
		expect(vorlaufText(90)).toBe('90 Minuten vorher');
		expect(vorlaufText(0)).toBe('zur Fälligkeit');
	});
	it('Formularfeld', () => {
		expect(erinnerungAusFeld('')).toBeNull();
		expect(erinnerungAusFeld('60')).toEqual({ minuten: 60 });
		expect(erinnerungAusFeld('zeit:2026-10-23T08:00')).toEqual({ ortszeit: '2026-10-23T08:00' });
		expect(erinnerungAusFeld('quatsch')).toEqual({ ortszeit: '' });
	});
	it('gesprochen', () => {
		expect(vorlaufAusText('eine Stunde vorher')).toBe(60);
		expect(vorlaufAusText('einen Tag vorher')).toBe(1440);
		expect(vorlaufAusText('5 Stunden vorher')).toBe(300);
		expect(vorlaufAusText('zwei Tage vorher')).toBe(2880);
		expect(vorlaufAusText('30 Minuten vorher')).toBe(30);
		expect(vorlaufAusText('eine halbe Stunde vorher')).toBe(30);
		expect(vorlaufAusText('eine Woche vorher')).toBe(10080);
		expect(vorlaufAusText('morgen um 8')).toBeNull();
		expect(vorlaufAusText('100 Tage vorher')).toBeNull();
		expect(erinnerungsTeile('einen Tag vorher und eine Stunde vorher')).toEqual(['einen Tag vorher', 'eine Stunde vorher']);
		expect(erinnerungsTeile('1 Tag vorher, 1 Stunde vorher und 5 Minuten vorher')).toHaveLength(2);
	});
});

import { istPushEndpunkt } from '../../src/lib/erinnerungen';
describe('Push-Adressen (SSRF-Schutz)', () => {
	it('erlaubt die Push-Dienste der Browser', () => {
		for (const u of [
			'https://fcm.googleapis.com/fcm/send/abc:def',
			'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
			'https://push.services.mozilla.com/wpush/v1/x',
			'https://wns2-par02p.notify.windows.com/w/?token=abc',
			'https://web.push.apple.com/QGx',
			'https://api.push.apple.com/3/device/x'
		])
			expect(istPushEndpunkt(u), u).toBe(true);
	});
	it('lehnt interne, IP-, Lookalike- und sonstige Adressen ab', () => {
		for (const u of [
			'https://169.254.169.254/latest/meta-data',
			'https://127.0.0.1/x',
			'https://[::1]/x',
			'https://crm-db.internal/x',
			'https://crm-db/x',
			'https://fcm.googleapis.com.evil.com/x',
			'https://evilfcm.googleapis.com/x',
			'https://notify.windows.com/x',
			'https://evil-push.apple.com/x',
			'https://fcm.googleapis.com:8443/x',
			'https://user:pw@fcm.googleapis.com/x',
			'http://fcm.googleapis.com/x',
			'https://fcm.googleapis.com./x',
			'https://fcm.googleapis.com/',
			'https://2130706433/x',
			'javascript:alert(1)',
			'kein url',
			42
		])
			expect(istPushEndpunkt(u), String(u)).toBe(false);
	});
});
