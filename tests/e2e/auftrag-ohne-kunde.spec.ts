import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/** Phase 3 (Wunsch Jamil, 19.10.2026): „Neuer Auftrag“ mit Einmal-Kunden oder ohne Kunden; Einmal-Kunden übernehmen. */
const BUERO = 'buero@bauwelt.test';

async function api(page: Page, methode: string, url: string) {
	const r = await page.evaluate(async ({ methode, url }) => (await fetch(url, { method: methode })).status, { methode, url });
	expect(r, `${methode} ${url}`).toBeLessThan(300);
}

test('Neuer Auftrag mit Einmal-Kunde → Auftragsakte → in Kundendatenbank übernehmen; ohne Kunde', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const name = `Frau Sommer E2E ${info.project.name} ${Date.now()}`;
	const auftraege: string[] = [];
	let kundeId: string | null = null;
	try {
		await page.goto('/auftraege/neu');
		await page.getByRole('radio', { name: 'Einmal-Kunde' }).check();
		await page.locator('input[name="einmalName"]').fill(name);
		await page.locator('input[name="einmalTelefon"]').fill('040 123456');
		await page.locator('input[name="einmalStrasse"]').fill('Gartenweg 2');
		await page.locator('input[name="einmalPlz"]').fill('22846');
		await page.locator('input[name="einmalOrt"]').fill('Norderstedt');
		await page.locator('input[name="titel"]').fill('E2E Rohrbruch');
		await page.locator('select[name="quelleId"]').selectOption({ label: 'Website' }); // Quelle ist Pflicht (msg 2593)
		await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		auftraege.push(page.url().split('/').pop()!);
		await expect(page.getByText('(Einmal-Kunde)').first()).toBeVisible();
		await expect(page.getByText('Gartenweg 2, 22846 Norderstedt')).toBeVisible();
		await page.getByRole('button', { name: 'In Kundendatenbank übernehmen' }).click();
		await page.waitForURL(/\/kunden\/[0-9a-f-]{36}$/);
		kundeId = page.url().split('/').pop()!;
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
		await expect(page.getByRole('link', { name: /E2E Rohrbruch/ }).first()).toBeVisible();

		await page.goto('/auftraege/neu');
		await page.getByRole('radio', { name: 'Ohne Kunde' }).check();
		await page.locator('input[name="titel"]').fill('E2E Lager aufräumen');
		await page.locator('select[name="quelleId"]').selectOption({ label: 'Website' }); // Quelle ist Pflicht (msg 2593)
		await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		auftraege.push(page.url().split('/').pop()!);
		await expect(page.locator('dd', { hasText: 'Ohne Kunde' })).toBeVisible();
	} finally {
		for (const id of auftraege) await api(page, 'DELETE', `/api/auftraege/${id}`);
		if (kundeId) await api(page, 'DELETE', `/api/kunden/${kundeId}`);
	}
});
