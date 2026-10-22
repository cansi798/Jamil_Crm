import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Aufträge-Kacheln mit Finanzpotenzial (Jamil msg 3047): je Status der Wert (€) groß, die Anzahl klein darunter;
 * keine Kachel ragt aus ihrer Zelle (die abgeschnittene €-Kachel), kein Querscrollen bei 1280 und 390 px.
 * Chef (Preise sehen) – Testzugang „jamil.chef“ der Vorschau.
 */
test('Aufträge: Status-Kacheln zeigen Euro und Anzahl, nichts abgeschnitten', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('jamil.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);

	await page.goto('/auftraege?ansicht=liste&zeitraum=alle');
	const gruppe = page.getByRole('group', { name: 'Aufträge: Kennzahlen' });
	const kachel = (titel: string) => gruppe.locator('.kz-kachel', { has: page.locator('.kz-titel', { hasText: new RegExp(`^${titel}$`) }) });
	for (const titel of ['Anfrage', 'Angebot', 'Beauftragt', 'In Arbeit', 'Abgenommen', 'Abgerechnet']) {
		const k = kachel(titel);
		await expect(k.locator('.kz-wert')).toHaveText(/^(–|[\d.]+\s€)$/);
		await expect(k.locator('.kz-info')).toHaveText(/^\d+ Auftr(ag|äge) · neu im Zeitraum$/);
	}
	// msg 3141: nur die 6 Status-Kacheln; „Auftragswert offen“ ruhig im Kopf, „Nachfassen fällig“ nicht mehr hier
	await expect(gruppe.locator('.kz-kachel')).toHaveCount(6);
	await expect(kachel('Nachfassen fällig')).toHaveCount(0);
	// Liste: alle 6 Kacheln in einer Reihe (am Computer)
	if (info.project.name === 'desktop') {
		const oben = await gruppe.locator('.kz-zelle').evaluateAll((l) => new Set(l.map((e) => Math.round(e.getBoundingClientRect().top))).size);
		expect(oben).toBe(1);
	}
	await expect(page.locator('.kz-zusatz')).toContainText(/^Offen: [\d.]+\s€ · angenommen, nicht abgerechnet$/);
	await expect(page.getByText('So wird gerechnet')).toBeVisible();
	// keine Kachel ragt aus ihrer Zelle, die Reihe nicht aus der Seite
	const ueber = await gruppe.evaluate((g) => {
		const r = g.getBoundingClientRect();
		return [...g.querySelectorAll('.kz-kachel')].filter((k) => {
			const b = k.getBoundingClientRect();
			return b.right > r.right + 1 || k.scrollWidth > k.clientWidth + 1;
		}).length;
	});
	expect(ueber).toBe(0);
	await erwarteKeinQuerScrollen(page, viewport.width);
	// Klick auf eine Kachel filtert weiter die Liste
	await kachel('In Arbeit').click();
	await expect(page).toHaveURL(/status=in_arbeit/);
	await page.screenshot({ path: `test-results/auftraege-kacheln-${info.project.name}.png` });

	// Board: jede Status-Kachel steht genau über ihrer Spalte (gleiches Raster); am Handy Spalten als Reiter
	await page.goto('/auftraege?ansicht=board&zeitraum=alle');
	await expect(gruppe.locator('.kz-kachel')).toHaveCount(6);
	if (info.project.name === 'desktop') {
		const ids = ['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'];
		const kacheln = await gruppe.locator('.kz-zelle').evaluateAll((l) => l.map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; }));
		const spalten = await Promise.all(ids.map((id) => page.locator(`section[data-spalte="${id}"]`).evaluate((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; })));
		for (let i = 0; i < 6; i++) {
			expect(Math.abs(kacheln[i][0] - spalten[i][0]), `Kachel ${ids[i]} links`).toBeLessThanOrEqual(1);
			expect(Math.abs(kacheln[i][1] - spalten[i][1]), `Kachel ${ids[i]} Breite`).toBeLessThanOrEqual(1);
		}
		// scrollt das Board waagerecht, läuft die Kachelreihe mit
		const board = page.locator('.ab-board');
		if (await board.evaluate((b) => b.scrollWidth > b.clientWidth)) {
			await board.evaluate((b) => (b.scrollLeft = 120));
			await expect.poll(() => gruppe.evaluate((g) => g.scrollLeft)).toBe(await board.evaluate((b) => b.scrollLeft));
		}
	}
	await erwarteKeinQuerScrollen(page, viewport.width);
	await page.screenshot({ path: `test-results/auftraege-board-kacheln-${info.project.name}.png` });
	await ctx.close();
});
