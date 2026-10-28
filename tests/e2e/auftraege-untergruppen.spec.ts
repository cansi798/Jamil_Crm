import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/** Untergruppen in „Anfrage“ und „Angebot“ (Jamil msg 3601): Board mit Zwischenüberschriften, Liste mit Kennzeichen. Nur lesend. */
test('Board: Anfrage → Neu / Termin vereinbart, Angebot → Noch kein Angebot / Angebot erhalten; Liste mit Kennzeichen', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	await page.goto('/auftraege?ansicht=board');
	const anfrage = page.locator('[data-spalte="anfrage"]');
	if (mobil) await page.locator('.ab-reiter').getByRole('button', { name: /^Anfrage/ }).click();
	await expect(anfrage.getByRole('heading', { level: 3, name: /^Neu/ })).toBeVisible();
	await expect(anfrage.getByRole('heading', { level: 3, name: /^Termin vereinbart/ })).toBeVisible();
	// Zahl der Gruppen = Karten der Spalte
	const zahlen = await anfrage.locator('.ab-gruppe-zahl').allInnerTexts();
	const summe = zahlen.map((z) => Number(z.replace(/\D/g, ''))).reduce((a, b) => a + b, 0);
	expect(summe).toBe(await anfrage.locator('.ab-karte').count());
	const angebot = page.locator('[data-spalte="angebot"]');
	if (mobil) await page.locator('.ab-reiter').getByRole('button', { name: /^Angebot/ }).click();
	await expect(angebot.getByRole('heading', { level: 3, name: /^Noch kein Angebot/ })).toBeVisible();
	await expect(angebot.getByRole('heading', { level: 3, name: /^Angebot erhalten/ })).toBeVisible();
	// andere Spalten ohne Gruppen
	await expect(page.locator('[data-spalte="beauftragt"] .ab-gruppe')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Anfrage und Angebot genauer/ })).toBeVisible();
	await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);

	// Liste: Kennzeichen neben dem Status
	await page.goto('/auftraege?ansicht=liste&status=anfrage');
	await expect(page.locator('[data-untergruppe]').first()).toHaveText(/Neu|Termin vereinbart/);
});
