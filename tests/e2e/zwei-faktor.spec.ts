import { expect, test } from '@playwright/test';
import { anmelden, anmeldenAlsAdmin, hauptnavigation } from './hilfe';

// Ein Code gilt nur einmal (Schutz vor Wiederverwendung): Die Admin-Anmeldung läuft nur im Desktop-Projekt.
test.describe('Zwei-Faktor-Anmeldung', () => {
	test('Chef: Einrichtungsseite ist mit Vor-Sitzung erreichbar, ohne Navigation', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'einmal genügt');
		await anmelden(page, 'chef@bauwelt.test');
		// Ist die Zwei-Faktor-Anmeldung schon eingerichtet (z. B. von Hand), kommt die Code-Seite.
		await expect(page).toHaveURL(/\/(konto\/zwei-faktor|anmelden\/zweiter-faktor)$/);
		if (page.url().endsWith('/konto/zwei-faktor')) {
			await expect(page.getByRole('heading', { name: 'Zwei-Faktor-Anmeldung einrichten' })).toBeVisible();
			await expect(page.getByRole('img', { name: 'QR-Code für die Authenticator-App' })).toBeVisible();
		}
		// Vor-Sitzung ist keine Anmeldung: keine Navigation, fachliche Seiten bleiben gesperrt
		await expect(hauptnavigation(page)).toHaveCount(0);
		await page.goto('/kunden');
		await expect(page).toHaveURL(/\/anmelden$/);
	});

	test('Plattform-Admin: Anmeldung mit echtem TOTP-Code führt in die Plattform-Verwaltung', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'ein Code gilt nur einmal');
		await anmeldenAlsAdmin(page);
		await expect(page).toHaveURL(/\/admin$/);
		await expect(page.getByRole('heading', { name: 'Betriebe', exact: true })).toBeVisible();
		await expect(page.getByText('Bauwelt').first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();
	});
});
