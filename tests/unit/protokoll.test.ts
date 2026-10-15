import { describe, expect, it } from 'vitest';
import { darfProtokollLesen, PROTOKOLL_MODULE, PROTOKOLL_TABELLEN, type ProtokollTabelle } from '../../src/lib/server/protokoll';

const nutzer = (rechte: string[]): Nutzer => ({
	id: 'n1',
	betriebId: 'b1',
	istAdmin: false,
	rechte,
	betriebStatus: 'aktiv'
});

describe('darfProtokollLesen (Ruling R19)', () => {
	it('Kundendaten (kunden, objekte): nur mit kunden.lesen – einstellungen allein genügt nicht', () => {
		for (const tabelle of ['kunden', 'objekte'] as const) {
			expect(darfProtokollLesen(nutzer(['einstellungen']), tabelle), tabelle).toBe(false);
			expect(darfProtokollLesen(nutzer(['einstellungen', 'benutzer.verwalten']), tabelle), tabelle).toBe(false);
			expect(darfProtokollLesen(nutzer(['kunden.lesen']), tabelle), tabelle).toBe(true);
			expect(darfProtokollLesen(nutzer([]), tabelle), tabelle).toBe(false);
		}
	});

	it('jede Tabelle eines Moduls verlangt ihr eigenes Recht', () => {
		for (const tabelle of Object.keys(PROTOKOLL_MODULE) as ProtokollTabelle[]) {
			expect(darfProtokollLesen(nutzer(['einstellungen']), tabelle), tabelle).toBe(false);
			expect(darfProtokollLesen(nutzer([PROTOKOLL_TABELLEN[tabelle]]), tabelle), tabelle).toBe(true);
		}
	});

	it('Verwaltungstabellen: einstellungen genügt weiterhin, sonst das Tabellenrecht', () => {
		for (const tabelle of ['rollen', 'benutzer', 'einladungen'] as const) {
			expect(darfProtokollLesen(nutzer(['einstellungen']), tabelle), tabelle).toBe(true);
			expect(darfProtokollLesen(nutzer(['kunden.lesen']), tabelle), tabelle).toBe(false);
		}
		expect(darfProtokollLesen(nutzer(['benutzer.verwalten']), 'benutzer')).toBe(true);
		expect(darfProtokollLesen(nutzer(['benutzer.verwalten']), 'rollen')).toBe(false);
	});
});
