import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026): einen Mitarbeiter erfassen, Ergebnis und Rechenweg prüfen,
 * wieder entfernen. Die Seite braucht „Preise sehen“ + „Einstellungen“; der Seed-Chef hat Zwei-Faktor, deshalb meldet
 * sich der Test mit dem Testzugang „can.chef“ an (nur im Testmodus der Vorschau).
 * Die Firmenwerte des Betriebs „Bauwelt“ pflegen Can und Jamil selbst – der Test ändert sie NIE. Die genauen Zahlen
 * prüfen tests/unit/kalkulation.test.ts und tests/db/kalkulation.test.ts.
 */
test('Kalkulation: Mitarbeiter erfassen, Ergebnis und Rechenweg, entfernen', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus (Chef ohne Zwei-Faktor)');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/kalkulation');
	await expect(page.getByRole('heading', { name: 'Kalkulation / Stundensatz' })).toBeVisible();
	const name = `E2E ${info.project.name} ${Date.now()}`;

	const neu = page.locator('details.kk-neu');
	if ((await neu.getAttribute('open')) === null) await neu.locator('summary').click();
	const f = neu.locator('form');
	await f.locator('input[name="name"]').fill(name);
	await f.locator('input[name="brutto"]').fill('42.000');
	await f.locator('select[name="agArt"]').selectOption('prozent');
	await f.locator('input[name="agProzent"]').fill('21');
	await f.locator('input[name="wochenstunden"]').fill('40');
	await f.locator('input[name="urlaubstage"]').fill('30');
	await f.locator('input[name="krankheitstage"]').fill('10');
	await f.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();

	const ergebnis = page.getByLabel(`Ergebnis ${name}`);
	try {
		await expect(ergebnis).toContainText('h/Jahr');
		await expect(ergebnis).toContainText('Untergrenze (kostendeckend)');
		await expect(ergebnis).toContainText(/Empfohlen/);
		const karte = page.locator('.karte').filter({ has: ergebnis });
		await karte.getByText('So wird gerechnet').click();
		await expect(karte.getByRole('cell', { name: '= Fakturierbare Stunden' })).toBeVisible();
		await expect(karte.getByRole('cell', { name: '42.000,00 €' })).toBeVisible();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	} finally {
		const karte = page.locator('.karte').filter({ has: page.getByLabel(`Ergebnis ${name}`) });
		if (await karte.count()) {
			await karte.getByText('Bearbeiten').click();
			await karte.getByRole('button', { name: 'Mitarbeiter entfernen' }).click();
		}
	}
	await expect(page.getByLabel(`Ergebnis ${name}`)).toHaveCount(0);
});
