import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Nachkalkulation (Jamil msgs 2770–2774, Punkt 1): Auswertung mit Zeitraum und Gruppierung, Plan/Ist im Auftrag;
 * Monteur sieht beides nicht. Nur in der Vorschau mit Testmodus. Ändert keine Daten.
 */
test('Chef: Auswertung Nachkalkulation und Plan/Ist im Auftrag; Monteur ohne Zugriff', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/auswertung/nachkalkulation');
	await expect(page.getByRole('heading', { name: 'Nachkalkulation' })).toBeVisible();
	await page.locator('select[name="gruppe"]').selectOption('mitarbeiter');
	await page.getByRole('button', { name: 'Anzeigen' }).click();
	await expect(page).toHaveURL(/gruppe=mitarbeiter/);
	await expect(page.getByRole('heading', { name: 'Lernen: Minuten pro Einheit' })).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);

	await page.goto('/auftraege');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	await page.goto(href!);
	await expect(page.locator('#nachkalkulation')).toContainText('Arbeitsstunden');
	await erwarteKeinQuerScrollen(page, viewport.width);
	await ctx.close();

	const m = await browser.newContext({ viewport });
	const mp = await m.newPage();
	await mp.goto('/anmelden');
	await mp.getByLabel('Benutzername').fill('jamil.monteur');
	await mp.getByRole('button', { name: 'Anmelden' }).click();
	await expect(mp).not.toHaveURL(/\/anmelden/);
	const r = await mp.goto('/auswertung/nachkalkulation');
	expect(r?.status()).toBe(403);
	await m.close();
});
