import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Foto-Aufmaß (Jamil msgs 2770–2774 Punkt 8, 2780): bekannte Flächen eingeben, KI schätzt den Rest (in der Vorschau ohne
 * Schlüssel: Test-KI), Entwurf „Schätzung – vor Ort prüfen“ mit Faustwert, Werte ändern, als Angebotsentwurf übernehmen.
 */
test('Foto-Aufmaß: Eingaben → Schätzung → korrigieren → Angebotsentwurf', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/auftraege');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	await page.goto(href!);
	await page.getByRole('link', { name: 'Foto-Aufmaß' }).click();
	await expect(page.getByRole('heading', { name: 'Foto-Aufmaß' })).toBeVisible();
	await page.locator('select[name="raumart"]').selectOption('bad');
	await page.locator('input[name="wandM2"]').fill('20');
	await page.locator('input[name="bodenM2"]').fill('4');
	await page.locator('input[name="dusche"]').fill('1');
	await page.getByRole('button', { name: 'Rest schätzen lassen' }).click();
	await expect(page.getByText('Schätzung – vor Ort prüfen.')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('input[name="m_silikon_lfm"]')).not.toHaveValue('');
	await page.locator('input[name="m_silikon_lfm"]').fill('18,5');
	await erwarteKeinQuerScrollen(page, viewport.width);
	await page.getByRole('button', { name: 'Als Angebotsentwurf übernehmen' }).click();
	await expect(page).toHaveURL(/\/(angebote|auftraege)\//);
	await ctx.close();
});
