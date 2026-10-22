import { describe, expect, it } from 'vitest';
import { STATUS, STATUS_NAMEN } from '../../src/lib/auftrag-status';
import { PORTAL_STUFEN, portalStatusName, portalStatusText } from '../../src/lib/portal-status';

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

	it('Erklärung je Status (msg 3135); „Arbeiten laufen“ verweist nur mit Arbeitsschritten auf sie', () => {
		expect(portalStatusText('anfrage')).toEqual({ text: 'Wir kümmern uns jetzt um die Prüfung Ihrer Anfrage.', schritteLink: null });
		expect(portalStatusText('in_arbeit')).toEqual({ text: 'Wir sind bei Ihnen im Einsatz.', schritteLink: null });
		expect(portalStatusText('in_arbeit', true).schritteLink).toBe('Arbeitsschritten');
		expect(portalStatusText('abgerechnet').text).toBe('Vielen Dank für Ihr Vertrauen. Auch künftig sind wir gerne für Sie da.');
	});
});
