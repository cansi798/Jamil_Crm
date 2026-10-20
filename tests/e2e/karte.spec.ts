import { expect, test } from '@playwright/test';
import { anmelden } from './hilfe';

/** Auftragskarte (Jamil msg 2602): Karte mit OSM-Kacheln (CSP), Punkte, Route aus der Liste, Google-Maps-Link. */
const BUERO = 'buero@bauwelt.test';

test('Karte: Kacheln laden, Aufträge in die Route, Reihenfolge, Google Maps', async ({ page }) => {
	const csp: string[] = [];
	page.on('console', (m) => {
		if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
	});
	await anmelden(page, BUERO);
	await page.goto('/karte');
	await expect(page.getByRole('heading', { name: 'Auftragskarte' })).toBeVisible();
	await expect(page.locator('.leaflet-container')).toBeVisible();
	await expect(page.locator('img.leaflet-tile').first()).toBeAttached({ timeout: 15_000 });
	const liste = page.getByRole('list', { name: 'Aufträge auf der Karte' });
	const knoepfe = liste.getByRole('button', { name: 'Zur Route' });
	expect(await knoepfe.count()).toBeGreaterThanOrEqual(2);
	await knoepfe.nth(0).click();
	await knoepfe.nth(0).click(); // der nächste noch nicht gewählte
	const route = page.locator('.kt-stopps li');
	await expect(route).toHaveCount(2);
	const erster = await route.first().locator('.kt-was a').textContent();
	await page.getByRole('button', { name: 'Stopp 1 nach unten' }).click();
	await expect(route.nth(1).locator('.kt-was a')).toHaveText(erster!);
	const google = page.getByRole('link', { name: 'Route in Google Maps öffnen' });
	await expect(google).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
	await page.getByRole('button', { name: 'Kürzeste Reihenfolge' }).click();
	await expect(route).toHaveCount(2);
	expect(csp, csp.join('\n')).toEqual([]);
});
