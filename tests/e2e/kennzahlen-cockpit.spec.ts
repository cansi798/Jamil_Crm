import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kennzahlen-Cockpit (Jamil msg 2858): sieben Karten mit Formel und „Warum wichtig?“, Zeitraum umschalten,
 * Zahlungsdauer mit „Daten fehlen“; Menü „Auswertungen → Kennzahlen“. Nur in der Vorschau mit Testmodus.
 */
test('Chef: Kennzahlen-Cockpit mit Zeitraum, Formeln und fehlenden Daten', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/auswertung/kennzahlen');
	await expect(page.getByRole('heading', { level: 1, name: 'Kennzahlen' })).toBeVisible();
	const karten = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
	await expect(karten).toHaveCount(7);
	const zahlung = karten.filter({ hasText: 'Durchschnittliche Zahlungsdauer' });
	await expect(zahlung).toContainText('Lexware');
	const quote = karten.filter({ hasText: 'Angebots-Abschlussquote' });
	await expect(quote).toContainText('Beauftragte Angebote / abgegebene Angebote');
	await quote.getByText('Warum wichtig?').click();
	await expect(quote).toContainText('Zeigt, ob Preise, Auftreten und Qualifizierung passen.');
	await page.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link', { name: 'Dieser Monat' }).click();
	await expect(page).toHaveURL(/zeitraum=monat/);
	await expect(karten).toHaveCount(7);
	await erwarteKeinQuerScrollen(page, viewport.width);
	await ctx.close();
});
