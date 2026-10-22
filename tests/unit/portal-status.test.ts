import { describe, expect, it } from 'vitest';
import { STATUS, STATUS_NAMEN } from '../../src/lib/auftrag-status';
import { PORTAL_STUFEN, portalStatusName } from '../../src/lib/portal-status';

describe('Status im Kundenportal (Jamil msg 3131)', () => {
	it('Kundentexte je Status, CRM-Namen unverändert', () => {
		expect(STATUS.map(portalStatusName)).toEqual([
			'Anfrage eingegangen',
			'Angebot erhalten',
			'Auftrag bestätigt',
			'Arbeiten laufen',
			'Arbeiten abgeschlossen',
			'Projekt erfolgreich beendet'
		]);
		expect(Object.values(STATUS_NAMEN)).toEqual(['Anfrage', 'Angebot', 'Beauftragt', 'In Arbeit', 'Abgenommen', 'Abgerechnet']);
		expect(PORTAL_STUFEN.map((s) => s.schluessel)).toEqual([...STATUS]);
	});
});
