import { describe, expect, it } from 'vitest';
import {
	ANGEBOT_STATUS,
	ANGEBOT_STATUS_NAMEN,
	erlaubterAngebotWechsel,
	istAngebotStatus
} from '../../src/lib/angebot-status';

describe('Angebotsstatus', () => {
	it('genau vier Status mit deutschen Beschriftungen', () => {
		expect(ANGEBOT_STATUS).toEqual(['entwurf', 'versendet', 'angenommen', 'abgelehnt']);
		expect(ANGEBOT_STATUS.map((s) => ANGEBOT_STATUS_NAMEN[s])).toEqual(['Entwurf', 'Versendet', 'Angenommen', 'Abgelehnt']);
	});

	it('erlaubt nur entwurf→versendet, versendet→angenommen/abgelehnt/entwurf', () => {
		expect(erlaubterAngebotWechsel('entwurf', 'versendet')).toBe(true);
		expect(erlaubterAngebotWechsel('versendet', 'angenommen')).toBe(true);
		expect(erlaubterAngebotWechsel('versendet', 'abgelehnt')).toBe(true);
		expect(erlaubterAngebotWechsel('versendet', 'entwurf')).toBe(true);
		expect(erlaubterAngebotWechsel('entwurf', 'angenommen')).toBe(false);
		expect(erlaubterAngebotWechsel('entwurf', 'abgelehnt')).toBe(false);
		expect(erlaubterAngebotWechsel('entwurf', 'entwurf')).toBe(false);
		expect(erlaubterAngebotWechsel('angenommen', 'versendet')).toBe(false);
		expect(erlaubterAngebotWechsel('abgelehnt', 'entwurf')).toBe(false);
		expect(erlaubterAngebotWechsel('angenommen', 'abgelehnt')).toBe(false);
	});

	it('istAngebotStatus erkennt nur bekannte Schlüssel', () => {
		for (const s of ANGEBOT_STATUS) expect(istAngebotStatus(s)).toBe(true);
		for (const w of ['Entwurf', 'offen', '', null, undefined, 1, 'toString', '__proto__']) {
			expect(istAngebotStatus(w)).toBe(false);
		}
	});
});
