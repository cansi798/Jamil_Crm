import { defineConfig } from '@playwright/test';

/**
 * Browser-Tests (E2E) gegen die laufende Vorschau (scripts/start-vorschau.sh, Daten aus scripts/seed-dev.ts).
 * Aufruf auf dem Host (Browser stecken im Playwright-Image):
 *   sudo docker run --rm --network host -v /home/can/projekte/crm-system:/w -w /w \
 *     mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc 'npx -y playwright@1.48.2 test'
 */
export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'test-results',
	// Ein Arbeiter: Die Tests teilen sich die Entwicklungsdatenbank (und die Anmelde-Begrenzung je E-Mail).
	workers: 1,
	fullyParallel: false,
	reporter: [['list']],
	timeout: 60_000,
	use: {
		baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8300',
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
