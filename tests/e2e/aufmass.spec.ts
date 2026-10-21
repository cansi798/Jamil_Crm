import { expect, test, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Aufmaß-Vorlagen (Jamil msg 2842): Beispiel „Aufmaß Boden/Fliesen“ übernehmen, im Auftrag starten, zwei Räume messen
 * (+ Raum), berechnete Flächen und Summen live, „Mengen fürs Angebot“. Nur in der Vorschau mit Testmodus; räumt auf.
 */
async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, { method: methode, headers: koerper === undefined ? undefined : { 'content-type': 'application/json' }, body: koerper === undefined ? undefined : JSON.stringify(koerper) });
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

test('Aufmaß Boden/Fliesen: zwei Räume, Flächen und Summen werden berechnet', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	page.on('dialog', (d) => d.accept());

	// Vorlage bereitstellen (Beispiel übernehmen, falls noch nicht da)
	await page.goto('/einstellungen/aufmass-vorlagen');
	await expect(page.getByRole('heading', { level: 1, name: 'Aufmaß-Vorlagen' })).toBeVisible();
	const uebernehmen = page.getByTestId('beispiele-uebernehmen');
	if (await uebernehmen.count()) await uebernehmen.click();
	await expect(page.getByRole('link', { name: /Aufmaß Boden\/Fliesen/ })).toBeVisible();

	const kunde = (await api(page, 'GET', '/api/kunden'))[0];
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Aufmaß ${info.project.name} ${Date.now()}`, kundeId: kunde.id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		await page.getByTestId('protokoll-vorlage').selectOption({ label: 'Aufmaß: Aufmaß Boden/Fliesen' });
		await page.getByTestId('protokoll-starten').click();
		await expect(page).toHaveURL(/\/protokolle\//);
		await page.getByLabel('Verschnitt in %').fill('10');
		await page.getByTestId('weiter').click();

		// Raum 1
		await page.locator('#pf-raum_l').fill('5');
		await page.locator('#pf-raum_b').fill('4');
		await page.locator('#pf-raum_abzug').fill('0');
		await page.locator('#pf-raum_tueren').fill('0,9');
		await expect(page.locator('#pf-raum_flaeche')).toHaveText('20 m²');
		await expect(page.locator('#pf-raum_sockel')).toHaveText('17,1 m');
		// Raum 2
		await page.getByRole('button', { name: '+ Raum' }).click();
		await expect(page.getByRole('heading', { name: 'Raum – Raum 2' })).toBeVisible();
		await page.locator('#pf-raum_l__2').fill('2');
		await page.locator('#pf-raum_b__2').fill('1,5');
		await page.locator('#pf-raum_abzug__2').fill('0');
		await page.locator('#pf-raum_tueren__2').fill('0,8');
		await expect(page.locator('#pf-raum_flaeche__2')).toHaveText('3 m²');
		await erwarteKeinQuerScrollen(page, viewport.width);
		await page.getByTestId('weiter').click();
		await expect(page.locator('#pf-summe_flaeche')).toHaveText('23 m²');
		await expect(page.locator('#pf-summe_belag')).toHaveText('25,3 m²');
		await expect(page.getByRole('heading', { name: 'Mengen fürs Angebot' })).toBeVisible();
		await expect(page.getByTestId('speicher-stand')).toHaveText('Gespeichert', { timeout: 10_000 });
		// Raum 2 wieder entfernen: Summe nur noch Raum 1
		await page.getByRole('button', { name: /Schritt 2|Räume/ }).first().click();
		await page.getByRole('button', { name: 'Raum 2 entfernen' }).click();
		await expect(page.locator('#pf-raum_l__2')).toHaveCount(0);
		await page.getByTestId('weiter').click();
		await expect(page.locator('#pf-summe_flaeche')).toHaveText('20 m²');
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => undefined);
		await ctx.close();
	}
});
