import { expect, test, type Locator, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Regel „Alles, was aufklappt, schwebt“ (Jamil msg 3116): Listen, Menüs und Panels liegen in der obersten Ebene
 * (Popover), verschieben nichts und sind ganz im Bild – am Computer und am Handy (390 px). Testzugang „can.chef“.
 */
async function anmelden(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
}

async function schwebtImBild(page: Page, el: Locator) {
	await expect(el).toBeVisible();
	expect(await el.evaluate((e) => e.matches(':popover-open'))).toBe(true);
	const b = (await el.boundingBox())!;
	const vp = page.viewportSize()!;
	expect(b.y).toBeGreaterThanOrEqual(-1);
	expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
	expect(b.x).toBeGreaterThanOrEqual(-1);
	expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
	await erwarteKeinQuerScrollen(page, vp.width);
}

test('Gespeicherte Ansichten und ⋯-Menü schweben, Filterleiste bleibt gleich hoch', async ({ page }) => {
	await anmelden(page);
	await page.goto('/kunden');
	const leiste = page.locator('.filter-leiste').first();
	const h = (await leiste.boundingBox())!.height;
	await page.locator('.ga-knopf').locator('visible=true').first().click();
	const menue = page.getByRole('dialog', { name: 'Gespeicherte Ansichten' });
	await schwebtImBild(page, menue);
	expect(Math.abs((await leiste.boundingBox())!.height - h)).toBeLessThan(1);
	const mehr = menue.locator('details.ga-mehr summary').first();
	if (await mehr.count()) {
		await mehr.click();
		await schwebtImBild(page, menue.locator('.ga-aktionen').first());
		await page.keyboard.press('Escape');
		await expect(menue.locator('details.ga-mehr[open]')).toHaveCount(0);
	}
	// Esc schließt; erneut öffnen und Klick außerhalb schließt auch
	await page.keyboard.press('Escape');
	await expect(menue).toHaveCount(0);
	await page.locator('.ga-knopf').locator('visible=true').first().click();
	await expect(menue).toBeVisible();
	await page.mouse.click(2, page.viewportSize()!.height - 120); // freie Fläche (Rand)
	await expect(menue).toHaveCount(0);
});

test('Benachrichtigungen schweben', async ({ page }) => {
	await anmelden(page);
	await page.goto('/kunden');
	const glocke = page.getByRole('button', { name: /Benachrichtigungen/ }).locator('visible=true').first();
	test.skip((await glocke.count()) === 0, 'keine Glocke');
	await glocke.click();
	await schwebtImBild(page, page.getByRole('region', { name: 'Benachrichtigungen' }));
});

test('Mitarbeiter-Auswahl im Einsatz-Dialog verzieht den Dialog nicht', async ({ page }) => {
	await anmelden(page);
	await page.goto('/plantafel?neu=1'); // „Neuer Termin“ (Schnellmenü, msgs 3078/3109)
	const dlg = page.locator('dialog[open]');
	const vorher = await dlg.evaluate((d) => ({ h: d.getBoundingClientRect().height, s: d.scrollHeight }));
	await dlg.locator('.pw > button').first().click();
	const feld = page.locator('.pw-feld');
	await schwebtImBild(page, feld);
	expect(await dlg.evaluate((d) => ({ h: d.getBoundingClientRect().height, s: d.scrollHeight }))).toEqual(vorher);
	await page.keyboard.press('Escape');
});

test('Aufgaben-Board: Status-Menü schwebt, Karte bleibt gleich hoch', async ({ page }) => {
	await anmelden(page);
	await page.goto('/todos?ansicht=board&person=alle');
	const karte = page.locator('.kanban-karte').filter({ has: page.locator('details.ab-menue') }).locator('visible=true').first();
	test.skip((await karte.count()) === 0, 'keine Aufgabe auf dem Board');
	const summary = karte.locator('details.ab-menue summary');
	const h = (await karte.boundingBox())!.height;
	await summary.click();
	await schwebtImBild(page, page.locator('details.ab-menue[open] .ab-menue-liste'));
	expect(Math.abs((await karte.boundingBox())!.height - h)).toBeLessThan(1);
	await page.keyboard.press('Escape');
	await expect(page.locator('details.ab-menue[open]')).toHaveCount(0);
});
