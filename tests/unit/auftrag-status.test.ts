import { describe, expect, it } from 'vitest';
import { erlaubterWechsel, istStatus, STATUS, STATUS_NAMEN } from '../../src/lib/auftrag-status';

describe('Statuskette der Aufträge', () => {
	it('hat genau sechs Stationen in fester Reihenfolge mit deutschen Beschriftungen', () => {
		expect(STATUS).toEqual(['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet']);
		expect(STATUS.map((s) => STATUS_NAMEN[s])).toEqual([
			'Anfrage',
			'Angebot',
			'Beauftragt',
			'In Arbeit',
			'Abgenommen',
			'Abgerechnet'
		]);
		expect(STATUS_NAMEN.in_arbeit).toBe('In Arbeit');
	});

	it('erlaubt nur einen Schritt vor oder zurück', () => {
		expect(erlaubterWechsel('anfrage', 'angebot')).toBe(true);
		expect(erlaubterWechsel('angebot', 'anfrage')).toBe(true);
		expect(erlaubterWechsel('abgenommen', 'abgerechnet')).toBe(true);
		expect(erlaubterWechsel('anfrage', 'beauftragt')).toBe(false);
		expect(erlaubterWechsel('abgerechnet', 'anfrage')).toBe(false);
		expect(erlaubterWechsel('abgerechnet', 'abgerechnet')).toBe(false);
		expect(erlaubterWechsel('anfrage', 'anfrage')).toBe(false);
	});

	it('istStatus erkennt nur bekannte Schlüssel', () => {
		for (const s of STATUS) expect(istStatus(s)).toBe(true);
		for (const w of ['Anfrage', 'erledigt', '', null, undefined, 3, 'toString', '__proto__']) {
			expect(istStatus(w)).toBe(false);
		}
	});
});
