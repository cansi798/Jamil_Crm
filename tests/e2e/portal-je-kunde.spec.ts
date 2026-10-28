import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Portal-Einstellungen gehören zum Kunden (Jamil, Talk msgs 3423, 3439): Auswahl „wie Firma / ja / nein“ in der Kundenakte,
 * speichern, wieder zurück; am Auftrag nur noch der Hinweis mit Link. Schreibt Einstellungen → nie gegen die Vorschau.
 */
nurAufTestserver(test);

test('Kundenakte: Portal-Einstellungen des Kunden; Auftrag zeigt nur den Hinweis', async ({ page }, info) => {
	const breite = info.project.name === 'mobil' ? 390 : 1280;
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	// Auftrag „Ladenumbau Trockenbau“ (Seed): nur Hinweis, keine Portal-Schalter
	await page.goto('/auftraege?ansicht=liste&suche=Ladenumbau');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	test.skip(!href, 'Seed-Auftrag „Ladenumbau Trockenbau“ fehlt');
	await page.goto(href!);
	// dezent (Jamil msg 3526): Haken + kurzer Zustand, Erklärung im ⓘ
	// dezentes Kennzeichen im Auftragskopf (Jamil msg 3561), keine eigene Karte mehr
	await expect(page.getByTestId('portal-status-auftrag')).toContainText('Im Portal sichtbar');
	await expect(page.getByRole('heading', { name: 'Kundenportal', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('portal-status-auftrag').getByRole('button', { name: /Was bewirkt diese Einstellung\? Auftrag im Kundenportal/ })).toBeVisible();
	await expect(page.getByText('Versendete Angebote und Auftragsbestätigungen erscheinen automatisch')).toHaveCount(0);
	await expect(page.getByText('Im Portal zeigen', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Der Kunde sieht:')).toHaveCount(0);
	await page.getByTestId('portal-status-auftrag').getByRole('link', { name: /Im Portal sichtbar/ }).click();
	await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}#portal-einstellung$/);
	const kundeUrl = page.url().split('#')[0];

	// Kundenakte: Einstellungen für diesen Kunden
	const block = page.getByTestId('portal-einstellung');
	await expect(block).toBeVisible();
	await expect(page.locator('#portal-einstellung').getByRole('button', { name: /Was bewirkt diese Einstellung\? Portal-Einstellungen dieses Kunden/ })).toBeVisible();
	const namen = block.getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ });
	await expect(namen).toHaveValue('');
	await expect(namen.locator('option').first()).toContainText('Firmen-Standard');
	await namen.selectOption('aus');
	// „Speichern“ oben rechts im Kopf des Abschnitts (Jamil msg 3558)
	const speichern = page.getByTestId('portal-einstellung-speichern');
	const kopf = await page.locator('#portal-einstellung .abschnitt-kopf').boundingBox();
	const knopfBox = await speichern.boundingBox();
	expect(knopfBox!.y).toBeLessThan(kopf!.y + kopf!.height);
	await speichern.click();
	await expect(page.getByRole('status').filter({ hasText: 'Portal-Einstellungen des Kunden gespeichert' })).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ })).toHaveValue('aus');
	await erwarteKeinQuerScrollen(page, breite);

	// zurück auf „wie Firma“
	await page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ }).selectOption('');
	await page.getByTestId('portal-einstellung-speichern').click();
	await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ })).toHaveValue('');

	// Firmen-Standard: Gruppe „Der Kunde sieht im Portal“
	await page.goto('/einstellungen/kundenportal');
	await expect(page.getByText('Der Kunde sieht im Portal (Standard für alle Kunden)')).toBeVisible();
	await expect(page.getByRole('checkbox', { name: 'Auftragsstatus' })).toBeChecked();
	// Automatik: gleicher Aufbau, Speichern oben rechts, beide Werte in einem Formular (Jamil msg 3558)
	await page.goto(kundeUrl);
	const automatik = page.locator('#automatik');
	if (await automatik.count()) {
		await expect(automatik.getByRole('combobox', { name: /Automatisch nachfassen/ })).toBeVisible();
		await automatik.getByRole('combobox', { name: /Automatisch nachfassen/ }).selectOption('nein');
		await page.getByTestId('automatik-speichern').click();
		await expect(automatik.getByRole('status')).toContainText('gespeichert');
		await page.reload();
		await expect(page.locator('#automatik').getByRole('combobox', { name: /Automatisch nachfassen/ })).toHaveValue('nein');
		await page.locator('#automatik').getByRole('combobox', { name: /Automatisch nachfassen/ }).selectOption('ja');
		await page.getByTestId('automatik-speichern').click();
		await expect(page.locator('#automatik').getByRole('status')).toContainText('gespeichert');
	}
});
