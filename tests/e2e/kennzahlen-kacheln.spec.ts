import { expect, test, type Page } from '@playwright/test';

/**
 * Kennzahl-Kacheln (Jamil msgs 2799/2801/2803) und Start-Cockpit (msg 2813): Zeitraum umschalten, Klick auf eine
 * Kachel filtert die Liste, Bereiche des Starts lassen sich ausblenden und bleiben nach dem Neuladen ausgeblendet.
 * Läuft mit dem Testzugang „jamil.chef“ (Testmodus der Vorschau).
 */
async function alsChef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('jamil.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
}

test('Kacheln: Zeitraum und Klick-Filter auf Angebote, Aufträge, Kunden', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'einmal reicht');
	await alsChef(page);

	await page.goto('/angebote');
	const angebote = page.getByRole('group', { name: 'Angebote: Kennzahlen' });
	await angebote.getByRole('link', { name: /Entwürfe/ }).click();
	await expect(page).toHaveURL(/status=entwurf/);
	await expect(angebote.getByRole('link', { name: /Entwürfe/ })).toHaveAttribute('aria-current', 'true');
	await page.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link', { name: 'Jahr' }).click();
	await expect(page).toHaveURL(/zeitraum=jahr/);
	await expect(page).toHaveURL(/status=entwurf/);

	await page.goto('/auftraege?ansicht=liste');
	await page.getByRole('group', { name: 'Aufträge: Kennzahlen' }).getByRole('link', { name: /In Arbeit/ }).click();
	await expect(page).toHaveURL(/status=in_arbeit|status=in-arbeit/);

	await page.goto('/kunden');
	await page.getByRole('group', { name: 'Kunden: Kennzahlen' }).getByRole('link', { name: /Aktive Kunden/ }).click();
	await expect(page).toHaveURL(/gruppe=aktiv/);
	await expect(page.getByRole('link', { name: 'Filter aufheben' })).toBeVisible();
});

test('Start-Cockpit: Bereiche sichtbar und je Benutzer ausblendbar', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'einmal reicht');
	await alsChef(page);
	await page.goto('/');
	const main = page.getByRole('main');
	for (const t of ['Kennzahlen', 'Handlungsbedarf', 'Auslastung']) await expect(main.getByRole('heading', { name: new RegExp(`^${t}`) })).toBeVisible();

	await main.getByRole('button', { name: 'Start anpassen' }).click();
	const schalter = main.getByRole('checkbox', { name: 'Handlungsbedarf' });
	await expect(schalter).toBeChecked();
	await schalter.click();
	await expect(main.getByRole('heading', { name: 'Handlungsbedarf' })).toHaveCount(0);
	await page.reload();
	await expect(main.getByRole('heading', { name: /^Kennzahlen/ })).toBeVisible();
	await expect(main.getByRole('heading', { name: 'Handlungsbedarf' })).toHaveCount(0);

	// zurücksetzen
	await main.getByRole('button', { name: 'Start anpassen' }).click();
	await main.getByRole('checkbox', { name: 'Handlungsbedarf' }).click();
	await expect(main.getByRole('heading', { name: 'Handlungsbedarf' })).toBeVisible();
});
