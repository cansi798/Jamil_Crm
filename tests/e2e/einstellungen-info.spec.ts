import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Info-Fenster ⓘ, Funktionen & Automatisierungen, Was ist neu, Menü nach dem Weg des Kunden (Jamil, Talk msg 3423).
 * Schaltet einen Schalter um und wieder zurück → nie gegen die Vorschau.
 */
nurAufTestserver(test);

test('ⓘ erklärt die Einstellung, Funktionen-Übersicht, Was ist neu', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	const breite = mobil ? 390 : 1280;
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	// Info-Fenster: Tipp öffnet, Esc schließt und gibt den Fokus zurück
	await page.goto('/einstellungen/kundenportal');
	const seite = page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Kundenportal & Auftragsbestätigung/ });
	await seite.click();
	const fenster = page.getByTestId('info-fenster');
	await expect(fenster).toBeVisible();
	for (const t of ['Was sie verändert', 'Wirkt auf', 'Standard', 'Beispiel']) await expect(fenster).toContainText(t);
	await page.keyboard.press('Escape');
	await expect(fenster).toHaveCount(0);
	await expect(seite).toBeFocused();
	// an einem Schalter und einem Abschnitt; ⓘ im Formular löst keinen Schalter aus
	await page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Auftragsbestätigung automatisch/ }).click();
	await expect(page.getByTestId('info-fenster')).toContainText('Auftragsbestätigung');
	await page.locator('main').click({ position: { x: 4, y: 4 } }); // Klick daneben schließt
	await expect(page.getByTestId('info-fenster')).toHaveCount(0);
	// nie breiter als der Bildschirm, Tippfläche mindestens 44 px
	await page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Auftragsbestätigung automatisch/ }).click();
	const box = await page.getByTestId('info-fenster').boundingBox();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(breite);
	const knopfOrt = page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Auftragsbestätigung automatisch/ });
	await expect(knopfOrt).toBeVisible();
	const knopf = await knopfOrt.boundingBox();
	expect(knopf!.width).toBeGreaterThanOrEqual(44);
	expect(knopf!.height).toBeGreaterThanOrEqual(44);
	await page.keyboard.press('Escape');

	// Funktionen & Automatisierungen: nach dem Kundenweg, Schalter an/aus
	await page.goto('/einstellungen/funktionen');
	await expect(page.getByRole('heading', { name: 'Funktionen & Automatisierungen', level: 1 })).toBeVisible();
	for (const g of ['1. Anfrage', '2. Angebot', '3. Auftrag', '4. Abschluss', '5. Danach']) await expect(page.getByRole('heading', { name: g })).toBeVisible();
	const zeile = page.locator('[data-funktion="bestandskarte"]');
	const schalter = zeile.getByRole('switch');
	await expect(schalter).toHaveAttribute('aria-checked', 'true');
	await schalter.click();
	await expect(zeile.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
	await page.reload();
	await expect(page.locator('[data-funktion="bestandskarte"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
	// die Einstellungsseite zeigt dasselbe
	await page.goto('/einstellungen/bestandskunden');
	await expect(page.getByRole('checkbox', { name: /Karte im Kundenportal anzeigen/ })).not.toBeChecked();
	// zurückschalten
	await page.goto('/einstellungen/funktionen');
	await page.locator('[data-funktion="bestandskarte"]').getByRole('switch').click();
	await expect(page.locator('[data-funktion="bestandskarte"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
	await page.locator('[data-funktion="bestandskarte"]').getByRole('link', { name: 'Einstellen' }).click();
	await expect(page).toHaveURL(/\/einstellungen\/bestandskunden$/);
	await page.goto('/einstellungen/funktionen');
	await erwarteKeinQuerScrollen(page, breite);

	// Was ist neu
	await page.goto('/neu');
	await expect(page.getByRole('heading', { name: 'Was ist neu', level: 1 })).toBeVisible();
	await expect(page.getByTestId('neuigkeit').first()).toContainText('Zu finden');
	await erwarteKeinQuerScrollen(page, breite);

	// Menü nach dem Weg des Kunden (Seitenleiste am Desktop)
	if (!mobil) {
		const nav = page.getByRole('navigation').first();
		for (const t of ['Anfrage', 'Angebot', 'Auftrag', 'Abschluss & danach']) await expect(nav.getByText(t, { exact: true })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Terminarten' })).toBeVisible();
	}
});
