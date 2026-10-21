import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * „Mail an Kunden“ mit Vorlagen (Jamil msg 2789): am Kunden Vorlage wählen, Platzhalter gefüllt, mailto mit Betreff und
 * Text; nichts wird gespeichert oder versendet. Nur in der Vorschau mit Testmodus.
 */
test('Kunde: Mail an Kunden mit Vorlage öffnen und Vorlage wechseln', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/kunden');
	const href = await page.locator('a[href^="/kunden/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/kunden\/[0-9a-f-]{36}$/.test(h ?? '')));
	await page.goto(href!);

	await page.getByRole('button', { name: 'Mail an Kunden' }).click();
	const box = page.getByRole('region', { name: 'Mail an Kunden' });
	await expect(box).toBeVisible();
	const betreff = box.getByLabel('Betreff');
	await expect(betreff).not.toHaveValue('');
	await expect(box.getByLabel('Text')).not.toHaveValue(/\{\{/);
	// Vorlage wechseln: „Bitte um Bewertung“
	await box.locator('select').selectOption({ label: 'Bitte um Bewertung (Standard)' });
	await expect(betreff).toHaveValue('Wie zufrieden waren Sie?');
	const mailto = box.getByRole('link', { name: 'In Mailprogramm öffnen' });
	await expect(mailto).toHaveAttribute('href', /^mailto:.*subject=Wie%20zufrieden%20waren%20Sie%3F&body=/);
	// eigene Änderung landet im Link
	await betreff.fill('Kurze Frage');
	await expect(mailto).toHaveAttribute('href', /subject=Kurze%20Frage/);
	await erwarteKeinQuerScrollen(page, viewport.width);
	await ctx.close();
});
