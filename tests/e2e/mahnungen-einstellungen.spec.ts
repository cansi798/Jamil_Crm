import { expect, test } from '@playwright/test';
import { anmelden, bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Einstellungen → Mahnungen (Lexware Phase 3, Jamil #6093): Vorschlag übernehmen (vier Stufen), Zahlungsziel speichern
 * und wieder herstellen, eine Stufe mit Rückfrage löschen und wieder anlegen. Schreibt Einstellungen → nur Testserver.
 */
nurAufTestserver(test);

test('Mahnstufen: Vorschlag, Zahlungsziel speichern, Stufe löschen mit Rückfrage', async ({ page }, info) => {
	await anmelden(page, 'can.chef');
	await page.goto('/einstellungen/mahnungen');
	await expect(page.getByRole('heading', { name: 'Zahlungserinnerung und Mahnungen' })).toBeVisible();
	await erwarteKeinQuerScrollen(page, info.project.name === 'mobil' ? 390 : 1280);

	const stufen = page.getByRole('list', { name: 'Mahnstufen' }).locator(':scope > li');
	// Vorschlag nur, solange es keine Stufen gibt (frische Testdatenbank)
	const vorschlag = page.getByTestId('mahn-standard');
	if (await vorschlag.isVisible()) {
		await vorschlag.click();
		await expect(vorschlag).toHaveCount(0);
	}
	await expect(stufen.first()).toContainText('3 Tage nach Fälligkeit');
	// Läuft je Projekt (mobil, Desktop) gegen dieselbe Datenbank – deshalb relativ zählen
	const anzahl = await stufen.count();
	expect(anzahl).toBeGreaterThanOrEqual(2);

	// Zahlungsziel ändern, nach Neuladen noch da, dann zurück
	const ziel = page.getByLabel('Zahlungsziel neuer Rechnungen (Tage)');
	const vorher = await ziel.inputValue();
	const neu = vorher === '21' ? '20' : '21';
	await ziel.fill(neu);
	await page.getByRole('button', { name: 'Speichern' }).last().click();
	await page.reload();
	await expect(page.getByLabel('Zahlungsziel neuer Rechnungen (Tage)')).toHaveValue(neu);
	await page.getByLabel('Zahlungsziel neuer Rechnungen (Tage)').fill(vorher);
	await page.getByRole('button', { name: 'Speichern' }).last().click();
	await page.reload();
	await expect(page.getByLabel('Zahlungsziel neuer Rechnungen (Tage)')).toHaveValue(vorher);

	// Letzte Stufe löschen: Rückfrage abbrechen → bleibt; bestätigen → weg
	const letzte = stufen.last();
	await letzte.locator('summary').click();
	await letzte.getByRole('button', { name: 'Stufe löschen' }).click();
	await page.getByTestId('rueckfrage').getByRole('button', { name: 'Abbrechen' }).click();
	await expect(stufen).toHaveCount(anzahl);
	await letzte.getByRole('button', { name: 'Stufe löschen' }).click();
	await bestaetigen(page);
	await expect(stufen).toHaveCount(anzahl - 1);
});
