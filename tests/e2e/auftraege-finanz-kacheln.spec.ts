import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Aufträge-Kacheln mit Finanzpotenzial (Jamil msg 3047): je Status der Wert (€) groß, die Anzahl klein darunter;
 * keine Kachel ragt aus ihrer Zelle (die abgeschnittene €-Kachel), kein Querscrollen bei 1280 und 390 px.
 * Chef (Preise sehen) – Testzugang „jamil.chef“ der Vorschau.
 */
test('Aufträge: Status-Kacheln zeigen Euro und Anzahl, nichts abgeschnitten', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('jamil.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);

	await page.goto('/auftraege?ansicht=liste&zeitraum=alle');
	const gruppe = page.getByRole('group', { name: 'Aufträge: Kennzahlen' });
	const kachel = (titel: string) => gruppe.locator('.kz-kachel', { has: page.locator('.kz-titel', { hasText: new RegExp(`^${titel}$`) }) });
	for (const titel of ['Anfrage', 'Angebot', 'Beauftragt', 'In Arbeit', 'Abgenommen', 'Abgerechnet']) {
		const k = kachel(titel);
		await expect(k.locator('.kz-wert')).toHaveText(/^(–|[\d.]+\s€)$/);
		await expect(k.locator('.kz-info')).toHaveText(/^\d+ Auftr(ag|äge) · neu im Zeitraum$/);
	}
	await expect(kachel('Nachfassen fällig').locator('.kz-wert')).toHaveText(/€/);
	await expect(page.getByText('So wird gerechnet')).toBeVisible();
	// keine Kachel ragt aus ihrer Zelle, die Reihe nicht aus der Seite
	const ueber = await gruppe.evaluate((g) => {
		const r = g.getBoundingClientRect();
		return [...g.querySelectorAll('.kz-kachel')].filter((k) => {
			const b = k.getBoundingClientRect();
			return b.right > r.right + 1 || k.scrollWidth > k.clientWidth + 1;
		}).length;
	});
	expect(ueber).toBe(0);
	await erwarteKeinQuerScrollen(page, viewport.width);
	// Klick auf eine Kachel filtert weiter die Liste
	await kachel('In Arbeit').click();
	await expect(page).toHaveURL(/status=in_arbeit/);
	await page.screenshot({ path: `test-results/auftraege-kacheln-${info.project.name}.png` });
	await ctx.close();
});
