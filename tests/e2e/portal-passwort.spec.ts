import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kundenportal mit Passwort und „Kundenportal öffnen“ (Jamil msgs 3035–3037). Legt einen EIGENEN Testkunden an
 * (nie einen echten Kunden – ein neuer Link widerruft den alten) und löscht ihn am Ende wieder.
 */

async function chef(browser: Browser, viewport: { width: number; height: number }) {
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	return page;
}

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	return page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, { method: methode, headers: koerper ? { 'content-type': 'application/json' } : undefined, body: koerper ? JSON.stringify(koerper) : undefined });
			return { status: a.status, json: await a.json().catch(() => null) };
		},
		{ methode, url, koerper }
	);
}

const passwortFeld = (p: Page) => p.getByLabel('Bitte geben Sie Ihr Passwort ein (Ihre Postleitzahl)');

test('Passwort-Seite → Portal, falsches Passwort, „Kundenportal öffnen“, eigenes Passwort, Widerrufen mit Rückfrage', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const page = await chef(browser, viewport);
	const name = `Portaltest${info.project.name === 'mobil' ? 'M' : 'D'}${Date.now().toString(36)}`;
	const kd = await api(page, 'POST', '/api/kunden', { art: 'privat', vorname: 'Eva', nachname: name, plz: '24103', ort: 'Kiel' });
	expect(kd.status).toBe(201);
	try {
		await page.goto(`/kunden/${kd.json.id}`);
		const karte = page.locator('#kundenportal');
		await expect(karte.getByRole('group', { name: 'Portal-Passwort' })).toContainText('Postleitzahl (24103)');
		await karte.getByRole('button', { name: 'Link für den Kunden erzeugen' }).click();
		const url = await karte.getByLabel('Portal-Link').inputValue();
		const pfad = new URL(url).pathname;

		// „Kundenportal öffnen“ (neuer Tab) und „Link kopieren“ für den aktiven Link
		const aktiv = karte.getByTestId('portal-aktiv');
		const oeffnen = aktiv.getByRole('link', { name: 'Kundenportal öffnen' });
		await expect(oeffnen).toHaveAttribute('target', '_blank');
		expect(new URL((await oeffnen.getAttribute('href'))!).pathname).toBe(pfad);
		await expect(aktiv.getByRole('button', { name: 'Link kopieren' })).toBeVisible();
		await expect(aktiv.getByRole('button', { name: 'Widerrufen' })).toHaveClass(/gefahr/);
		await erwarteKeinQuerScrollen(page, viewport.width);
		const [tab] = await Promise.all([page.context().waitForEvent('page'), oeffnen.click()]);
		await expect(passwortFeld(tab)).toBeVisible();
		await tab.close();

		// Als Kunde: falsches Passwort, dann die PLZ
		const gast = await browser.newContext({ viewport, locale: 'de-DE' });
		const kunde = await gast.newPage();
		await kunde.goto(pfad);
		await expect(kunde.getByRole('heading', { name: 'Ihr Kundenportal' })).toBeVisible();
		// ohne Passwort: Unterseiten leiten zurück
		await kunde.goto(`${pfad}/logo`);
		await expect(passwortFeld(kunde)).toBeVisible();
		await passwortFeld(kunde).fill('99999');
		await kunde.getByRole('button', { name: 'Öffnen' }).click();
		await expect(kunde.getByRole('alert')).toHaveText('Das Passwort stimmt nicht. Bitte prüfen Sie Ihre Eingabe.');
		await erwarteKeinQuerScrollen(kunde, viewport.width);
		await passwortFeld(kunde).fill('24103');
		await kunde.getByRole('button', { name: 'Öffnen' }).click();
		await expect(passwortFeld(kunde)).toHaveCount(0);
		await expect(kunde.locator('.pt-kopf')).toBeVisible();
		const cookie = (await gast.cookies()).find((c) => c.name === 'kp_sitzung');
		expect(cookie).toMatchObject({ path: pfad, httpOnly: true, sameSite: 'Strict' });
		// erneut aufrufen: angemeldet bleiben
		await kunde.goto(pfad);
		await expect(kunde.locator('.pt-kopf')).toBeVisible();

		// Eigenes Passwort: alte Anmeldung endet, PLZ gilt nicht mehr
		await karte.getByLabel('Eigenes Passwort (mind. 6 Zeichen)').fill('Sonnenblume-7');
		await karte.getByRole('button', { name: 'Passwort speichern' }).click();
		await expect(page.getByText('Eigenes Passwort gespeichert')).toBeVisible();
		await kunde.goto(pfad);
		await expect(passwortFeld(kunde)).toBeVisible();
		await passwortFeld(kunde).fill('24103');
		await kunde.getByRole('button', { name: 'Öffnen' }).click();
		await expect(kunde.getByRole('alert')).toBeVisible();
		await passwortFeld(kunde).fill('Sonnenblume-7');
		await kunde.getByRole('button', { name: 'Öffnen' }).click();
		await expect(kunde.locator('.pt-kopf')).toBeVisible();

		// Widerrufen mit Rückfrage → Portal ungültig
		await aktiv.getByRole('button', { name: 'Widerrufen' }).click();
		await karte.getByRole('group', { name: 'Link widerrufen?' }).getByRole('button', { name: 'Ja, widerrufen' }).click();
		await expect(page.getByText('Link widerrufen – er')).toBeVisible();
		expect((await kunde.goto(pfad))?.status()).toBe(404);
		await gast.close();
	} finally {
		await api(page, 'DELETE', `/api/kunden/${kd.json.id}`);
		await page.context().close().catch(() => {});
	}
});
