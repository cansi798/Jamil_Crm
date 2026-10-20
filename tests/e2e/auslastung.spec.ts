import { expect, test } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/** Auslastung je Mitarbeiter und Monat mit Break-even, Start-Kachel „Diesen Monat“ (Wunsch Jamil msg 2476, Punkte 4 und 5). */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';

test('Auslastung: aus der Plantafel, Monat blättern, Break-even; Start-Kachel führt hin', async ({ page }, info) => {
	await anmelden(page, BUERO);
	await page.goto('/');
	const kachel = page.getByRole('link', { name: /^Diesen Monat: .*(Gewinn verplant|bis zum Break-even)/ });
	await expect(kachel).toBeVisible();
	await kachel.click();
	await expect(page).toHaveURL(/\/plantafel\/auslastung$/);
	await expect(page.getByRole('heading', { level: 1, name: /^Auslastung \S+ \d{4}$/ })).toBeVisible();
	const tabelle = page.getByRole('table', { name: 'Auslastung je Mitarbeiter' });
	await expect(tabelle).toBeVisible();
	await expect(tabelle.getByRole('columnheader', { name: 'Auslastung' })).toBeVisible();
	await expect(page.getByRole('heading', { name: /^Break-even .*: (erreicht|noch nicht erreicht)$/ })).toBeVisible();

	const titel = await page.getByRole('heading', { level: 1 }).textContent();
	await page.getByRole('link', { name: 'Nächster Monat →' }).click();
	await expect(page).toHaveURL(/\?monat=\d{4}-\d{2}$/);
	await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(titel!);
	if (info.project.name === 'mobil') await erwarteKeinQuerScrollen(page, 390);

	await page.goto('/plantafel');
	await page.getByRole('link', { name: 'Auslastung' }).click();
	await expect(page).toHaveURL(/\/plantafel\/auslastung$/);
});

test('Auslastung: Monteur hat keinen Zugriff und keine Kachel', async ({ page }) => {
	await anmelden(page, MONTEUR);
	await page.goto('/');
	await expect(page.getByRole('link', { name: /^Diesen Monat:/ })).toHaveCount(0);
	const r = await page.goto('/plantafel/auslastung');
	expect(r?.status()).toBe(403);
});
