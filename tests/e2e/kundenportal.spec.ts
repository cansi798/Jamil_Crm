import { expect, test, type Browser } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Kundenportal (Jamil msgs 2770–2774 Punkt 4, 2778): Chef erzeugt beim Kunden des Auftrags „Ladenumbau Trockenbau“ (Seed: versendetes
 * Angebot) einen Link (ein Portal je Kunde, msg 2793); der Kunde öffnet ihn ohne Anmeldung, sieht Status und Angebot und nimmt es an (Bestätigungsschritt
 * + AGB-Häkchen, keine Unterschrift) → Auftragsbestätigung erscheint. Die Annahme läuft nur, solange das Angebot noch
 * offen ist (erster Lauf); danach prüft der Test nur noch die Anzeige. Am Ende wird der Link widerrufen.
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

test('Link erzeugen, Portal als Kunde, Angebot annehmen, Auftragsbestätigung; Link widerrufen', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const page = await chef(browser, viewport);
	await page.goto('/auftraege?ansicht=liste&suche=Ladenumbau');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	test.skip(!href, 'Seed-Auftrag „Ladenumbau Trockenbau“ fehlt');
	await page.goto(href!);
	await expect(page.getByTestId('portal-status-auftrag')).toBeVisible();
	await page.getByRole('link', { name: 'Link beim Kunden verwalten', exact: true }).click();
	await expect(page).toHaveURL(/\/kunden\//);
	const karte = page.locator('#kundenportal');
	await karte.getByRole('button', { name: /Link für den Kunden erzeugen|Neuen Link erzeugen/ }).click();
	const url = await karte.getByLabel('Portal-Link').inputValue();
	expect(url).toMatch(/\/portal\/[A-Za-z0-9_-]{43}$/);
	// Passwort (msg 3037): Standard ist die PLZ des Kunden – steht auf der Karte
	const plz = /Postleitzahl \((\S+)\)/.exec((await karte.getByRole('group', { name: 'Portal-Passwort' }).textContent()) ?? '')?.[1];
	expect(plz, 'Seed-Kunde ohne PLZ').toBeTruthy();
	await erwarteKeinQuerScrollen(page, viewport.width);

	// Kunde, ohne Anmeldung
	const gast = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const kunde = await gast.newPage();
	const antwort = await kunde.goto(new URL(url).pathname);
	expect(antwort?.headers()['x-robots-tag']).toMatch(/noindex/);
	// Passwort-Seite: kein Referrer nach außen (same-origin, damit das Formular „Origin“ mitschickt)
	expect(antwort?.headers()['referrer-policy']).toBe('same-origin');
	await kunde.getByLabel('Bitte geben Sie Ihr Passwort ein (Ihre Postleitzahl)').fill(plz!);
	await kunde.getByRole('button', { name: 'Öffnen' }).click();
	await expect(kunde.getByRole('heading', { name: 'Ladenumbau Trockenbau', exact: true })).toBeVisible();
	// das Portal selbst wieder ganz ohne Referrer
	expect((await kunde.reload())?.headers()['referrer-policy']).toBe('no-referrer');
	// Andere Tests legen weitere Aufträge beim selben Kunden an – nur die eigene Karte prüfen
	await expect(kunde.getByLabel('Ladenumbau Trockenbau').getByTestId('portal-status')).toBeVisible();
	// Handwerks-Design (msgs 2848, 2851): Überblick oben, Fortschrittsweg, Kontakt rechts
	await expect(kunde.getByRole('region', { name: 'Überblick' })).toContainText('Ihr nächster Termin');
	// Kundensprache (msg 3131)
	await expect(kunde.getByRole('region', { name: 'Überblick' })).toContainText('Damit wir weitermachen können');
	await expect(kunde.getByRole('region', { name: 'Überblick' })).toContainText('Alle Dokumente an einem Ort');
	await expect(kunde.getByRole('img', { name: /^Fortschritt:/ }).first()).toBeVisible();
	await expect(kunde.getByRole('heading', { name: /^(Ihr persönlicher Projektbegleiter|Ihre persönliche Projektbegleiterin)$/ }).first()).toBeVisible();
	// EIN Bereich „Ihre Unterlagen“ mit Art-Etikett und Filter-Chips (msg 2958)
	const unterlagen = kunde.getByRole('region', { name: 'Ihre Unterlagen' });
	await expect(unterlagen).toContainText('Angebot');
	await unterlagen.getByRole('button', { name: /^Dokumente/ }).click();
	await expect(unterlagen.getByRole('link', { name: /Angebot AN-/ })).toHaveCount(0);
	await unterlagen.getByRole('button', { name: /^Alle/ }).click();
	await expect(unterlagen.getByRole('link', { name: /Angebot AN-/ }).first()).toBeVisible();
	await erwarteKeinQuerScrollen(kunde, viewport.width);
	const annehmen = kunde.getByRole('button', { name: 'Angebot annehmen' });
	if (info.project.name === 'desktop' && (await annehmen.isVisible())) {
		await annehmen.click();
		// kein Namensfeld mehr (msg 3032) – der Kunde ist über den Link bekannt
		await expect(kunde.getByLabel('Ihr Name')).toHaveCount(0);
		const verbindlich = kunde.getByRole('button', { name: 'Verbindlich annehmen' });
		await verbindlich.click();
		// ohne AGB-Häkchen lässt der Browser nicht absenden
		await expect(kunde.getByRole('button', { name: 'Verbindlich annehmen' })).toBeVisible();
		await kunde.locator('input[name="agb"]').check();
		await verbindlich.click();
		await expect(kunde.getByText(/Vielen Dank für Ihren Auftrag/)).toBeVisible();
		await expect(kunde.getByRole('link', { name: /Auftragsbestätigung AB-/ }).first()).toBeVisible();
		await expect(kunde.getByText(/Angenommen von /).first()).toBeVisible();
		// Im CRM: Auftragsbestätigung bereit zum Versand (im Auftrag)
		const kundenSeite = page.url();
		await page.goto(href!);
		await expect(page.locator('#auftragsbestaetigung')).toContainText('bereit zum Versand');
		await expect(page.locator('#auftragsbestaetigung').getByRole('link', { name: 'In Mailprogramm öffnen' })).toBeVisible();
		await page.goto(kundenSeite);
	}
	await gast.close();

	// Link widerrufen → Portal sagt „nicht gültig“
	await karte.getByRole('button', { name: 'Widerrufen' }).first().click();
	await karte.getByRole('button', { name: 'Ja, widerrufen' }).click();
	await expect(page.getByText('Link widerrufen – er')).toBeVisible();
	const gast2 = await browser.newContext();
	const r = await (await gast2.newPage()).goto(new URL(url).pathname);
	expect(r?.status()).toBe(404);
	await gast2.close();
	await page.context().close().catch(() => {});
});
