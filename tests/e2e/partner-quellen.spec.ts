import { expect, test } from '@playwright/test';
import { bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Partner als Auftragsquelle (Jamil msg 3707): neuer Auftraggeber-Partner erscheint ausgeschaltet unter Auftragsquellen,
 * mit Etikett „Partner“, ohne Löschen; nach dem Löschen des Partners ist die Quelle aus und wieder normal löschbar.
 */
nurAufTestserver(test);

test('Auftraggeber-Partner → Auftragsquelle (aus, nicht löschbar); Partner löschen → Quelle aus, löschbar', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const name = `E2E Baumarkt ${info.project.name} ${Date.now() % 100000}`;

	await page.goto('/partner/neu?art=auftraggeber');
	await page.getByLabel('Name').first().fill(name);
	await page.getByRole('button', { name: 'Partner anlegen' }).click();
	await expect(page).toHaveURL(/\/partner\/[0-9a-f-]{36}/);
	const partnerUrl = page.url();

	await page.goto('/einstellungen/quellen');
	const zeile = page.locator('li', { has: page.getByRole('textbox', { name: `Name ${name}` }) });
	await expect(zeile.getByTestId('quelle-partner')).toHaveText('Partner');
	await expect(zeile.getByTestId('quelle-partner-hinweis')).toHaveText(`Gehört zu Partner „${name}“ – nur aus- oder einschalten.`);
	await expect(zeile.getByRole('checkbox', { name: 'aktiv' })).not.toBeChecked();
	await expect(zeile.getByRole('button', { name: new RegExp(`^${name} löschen – nicht möglich`) })).toBeDisabled();
	// einschalten geht
	await zeile.getByRole('checkbox', { name: 'aktiv' }).check();
	await expect(zeile.getByRole('checkbox', { name: 'aktiv' })).toBeChecked();
	await page.reload();
	await expect(page.locator('li', { has: page.getByRole('textbox', { name: `Name ${name}` }) }).getByRole('checkbox', { name: 'aktiv' })).toBeChecked();
	await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);

	// Partner löschen (unbenutzt) → Quelle aus, ohne Partner-Etikett, normal löschbar
	await page.goto(partnerUrl);
	await page.getByRole('button', { name: 'Partner löschen' }).click();
	await page.getByRole('button', { name: 'Endgültig löschen' }).click();
	await page.goto('/einstellungen/quellen');
	const danach = page.locator('li', { has: page.getByRole('textbox', { name: `Name ${name}` }) });
	await expect(danach.getByRole('checkbox', { name: 'aktiv' })).not.toBeChecked();
	await expect(danach.getByTestId('quelle-partner')).toHaveCount(0);
	await danach.getByRole('button', { name: `${name} löschen` }).click();
	await bestaetigen(page);
	await expect(page.getByRole('textbox', { name: `Name ${name}` })).toHaveCount(0);
});
