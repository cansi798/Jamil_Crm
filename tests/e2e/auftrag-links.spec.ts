import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen, bestaetigen } from './hilfe';

/**
 * Links am Auftrag (Jamil msg 2850): anlegen (ohne https://), Domain sehen, neuer Tab ohne Referrer, ungültige Adresse
 * abgelehnt, bearbeiten, entfernen. Nur in der Vorschau mit Testmodus; räumt seine Links selbst wieder ab.
 */
test('Chef: Link am Auftrag anlegen, öffnen, bearbeiten, entfernen', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/auftraege?ansicht=liste');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	await page.goto(href!);
	const karte = page.locator('#links');
	const titel = `E2E-Link ${info.project.name} ${Date.now()}`;

	// ungültig: javascript:
	await karte.getByRole('button', { name: 'Link hinzufügen' }).click();
	await karte.getByLabel('Webadresse').fill('javascript:alert(1)');
	await karte.getByRole('button', { name: 'Link speichern' }).click();
	await expect(karte.getByRole('alert')).toContainText('http');
	// gültig, ohne Schema
	await karte.getByLabel('Webadresse').fill('partner-portal.example.org/abnahme/42');
	await karte.getByLabel('Titel (optional)').fill(titel);
	await karte.getByLabel('Notiz (optional)').fill('Zugang beim Bauleiter');
	await karte.getByRole('button', { name: 'Link speichern' }).click();
	const link = karte.getByRole('link', { name: new RegExp(titel) });
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute('href', 'https://partner-portal.example.org/abnahme/42');
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', /noopener/);
	await expect(link).toHaveAttribute('rel', /noreferrer/);
	await expect(link).toContainText('partner-portal.example.org');
	await expect(karte.getByText('Zugang beim Bauleiter')).toBeVisible();
	await erwarteKeinQuerScrollen(page, viewport.width);

	// bearbeiten
	await karte.getByRole('button', { name: `Link „${titel}“ bearbeiten` }).click();
	await karte.getByLabel('Titel').fill(`${titel} neu`);
	await karte.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect(karte.getByRole('link', { name: new RegExp(`${titel} neu`) })).toBeVisible();
	// Verlauf
	await expect(page.getByText(`Link „${titel}“ (partner-portal.example.org) hinzugefügt`)).toBeVisible();

	// entfernen
	await karte.getByRole('button', { name: `Link „${titel} neu“ entfernen` }).click();
	await bestaetigen(page, 'Entfernen');
	await expect(karte.getByRole('link', { name: new RegExp(titel) })).toHaveCount(0);
	await ctx.close();
});
