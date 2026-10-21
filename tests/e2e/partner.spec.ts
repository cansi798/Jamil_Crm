import { expect, test, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Partner (Jamil msg 2856): Subunternehmer anlegen, Ansprechpartner und (abgelaufenen) Nachweis erfassen, am Auftrag
 * zuordnen → Warnung. Nur in der Vorschau mit Testmodus; der Partner bleibt danach deaktiviert, der Auftrag wird gelöscht.
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

test('Partner anlegen, Nachweis, am Auftrag mit Warnung zuordnen', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	page.on('dialog', (d) => d.accept());
	const name = `E2E Elektro ${info.project.name} ${Date.now()}`;

	await page.goto('/partner/neu?art=subunternehmer');
	await page.getByLabel('Name').first().fill(name);
	await page.getByLabel('Adresse des Portals').fill('portal.example.org');
	await page.getByLabel('Provision %').fill('5,5');
	await page.getByRole('button', { name: 'Partner anlegen' }).click();
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	await expect(page.getByRole('link', { name: /Partner-Portal öffnen/ })).toHaveAttribute('href', 'https://portal.example.org/');

	await page.getByRole('button', { name: 'Ansprechpartner hinzufügen' }).click();
	await page.locator('form[action="?/kontakt"]').getByLabel('Name').fill('Murat Kaya');
	await page.locator('form[action="?/kontakt"]').getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Murat Kaya')).toBeVisible();

	await page.getByRole('button', { name: 'Nachweis hinzufügen' }).click();
	const nf = page.locator('form[action="?/nachweis"]');
	await nf.locator('select[name="art"]').selectOption('versicherung');
	await nf.getByLabel('Gültig bis').fill('2020-01-31');
	await nf.getByRole('button', { name: 'Nachweis speichern' }).click();
	await expect(page.getByText(/gültig bis 31\.01\.2020 · abgelaufen/)).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);

	const kunde = (await api(page, 'GET', '/api/kunden'))[0];
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Partner ${info.project.name} ${Date.now()}`, kundeId: kunde.id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		const karte = page.locator('#partner');
		await karte.getByRole('button', { name: 'Subunternehmer zuordnen' }).click();
		await karte.locator('select[name="partnerId"]').last().selectOption({ label: `${name} (⚠ abgelaufen: Betriebshaftpflicht-Versicherung)` });
		await karte.getByLabel('Leistung (optional)').fill('Elektro');
		await karte.getByRole('button', { name: 'Zuordnen' }).click();
		await expect(karte.getByRole('alert')).toContainText('Nachweis abgelaufen');
		await expect(karte.getByText(name, { exact: true })).toBeVisible();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => undefined);
		await page.goto('/partner');
		await page.getByRole('link', { name: new RegExp(name) }).click();
		await page.getByRole('button', { name: 'Partner löschen' }).click();
		await expect(page).toHaveURL(/\/partner($|\?)|\/partner\/[0-9a-f-]+/);
		await ctx.close();
	}
});
