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
	await expect(page.getByTestId('portal-status-auftrag')).toContainText(/Im Kundenportal sichtbar|Nicht im Kundenportal/);
	await expect(page.getByTestId('portal-status-auftrag').getByRole('button', { name: /Was bewirkt diese Einstellung\? Auftrag im Kundenportal/ })).toBeVisible();
	await expect(page.getByText('Versendete Angebote und Auftragsbestätigungen erscheinen automatisch')).toHaveCount(0);
	await expect(page.getByText('Im Portal zeigen', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Der Kunde sieht:')).toHaveCount(0);
	await page.getByTestId('portal-hinweis-kunde').getByRole('link', { name: /Einstellungen des Kunden/ }).click();
	await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}#portal-einstellung$/);

	// Kundenakte: Einstellungen für diesen Kunden
	const block = page.getByTestId('portal-einstellung');
	await expect(block).toBeVisible();
	await expect(block.getByRole('button', { name: /Was bewirkt diese Einstellung\? Portal-Einstellungen dieses Kunden/ })).toBeVisible();
	const namen = block.getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ });
	await expect(namen).toHaveValue('');
	await expect(namen.locator('option').first()).toContainText('Firmen-Standard');
	await namen.selectOption('aus');
	await block.getByRole('button', { name: 'Einstellungen speichern' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Portal-Einstellungen des Kunden gespeichert' })).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ })).toHaveValue('aus');
	await erwarteKeinQuerScrollen(page, breite);

	// zurück auf „wie Firma“
	await page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ }).selectOption('');
	await page.getByTestId('portal-einstellung').getByRole('button', { name: 'Einstellungen speichern' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /^Namen der Mitarbeiter zeigen/ })).toHaveValue('');

	// Firmen-Standard: Gruppe „Der Kunde sieht im Portal“
	await page.goto('/einstellungen/kundenportal');
	await expect(page.getByText('Der Kunde sieht im Portal (Standard für alle Kunden)')).toBeVisible();
	await expect(page.getByRole('checkbox', { name: 'Auftragsstatus' })).toBeChecked();
});
