import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/** Anlagen + QR (Jamil msgs 2503/2505): anlegen am Objekt, Detailseite, Etikett-PDF, QR ohne Anmeldung ohne Kundendaten. */
const BUERO = 'buero@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

test('Anlage am Objekt anlegen, QR-Seite als Gast zeigt nur Typ und Firmenkontakt', async ({ page, browser }, info) => {
	await anmelden(page, BUERO);
	const kunden = await api(page, 'GET', '/api/kunden');
	const kunde = kunden[0];
	const objekt = await api(page, 'POST', `/api/kunden/${kunde.id}/objekte`, { bezeichnung: `E2E Anlagenhaus ${info.project.name} ${Date.now()}`, strasse: 'Geheimweg 7' });
	try {
		await page.goto(`/kunden/${kunde.id}/objekte/${objekt.id}`);
		await page.getByText('+ Anlage').click();
		const f = page.locator('form[action="?/anlageAnlegen"]');
		await f.locator('select[name="typ"]').selectOption('waermepumpe');
		// Zusatzfelder wechseln mit dem Typ
		await expect(f.locator('select[name="extra_bauart"]')).toBeVisible();
		await f.locator('input[name="bezeichnung"]').fill('WP Keller E2E');
		await f.locator('input[name="seriennummer"]').fill('SN-E2E-42');
		await f.locator('select[name="extra_bauart"]').selectOption('luft_wasser');
		await f.locator('input[name="extra_leistung_kw"]').fill('8,5');
		await f.locator('select[name="wartungRegel"]').selectOption('jaehrlich');
		await f.getByRole('button', { name: 'Anlage anlegen' }).click();
		await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
		await expect(page.getByRole('heading', { name: 'WP Keller E2E' })).toBeVisible();
		await expect(page.locator('dl')).toContainText('Luft/Wasser');
		await expect(page.locator('dl')).toContainText('8,5 kW');
		await expect(page.locator('dl')).toContainText('jährlich');

		// Etikett-PDF
		const etikett = await page.request.get(`${page.url()}/etikett`);
		expect(etikett.headers()['content-type']).toBe('application/pdf');
		expect((await etikett.body()).subarray(0, 5).toString()).toBe('%PDF-');

		// QR: Bild + Link mit zufälligem Kürzel (nicht die ID)
		expect(await page.locator('.an-qr img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
		const anlageUrl = page.url();
		const anlageId = anlageUrl.split('/').pop()!;
		const qr = new URL((await page.locator('.an-qr-link').textContent())!);
		expect(qr.pathname).toMatch(/^\/a\/[A-Za-z0-9_-]{24}$/);
		expect(qr.pathname).not.toContain(anlageId);
		// angemeldet: Weiterleitung auf die Anlage
		await page.goto(qr.pathname);
		await expect(page).toHaveURL(anlageUrl);
		// Gast: nur Typ + Kontakt, keine Kunden-/Objekt-/Anlagendaten
		const gast = await browser.newContext();
		const g = await gast.newPage();
		await g.goto(qr.pathname);
		await expect(g.getByRole('heading', { name: 'Störung melden' })).toBeVisible();
		await expect(g.getByText('Wärmepumpe')).toBeVisible();
		const text = (await g.locator('body').textContent())!;
		for (const geheim of ['WP Keller E2E', 'SN-E2E-42', 'Geheimweg', objekt.bezeichnung, kunde.nachname ?? kunde.firma, anlageId]) {
			if (geheim) expect(text).not.toContain(geheim);
		}
		expect(await g.content()).not.toContain(anlageId);
		await g.goto('/a/AAAAAAAAAAAAAAAAAAAAAAAA');
		await expect(g.getByRole('heading', { name: 'Code nicht gefunden' })).toBeVisible();
		await gast.close();
	} finally {
		await api(page, 'DELETE', `/api/kunden/${kunde.id}/objekte/${objekt.id}`);
	}
});
