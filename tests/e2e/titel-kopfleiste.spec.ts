import { expect, test } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Jamil msg 3060: „doppelte Überschriften nicht nötig – die obere lassen, die andere weg“. Auf der Startseite eines
 * Bereichs (z. B. /auftraege) steht der Titel am Desktop nur in der Kopfleiste; die h1 bleibt für Screenreader.
 * Am Handy (keine Kopfleiste) und auf Detailseiten bleibt der Titel sichtbar.
 */
const BUERO = 'buero@bauwelt.test';
const ORDNER = process.env.BILDSCHIRMFOTOS;

test('Bereichs-Startseiten: Titel nur in der Kopfleiste (Desktop), sichtbar am Handy', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const breite = page.viewportSize()!.width;
	const desktop = info.project.name === 'desktop';
	for (const [pfad, name] of [
		['/auftraege', /Aufträge/],
		['/kunden', 'Kunden']
	] as const) {
		await page.goto(pfad);
		const h1 = page.getByRole('heading', { level: 1, name });
		await expect(h1).toHaveCount(1);
		const box = (await h1.boundingBox())!;
		if (desktop) {
			expect(box.height, `h1 auf ${pfad} nur für Screenreader`).toBeLessThanOrEqual(1);
			await expect(page.locator('.kopfleiste .kopf-bereich')).toContainText(typeof name === 'string' ? name : 'Aufträge');
		} else {
			expect(box.height, `h1 auf ${pfad} am Handy sichtbar`).toBeGreaterThan(10);
		}
		await erwarteKeinQuerScrollen(page, breite);
		if (ORDNER) await page.screenshot({ path: `${ORDNER}/titel${pfad.replace(/\//g, '-')}-${info.project.name}.png` });
	}
	// Detailseite: Titel (Kundenname) bleibt sichtbar
	await page.goto('/kunden');
	await page.locator('a[href^="/kunden/"]').filter({ hasNotText: '+' }).first().click();
	await page.waitForURL(/\/kunden\/[0-9a-f-]{36}$/);
	const box = (await page.locator('main h1').boundingBox())!;
	expect(box.height).toBeGreaterThan(10);
});
