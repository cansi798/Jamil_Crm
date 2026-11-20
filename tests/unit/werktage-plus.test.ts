import { describe, expect, it } from 'vitest';
import { werktagePlus } from '../../src/lib/zeit';
import { rechnungErinnerungTitel } from '../../src/lib/server/rechnung-erinnerung';

describe('werktagePlus (Fälligkeit der Rechnungs-Erinnerung)', () => {
	it('zählt nur Montag bis Freitag', () => {
		expect(werktagePlus('2026-11-16', 2)).toBe('2026-11-18'); // Mo → Mi
		expect(werktagePlus('2026-11-19', 2)).toBe('2026-11-23'); // Do → Mo
		expect(werktagePlus('2026-11-20', 2)).toBe('2026-11-24'); // Fr → Di
		expect(werktagePlus('2026-11-21', 2)).toBe('2026-11-24'); // Sa → Di
		expect(werktagePlus('2026-11-22', 2)).toBe('2026-11-24'); // So → Di
	});
	it('über Monats- und Jahresgrenzen, 0 bleibt der Tag', () => {
		expect(werktagePlus('2026-12-31', 2)).toBe('2027-01-04'); // Do → Mo
		expect(werktagePlus('2026-11-20', 0)).toBe('2026-11-20');
	});
	it('Titel der Erinnerung', () => {
		expect(rechnungErinnerungTitel('A-0042')).toBe('Rechnung für Auftrag A-0042 erstellen');
	});
});
