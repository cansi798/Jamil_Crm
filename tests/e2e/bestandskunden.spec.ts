import { expect, test } from '@playwright/test';
import { bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Leistungen für Bestandskunden (Jamil, Talk msg 3408): Einstellungen mit Vorschau – Überschrift ändern, Leistung und
 * Knopf anlegen/verschieben/entfernen (mit Rückfrage), unsichere Links abweisen, speichern, ausschalten. Am Ende wieder
 * Standard. Schreibt Einstellungen → nie gegen die Vorschau.
 */
nurAufTestserver(test);

test('Einstellungen: bearbeiten, Vorschau, Link-Prüfung, speichern, zurücksetzen', async ({ page }, info) => {
	const breite = info.project.name === 'mobil' ? 390 : 1280;
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	await page.goto('/einstellungen/bestandskunden');
	await expect(page.getByRole('heading', { name: 'Leistungen für Bestandskunden', level: 1 })).toBeVisible();
	const vorschau = page.getByTestId('bestand-vorschau');
	await expect(vorschau.getByRole('heading', { name: 'Auch nach Abschluss für Sie da' })).toBeVisible();
	await expect(vorschau.getByTestId('bestand-leistungen').locator('li')).toHaveCount(6);
	await erwarteKeinQuerScrollen(page, breite);

	// Überschrift ändern → Vorschau folgt sofort
	await page.getByLabel('Überschrift').fill('E2E Wir bleiben für Sie da');
	await expect(vorschau.getByRole('heading', { name: 'E2E Wir bleiben für Sie da' })).toBeVisible();

	// Leistung hinzufügen, nach oben schieben, wieder entfernen (mit Rückfrage)
	await page.getByRole('button', { name: '+ Leistung hinzufügen' }).click();
	const zeilen = page.getByTestId('bestand-leistung');
	await expect(zeilen).toHaveCount(7);
	await zeilen.last().getByLabel('Titel *').fill('E2E Heizungswartung');
	await expect(vorschau).toContainText('E2E Heizungswartung');
	await page.getByRole('button', { name: 'Leistung 7 nach oben' }).click();
	await expect(zeilen.nth(5).getByLabel('Titel *')).toHaveValue('E2E Heizungswartung');
	await zeilen.nth(5).getByRole('button', { name: 'Entfernen' }).click();
	await bestaetigen(page, 'Entfernen');
	await expect(zeilen).toHaveCount(6);
	await expect(vorschau).not.toContainText('E2E Heizungswartung');

	// Knopf mit unsicherem Link wird abgewiesen, nichts gespeichert
	await page.getByRole('button', { name: '+ Knopf hinzufügen' }).click();
	const knopf = page.getByTestId('bestand-knopf').first();
	await knopf.getByLabel('Beschriftung *').fill('E2E Anfrage');
	await knopf.getByLabel('Link *').fill('javascript:alert(1)');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('alert')).toContainText('https://');
	await expect(vorschau.getByTestId('bestand-knoepfe')).toHaveCount(0); // ungültiger Link erscheint auch in der Vorschau nicht

	// gültiger Link: Vorschau zeigt den Knopf, öffnet in neuem Tab mit rel=noopener noreferrer
	await knopf.getByLabel('Link *').fill('https://www.beispiel.de/anfrage');
	const link = vorschau.getByRole('link', { name: 'E2E Anfrage' });
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');
	await page.reload();
	await expect(page.getByLabel('Überschrift')).toHaveValue('E2E Wir bleiben für Sie da');
	await expect(page.getByTestId('bestand-knopf').first().getByLabel('Link *')).toHaveValue('https://www.beispiel.de/anfrage');

	// Ausschalten: Vorschau gedimmt mit Hinweis
	await page.getByLabel('Karte im Kundenportal anzeigen').uncheck();
	await expect(page.getByText('Ausgeschaltet – Kunden sehen die Karte nicht.')).toBeVisible();
	await erwarteKeinQuerScrollen(page, breite);

	// zurück auf Standard und speichern (Testdaten aufräumen)
	await page.getByLabel('Karte im Kundenportal anzeigen').check();
	await page.getByRole('button', { name: 'Standard wiederherstellen' }).click();
	await bestaetigen(page, 'Zurücksetzen');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByRole('status')).toContainText('Gespeichert');
	await page.reload();
	await expect(page.getByLabel('Überschrift')).toHaveValue('Auch nach Abschluss für Sie da');
	await expect(page.getByTestId('bestand-knopf')).toHaveCount(0);
});
