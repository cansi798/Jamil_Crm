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
	// Kacheln über den eigenen Server (msg 2689): 200 mit Bild, und mindestens eine Kachel ist wirklich geladen
	const kachel = await page.evaluate(async () => {
		const r = await fetch('/karte/kacheln/6/33/21.png');
		return { status: r.status, art: r.headers.get('content-type') };
	});
	expect(kachel).toEqual({ status: 200, art: expect.stringMatching(/^image\//) });
	await expect
		.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')].some((i) => i.complete && i.naturalWidth > 0 && i.src.includes('/karte/kacheln/'))), { timeout: 15_000 })
		.toBe(true);
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

/** Sicherheit: Leaflet setzt String-Inhalte als innerHTML – Kundennamen dürfen in Tooltip/Popup nie als HTML wirken. */
test('Karte: bösartiger Kundenname wird als Text angezeigt (kein XSS in Tooltip/Popup)', async ({ page }, info) => {
	test.setTimeout(120_000);
	await anmelden(page, BUERO);
	const marke = `${info.project.name}${Date.now()}`;
	const name = `<img src=x onerror="window.__xss='${marke}'">E2E`;
	let auftragId: string | null = null;
	try {
		await page.goto('/auftraege/neu');
		await page.getByRole('radio', { name: 'Einmal-Kunde' }).check();
		await page.locator('input[name="einmalName"]').fill(name);
		await page.locator('input[name="einmalStrasse"]').fill('Rathausallee 50');
		await page.locator('input[name="einmalPlz"]').fill('22846');
		await page.locator('input[name="einmalOrt"]').fill('Norderstedt');
		await page.locator('input[name="titel"]').fill('E2E XSS-Probe');
		await page.locator('select[name="quelleId"]').selectOption({ label: 'Website' });
		await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		auftragId = page.url().split('/').pop()!;

		// Die Adresse wird im Hintergrund gesucht (Nominatim, 1 Anfrage/s) – bis der Punkt auf der Karte ist, neu laden.
		const tooltip = page.locator('.leaflet-tooltip', { hasText: 'E2E' });
		await expect(async () => {
			await page.goto('/karte');
			await expect(page.locator('.leaflet-container')).toBeVisible();
			await page.evaluate(() => {
				for (const p of document.querySelectorAll('path.leaflet-interactive'))
					p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			});
			await expect(tooltip.first()).toBeAttached({ timeout: 1_000 });
		}).toPass({ timeout: 90_000, intervals: [3_000] });

		await expect(tooltip.first()).toContainText(`<img src=x onerror=`);
		expect(await page.locator('.leaflet-tooltip img, .leaflet-popup img').count()).toBe(0);
		// Popup des Punkts öffnen: Name als Text, kein Bild-Element
		const gefunden = await page.evaluate(() => {
			for (const p of document.querySelectorAll('path.leaflet-interactive')) {
				p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				if (document.querySelector('.leaflet-popup .kt-kunde')?.textContent?.includes('E2E')) return true;
			}
			return false;
		});
		expect(gefunden).toBe(true);
		await expect(page.locator('.leaflet-popup .kt-kunde')).toHaveText(name);
		expect(await page.locator('.leaflet-tooltip img, .leaflet-popup img').count()).toBe(0);
		const zeile = page.getByRole('list', { name: 'Aufträge auf der Karte' }).getByText(name);
		await expect(zeile.first()).toBeVisible();
		expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
	} finally {
		if (auftragId) {
			const s = await page.evaluate(async (id) => (await fetch(`/api/auftraege/${id}`, { method: 'DELETE' })).status, auftragId);
			expect(s).toBeLessThan(300);
		}
	}
});
