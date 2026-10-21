import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Handgezeichneter Rahmen um „Für Sie zu erledigen“ im Kundenportal (Jamil msg 3040): nur solange etwas offen ist,
 * zeichnet sich beim Sichtbarwerden, ohne Platzbedarf und ohne Klicks abzufangen; kein Querscrollen am Handy.
 * Läuft nur mit PORTAL_TOKEN (vorübergehender Portal-Link – nie über „Link erzeugen“).
 */
test('SkizzenRahmen um „Für Sie zu erledigen“', async ({ page }, info) => {
	const token = process.env.PORTAL_TOKEN;
	test.skip(!token, 'nur mit vorübergehendem Portal-Link (PORTAL_TOKEN)');
	await page.goto(`/portal/${token}`);
	const karte = page.locator('#zu-erledigen');
	test.skip((await karte.count()) === 0, 'nichts offen – dann gibt es keinen Rahmen');
	await karte.scrollIntoViewIfNeeded();
	const rahmen = karte.locator('.sr svg');
	await expect(rahmen).toBeVisible();
	// gleich groß wie die Karte (+ Abstand), legt sich darüber und fängt keine Klicks ab
	const k = (await karte.boundingBox())!;
	const r = (await rahmen.boundingBox())!;
	// 7 px Abstand rundum, gemessen ab der Innenkante des 1-px-Rands → 12 px größer als die Karte
	expect(Math.abs(r.width - (k.width + 12))).toBeLessThan(2);
	expect(Math.abs(r.height - (k.height + 12))).toBeLessThan(2);
	expect(await karte.locator('.sr').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
	// Strich ist nach dem Nachzeichnen vollständig
	await expect.poll(() => karte.locator('.sr-strich').first().evaluate((e) => Number(getComputedStyle(e).strokeDashoffset.replace('px', ''))), { timeout: 4000 }).toBeLessThan(0.01);
	await page.getByRole('button', { name: 'Angebot annehmen' }).first().click(); // Klick geht durch den Rahmen
	await expect(page.getByRole('button', { name: 'Verbindlich annehmen' })).toBeVisible();
	await page.getByRole('button', { name: 'Zurück' }).click();
	await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	await karte.screenshot({ path: `test-results/skizzen-rahmen-${info.project.name}.png` });
	await page.screenshot({ path: `test-results/skizzen-rahmen-seite-${info.project.name}.png` });
});

test('SkizzenRahmen bei „Bewegung reduzieren“: steht sofort', async ({ browser }) => {
	const token = process.env.PORTAL_TOKEN;
	test.skip(!token, 'nur mit vorübergehendem Portal-Link (PORTAL_TOKEN)');
	const ctx = await browser.newContext({ reducedMotion: 'reduce' });
	const page = await ctx.newPage();
	await page.goto(`/portal/${token}`);
	const strich = page.locator('#zu-erledigen .sr-strich').first();
	test.skip((await strich.count()) === 0, 'nichts offen');
	expect(await strich.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
	expect(await strich.evaluate((e) => getComputedStyle(e).strokeDashoffset)).toMatch(/^0(px)?$/);
	await ctx.close();
});
