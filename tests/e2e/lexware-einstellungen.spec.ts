import { expect, test } from '@playwright/test';
import { bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Einstellungen „Lexware verbinden“ und „E-Mail-Versand“ (Plan Lexware Phase 1). Braucht einen Probe-Server im Testmodus
 * mit Lexware-Attrappe (CRM_LEXWARE_URL=http://127.0.0.1:<port>, tests/hilfe/lexware-attrappe-start.ts) – nie die Vorschau.
 */
nurAufTestserver(test);
const SCHLUESSEL = 'gueltiger-testschluessel-0001';

test('Lexware verbinden: Schlüssel speichern → verbunden (Attrappe), nie wieder angezeigt; trennen mit Rückfrage', async ({ page }, info) => {
	const breite = info.project.name === 'mobil' ? 390 : 1280;
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/, { timeout: 20_000 }); // Anmeldung unter Last (wie hilfe.ts)

	await page.goto('/einstellungen/lexware');
	await expect(page.getByRole('heading', { name: 'Lexware verbinden' })).toBeVisible();
	// Rest eines abgebrochenen Laufs: erst trennen
	if (await page.getByRole('button', { name: 'Verbindung trennen' }).isVisible()) {
		await page.getByRole('button', { name: 'Verbindung trennen' }).click();
		await bestaetigen(page, 'Trennen');
	}
	await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();
	await page.getByLabel(/Schlüssel aus Lexware/).fill(SCHLUESSEL);
	await page.getByRole('button', { name: 'Speichern und verbinden' }).click();
	await expect(page.getByText('Bauwelt Testfirma GmbH').first()).toBeVisible();
	await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
	// Schlüssel steht nirgends auf der Seite, nur „…0001“
	expect(await page.content()).not.toContain(SCHLUESSEL);
	await expect(page.getByLabel(/Schlüssel aus Lexware/)).toHaveValue('');
	await expect(page.getByLabel(/Schlüssel aus Lexware/)).toHaveAttribute('placeholder', /…0001/);
	await expect(page.getByRole('button', { name: 'Lexware-Abgleich starten' })).toBeVisible();
	await erwarteKeinQuerScrollen(page, breite);
	// Abgleich einstellen → Warteschlange zeigt ihn
	await page.getByRole('button', { name: 'Lexware-Abgleich starten' }).click();
	await expect(page.getByText('Abgleich eingestellt')).toBeVisible();
	await page.getByRole('button', { name: 'Verbindung trennen' }).click();
	await bestaetigen(page, 'Trennen');
	await expect(page.getByText('Nicht verbunden', { exact: true })).toBeVisible();

	// E-Mail-Versand: speichern, Passwort nie zurück, Testmail in der Vorschau/im Testmodus gesperrt
	await page.goto('/einstellungen/mail');
	await page.getByLabel('Server (SMTP)').fill('smtp.ionos.de');
	await page.getByLabel('Port', { exact: true }).fill('587');
	await page.getByLabel('Benutzername', { exact: true }).fill('buero@bauwelt.test');
	await page.getByLabel('Passwort', { exact: true }).fill('Sehr-Geheim-123');
	await page.getByLabel('Absender-Adresse').fill('buero@bauwelt.test');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Gespeichert.')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');
	await expect(page.getByLabel('Passwort', { exact: true })).toHaveAttribute('placeholder', /…-123/);
	expect(await page.content()).not.toContain('Sehr-Geheim');
	// interner Server wird abgelehnt (SSRF-Schutz)
	await page.getByLabel('Server (SMTP)').fill('crm-db');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText(/nicht erlaubt/)).toBeVisible();
	await page.getByLabel('Testmail an').fill('can@bauwelt.test');
	await page.getByRole('button', { name: 'Testmail senden' }).click();
	await expect(page.getByText(/Testmodus: Es gehen keine echten Mails hinaus/)).toBeVisible();
	await erwarteKeinQuerScrollen(page, breite);
});
