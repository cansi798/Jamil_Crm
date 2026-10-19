import { expect, test } from '@playwright/test';
import { anmelden } from './hilfe';

const BUERO = 'buero@bauwelt.test';

// „+ To-do“ mit Beschreibung (Wunsch Jamil, 19.10.2026): Feld im Formular, Anzeige auf der Kanban-Karte.
// Legt ein To-do in der Entwicklungsdatenbank an und löscht es am Ende wieder.
test('„+ To-do“ mit Beschreibung → Beschreibung steht auf der Karte', async ({ page }) => {
	await anmelden(page, BUERO);
	await page.goto('/todos?nur=alle');
	const titel = `E2E-Beschreibung-${Date.now()}`;
	await page.getByRole('button', { name: 'To-do hinzufügen' }).click();
	const formular = page.locator('form.td-neu');
	await formular.getByLabel('Neues To-do').fill(titel);
	await formular.getByRole('button', { name: '+ Beschreibung' }).click();
	await formular.getByLabel('Beschreibung (optional)').fill('Schlüssel beim Nachbarn abholen');
	await formular.getByRole('button', { name: 'To-do speichern' }).click();

	const karte = page.locator('.kanban-karte', { hasText: titel });
	await expect(karte).toBeVisible();
	await expect(karte.locator('.karte-beschreibung')).toHaveText('Schlüssel beim Nachbarn abholen');
	// Nach dem Anlegen klappt das Formular zu; erneut geöffnet ist es leer
	await expect(formular).toHaveCount(0);
	await page.getByRole('button', { name: 'To-do hinzufügen' }).click();
	await expect(formular.getByLabel('Neues To-do')).toHaveValue('');
	await expect(formular.getByLabel('Beschreibung (optional)')).toHaveCount(0);

	const liste: { id: string; titel: string; beschreibung: string | null }[] = await (
		await page.request.get('/api/todos?nur=alle')
	).json();
	const neu = liste.find((t) => t.titel === titel);
	expect(neu?.beschreibung).toBe('Schlüssel beim Nachbarn abholen');
	expect((await page.request.delete(`/api/todos/${neu!.id}`)).status()).toBe(204);
});
