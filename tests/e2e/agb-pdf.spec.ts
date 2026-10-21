import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen, portalOeffnen } from './hilfe';

/**
 * AGB als PDF im Kundenportal (Jamil msgs 3030/3032): Link im Häkchen „Ich habe die AGB (PDF) gelesen …“ und unter
 * „Ihre Unterlagen“, das PDF kommt über den Portal-Link; kein Namensfeld mehr. Läuft nur mit PORTAL_TOKEN – einem
 * vorübergehend angelegten Portal-Link (nie über „Link erzeugen“, das würde den Link des Kunden widerrufen).
 * Nimmt nichts an (Bestätigungsschritt wird mit „Zurück“ verlassen).
 */
test('AGB-PDF: Link im Häkchen und in „Ihre Unterlagen“, öffnet das PDF', async ({ page }, info) => {
	const token = process.env.PORTAL_TOKEN;
	test.skip(!token, 'nur mit vorübergehendem Portal-Link (PORTAL_TOKEN)');
	await portalOeffnen(page, token!);
	const pfad = `/portal/${token}/agb`;
	const unterlagen = page.getByRole('link', { name: /Allgemeine Geschäftsbedingungen/ });
	await expect(unterlagen).toBeVisible();
	await expect(unterlagen).toHaveAttribute('href', pfad);
	await expect(unterlagen).toHaveAttribute('target', '_blank');
	const pdf = await page.evaluate(async (u) => {
		const r = await fetch(u);
		return { status: r.status, typ: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options'), kopf: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
	}, pfad);
	expect(pdf).toEqual({ status: 200, typ: 'application/pdf', nosniff: 'nosniff', kopf: '%PDF-' });
	// Klick öffnet einen neuen Tab, der das PDF lädt (headless Chromium lädt PDFs herunter statt sie anzuzeigen)
	const [tab, anfrage] = await Promise.all([
		page.context().waitForEvent('page'),
		page.context().waitForEvent('request', (r) => r.url().endsWith(pfad)),
		unterlagen.click()
	]);
	expect(tab).not.toBe(page);
	expect(anfrage.url()).toContain(pfad);
	await tab.close();

	const annehmen = page.getByRole('button', { name: 'Angebot annehmen' }).first();
	if (await annehmen.isVisible()) {
		await annehmen.click();
		await expect(page.getByLabel('Ihr Name')).toHaveCount(0);
		const label = page.locator('label.pt-check');
		await expect(label).toContainText('Ich habe die AGB (PDF) gelesen und akzeptiere sie.');
		await expect(label.getByRole('link', { name: 'AGB (PDF)' })).toHaveAttribute('href', pfad);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		if (info.project.name === 'desktop') await page.screenshot({ path: 'test-results/agb-pdf-portal.png' });
		await page.getByRole('button', { name: 'Zurück' }).click();
	}
	await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
});
