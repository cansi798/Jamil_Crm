import { expect, test } from '@playwright/test';

/** Auftragsquellen (Jamil msg 2593): Einstellungen, Filter in Aufträgen, Auswertung (Chef im Testmodus). */
test('Quellen: Einstellungen, Filter, Auswertung mit Tabelle und Diagramm', async ({ page }) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	await page.goto('/einstellungen/quellen');
	await expect(page.getByRole('list', { name: 'Auftragsquellen' }).getByRole('textbox', { name: 'Name Hornbach' })).toHaveValue('Hornbach');

	await page.goto('/auftraege?ansicht=liste');
	await page.getByRole('combobox', { name: 'Auftragsquelle' }).selectOption({ label: 'Hornbach' });
	await expect(page).toHaveURL(/[?&]quelle=[0-9a-f-]{36}/);

	await page.goto('/auswertung/quellen');
	await expect(page.getByRole('heading', { name: 'Auswertung nach Auftragsquelle' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Diagramm' })).toContainText('Website');
	const tabelle = page.locator('table.qa-tabelle');
	await expect(tabelle).toContainText('Annahmequote');
	await tabelle.getByRole('button', { name: /^Aufträge/ }).click();
	await expect(tabelle.locator('thead th[aria-sort="descending"]')).toContainText('Aufträge');
});
