import { describe, expect, it } from 'vitest';
import { basisUrl, istVorschau, STANDARD_ZIEL, vorschauSperre } from '../e2e/ziel';

/** Schutz der Vorschau vor schreibenden Browser-Tests (Jamil msgs 3075/3076). */
describe('E2E-Ziel', () => {
	it('Standard ist der eigene Testserver, nicht die Vorschau', () => {
		expect(basisUrl({})).toBe(STANDARD_ZIEL);
		expect(istVorschau(STANDARD_ZIEL)).toBe(false);
		expect(vorschauSperre({})).toBeNull();
	});

	it('erkennt die Vorschau (öffentlich und auf dem Server)', () => {
		for (const url of ['https://crm.waybuild-software.de', 'https://crm.waybuild-software.de/plantafel', 'http://127.0.0.1:8300', 'http://localhost:8300/']) {
			expect(istVorschau(url), url).toBe(true);
		}
		for (const url of ['http://127.0.0.1:8310', 'http://127.0.0.1:8301', 'https://waybuild-software.de', 'https://crm.waybuild-software.de.example.org', 'kaputt']) {
			expect(istVorschau(url), url).toBe(false);
		}
	});

	it('schreibende Specs gegen die Vorschau nur mit CRM_E2E_VORSCHAU=1', () => {
		expect(vorschauSperre({ BASE_URL: 'https://crm.waybuild-software.de' })).toMatch(/nicht gegen die Vorschau/);
		expect(vorschauSperre({ BASE_URL: 'http://127.0.0.1:8300' })).toMatch(/start-testserver/);
		expect(vorschauSperre({ BASE_URL: 'http://127.0.0.1:8300', CRM_E2E_VORSCHAU: '1' })).toBeNull();
		expect(vorschauSperre({ BASE_URL: 'http://127.0.0.1:8310' })).toBeNull();
	});
});
