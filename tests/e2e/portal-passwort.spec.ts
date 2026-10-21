import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Kundenportal mit Passwort und „Kundenportal öffnen“ (Jamil msgs 3035–3037). Legt einen EIGENEN Testkunden an
 * (nie einen echten Kunden – ein neuer Link widerruft den alten) und löscht ihn am Ende wieder.
 */

// legt Kundenportal-Links an (widerruft dabei den Link des Kunden) – nie gegen die Vorschau (Jamil msgs 3075/3076)
nurAufTestserver(test);

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
	const kd = await api(page, 'POST', '/api/kunden', { art: 'privat', vorname: 'Eva', nachname: name, strasse: 'Holtenauer Straße 1', plz: '24103', ort: 'Kiel', telefon: '0431 123456', email: 'eva@example.org' });
	expect(kd.status).toBe(201);
	try {
		// Auftrag des Testkunden (msg 3050): ohne Link nur „Portal-Link beim Kunden verwalten“
		const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `Portal ${name}`, kundeId: kd.json.id });
		expect(auftrag.status).toBe(201);
		await page.goto(`/auftraege/${auftrag.json.id}`);
		const kundePortal = page.getByTestId('kunde-portal');
		await expect(kundePortal.getByRole('link', { name: 'Portal-Link beim Kunden verwalten' })).toHaveAttribute('href', `/kunden/${kd.json.id}#kundenportal`);
		await expect(kundePortal.getByRole('link', { name: 'Kundenportal öffnen' })).toHaveCount(0);
		await page.goto(`/kunden/${kd.json.id}`);
		const karte = page.locator('#kundenportal');
		// Kundenseite: dieselbe Knopfreihe im Kontakt (msg 3072)
		const kontakt = page.getByTestId('kunde-aktionen');
		await expect(kontakt.getByRole('link', { name: 'Anrufen' })).toHaveAttribute('href', 'tel:0431123456');
		await expect(kontakt.getByRole('button', { name: 'Mail an Kunden' })).toBeVisible();
		await expect(kontakt.getByRole('link', { name: 'Navigieren' })).toBeVisible();
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
		// … und dasselbe direkt im Auftrag unter dem Kundennamen
		await page.goto(`/auftraege/${auftrag.json.id}`);
		// eine Knopfreihe (msgs 3050/3072): Navigieren, Mail an Kunden, Anrufen, Kundenportal öffnen – keine eigene Mail-Karte
		const reihe = page.getByTestId('kunde-aktionen');
		const imAuftrag = reihe.getByRole('link', { name: 'Kundenportal öffnen' });
		await expect(imAuftrag).toHaveAttribute('target', '_blank');
		expect(new URL((await imAuftrag.getAttribute('href'))!).pathname).toBe(pfad);
		await expect(reihe.getByRole('button', { name: 'Portal-Link kopieren' })).toBeVisible();
		await expect(reihe.getByRole('button', { name: 'Mail an Kunden' })).toBeVisible();
		await expect(reihe.getByRole('link', { name: 'Anrufen' })).toHaveAttribute('href', 'tel:0431123456');
		await expect(reihe.getByRole('link', { name: 'Navigieren' })).toBeVisible();
		await expect(page.getByText('E-Mail an den Kunden')).toHaveCount(0);
		await expect(kundePortal).toHaveCount(0);
		await erwarteKeinQuerScrollen(page, viewport.width);
		await page.goto(`/kunden/${kd.json.id}`);

		// Ohne Cookie: jede Unterseite → Passwort-Seite; kodierte Pfade (Sicherheitsprüfung) → 404, nie die Datei
		const roh = await browser.newContext();
		const token = pfad.split('/').pop()!;
		for (const unter of ['/agb', '/logo', '/dokument/angebot/00000000-0000-4000-8000-000000000000']) {
			const r = await roh.request.get(`${pfad}${unter}`, { maxRedirects: 0 });
			expect(r.status(), unter).toBe(303);
			expect(r.headers()['location']).toBe(pfad);
		}
		const kodiert = `/portal/%${token.charCodeAt(0).toString(16).toUpperCase()}${token.slice(1)}/agb`;
		const rk = await roh.request.get(kodiert, { maxRedirects: 0 });
		expect(rk.status()).toBe(404);
		expect(rk.headers()['content-type'] ?? '').not.toContain('pdf');
		const aktion = await roh.request.post(`${pfad}?/entscheiden`, { form: { angebotId: 'x' }, headers: { origin: new URL(url).origin }, maxRedirects: 0 });
		expect(aktion.status()).toBe(303);
		await roh.close();

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
		const auftraege = await api(page, 'GET', `/api/auftraege?kunde=${kd.json.id}`);
		for (const x of auftraege.json ?? []) await api(page, 'DELETE', `/api/auftraege/${x.id}`);
		await api(page, 'DELETE', `/api/kunden/${kd.json.id}`);
		await page.context().close().catch(() => {});
	}
});
