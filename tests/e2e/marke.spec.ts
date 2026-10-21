import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Logo oben links (Jamil msg 3014) und Hausfarbe aus dem Logo (msg 3016). Ändert NICHTS am Betrieb – prüft nur,
 * dass Logo und Farbe wirken: Hausfarbe in Einstellungen → Briefkopf = Farbe der Knöpfe, Logo in Seitenleiste
 * (Computer) bzw. oben (Handy) höchstens 40 px hoch, keine waagerechte Scrollleiste. Nur mit Testmodus (can.chef).
 */
test('Logo oben links und Knöpfe in der Hausfarbe', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const breite = page.viewportSize()!.width;

	await page.goto('/einstellungen/briefkopf');
	await expect(page.getByRole('heading', { name: 'Hausfarbe' })).toBeVisible();
	const hat = await page.getByRole('img', { name: 'Logo des Betriebs' }).count();

	// Knopf-Farbe = Hausfarbe des Betriebs (Token --ui-akzent der App-Hülle)
	const akzent = await page.locator('.huelle').evaluate((e) => getComputedStyle(e).getPropertyValue('--ui-akzent').trim());
	expect(akzent).toMatch(/^#[0-9a-f]{6}$/);
	const hex = (rgb: string) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
	const knopf = page.getByRole('button', { name: 'Logo hochladen' });
	expect(hex(await knopf.evaluate((e) => getComputedStyle(e).backgroundColor))).toBe(akzent);
	// Vorschau nennt dieselbe Farbe (sofern die Farbe für lesbaren Text nicht abgedunkelt werden musste)
	await expect(page.getByLabel('Vorschau der Hausfarbe')).toBeVisible();

	if (hat > 0) {
		const logo = info.project.name === 'mobil' ? page.locator('.kopf-schmal .marke-logo img') : page.locator('.hauptnav .marke-logo img');
		await expect(logo).toBeVisible();
		const box = await logo.boundingBox();
		expect(box!.height).toBeLessThanOrEqual(40.5);
		expect(box!.height).toBeGreaterThanOrEqual(24);
		expect(box!.x).toBeLessThan(40);
	}
	await erwarteKeinQuerScrollen(page, breite);
	await page.goto('/kunden');
	await erwarteKeinQuerScrollen(page, breite);
});
