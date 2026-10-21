import { defineConfig } from '@playwright/test';
import { basisUrl, vorschauSperre } from './tests/e2e/ziel';

// Netzwerk des Service Workers für Playwright sichtbar machen (Chromium): Nur so wirkt context.route() auch auf seine
// Anfragen – der Offline-Test (plantafel.spec.ts) braucht das, setOffline() allein erreicht den Service Worker nicht.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

/**
 * Browser-Tests (E2E). Standard-Ziel ist ein EIGENER Testserver mit eigener Datenbank (scripts/start-testserver.sh,
 * http://127.0.0.1:8310) – nicht die Vorschau. Gegen die Vorschau nur lesende Tests: BASE_URL=http://127.0.0.1:8300;
 * schreibende Specs (Online-Buchung, Kundenportal, Terminarten) überspringen sich dort selbst (tests/e2e/ziel.ts),
 * außer CRM_E2E_VORSCHAU=1 ist gesetzt.
 * Aufruf auf dem Host (Browser stecken im Playwright-Image):
 *   sudo docker run --rm --network host -v /home/can/projekte/crm-system:/w -w /w \
 *     mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc 'npx -y playwright@1.48.2 test'
 */
if (vorschauSperre()) console.warn(`Ziel ist die Vorschau (${basisUrl()}): schreibende Specs werden übersprungen.`);
export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'test-results',
	// Ein Arbeiter: Die Tests teilen sich die Entwicklungsdatenbank (und die Anmelde-Begrenzung je E-Mail).
	workers: 1,
	fullyParallel: false,
	reporter: [['list']],
	timeout: 60_000,
	use: {
		baseURL: basisUrl(),
		browserName: 'chromium',
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'mobil',
			use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
		},
		{
			name: 'desktop',
			use: { viewport: { width: 1280, height: 800 } }
		}
	]
});
