import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kalkulation v2 (Wünsche Jamil, msgs 2515/2516): eine Kostenzeile und einen Mitarbeiter erfassen, in Liste und
 * Rechenweg sehen, wieder entfernen. Die Seite braucht „Preise sehen“ + „Einstellungen“; der Seed-Chef hat
 * Zwei-Faktor, deshalb meldet sich der Test mit dem Testzugang „can.chef“ an (nur im Testmodus der Vorschau).
 * Die Werte des Betriebs „Bauwelt“ pflegen Can und Jamil selbst – der Test ändert sie NIE (auch kein „Beispiel laden“).
 * Die genauen Zahlen prüfen tests/unit/kalkulation.test.ts und tests/db/kalkulation.test.ts.
 */
test('Kalkulation v2: Kostenzeile und Mitarbeiter erfassen, Rechenweg, wieder entfernen', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus (Chef ohne Zwei-Faktor)');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/kalkulation');
	await expect(page.getByRole('heading', { name: 'Kalkulation / Stundensatz' })).toBeVisible();
	await expect(page.getByLabel('Verrechnungssatz')).toBeVisible();
	const name = `E2E ${info.project.name} ${Date.now()}`;

	try {
		// Kostenzeile (eingeklappt bis „Kostenzeile hinzufügen“)
		await page.getByRole('button', { name: 'Kostenzeile hinzufügen' }).click();
		const k = page.locator('form[action="?/kostenNeu"]');
		await k.locator('input[name="name"]').fill(`${name} Transporter`);
		await k.locator('select[name="kategorie"]').selectOption('fahrzeug');
		await k.locator('input[name="betrag"]').fill('36.000');
		await k.locator('select[name="intervall"]').selectOption('einmalig');
		await k.locator('input[name="abschreibungMonate"]').fill('72');
		await k.getByRole('button', { name: 'Kostenzeile hinzufügen' }).click();
		const zeile = page.getByRole('list', { name: 'Kostenzeilen', exact: true }).locator('li', { hasText: `${name} Transporter` });
		await expect(zeile).toContainText('Fahrzeug');
		await expect(zeile).toContainText('6.000,00 €/Jahr');

		// Mitarbeiter mit eigenen Tagen/Stunden
		await page.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();
		const m = page.locator('form[action="?/mitarbeiterNeu"]');
		await m.locator('input[name="name"]').fill(name);
		await m.locator('input[name="brutto"]').fill('36.000');
		await m.locator('input[name="agProzent"]').fill('20');
		await m.locator('input[name="tageJahr"]').fill('200');
		await m.locator('input[name="stundenTag"]').fill('7,5');
		await m.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();
		const ergebnis = page.getByLabel(`Ergebnis ${name}`);
		await expect(ergebnis).toContainText('200 Tage × 7,5 h');
		await expect(ergebnis).toContainText('1.500 h/Jahr');
		await expect(ergebnis).toContainText('43.200,00 €/Jahr');
		// Satz je Mitarbeiter (msgs 2998/3000/3002): eigene Zeile bzw. Karte mit Tages- und Stundensatz
		const satzZeile = page.getByRole('table', { name: 'Satz je Mitarbeiter' }).locator(`tr[data-mitarbeiter="${name}"]`);
		await expect(satzZeile).toContainText('43.200,00 €/Jahr');
		await expect(satzZeile).toContainText('200 × 7,5 h');
		await expect(satzZeile).toContainText('€/Tag');
		await expect(satzZeile).toContainText('€/h');
		await expect(page.getByRole('table', { name: 'Satz je Mitarbeiter' })).toContainText('Mischsatz (Durchschnitt)');
		await expect(page.getByText('Verrechenbare Stunden pro Tag (Standard)')).toBeVisible();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);

		await page.getByText('So wird gerechnet').click();
		await expect(page.getByRole('cell', { name: '= Kosten-Stundensatz' })).toBeVisible();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	} finally {
		for (const [liste, text, knopf] of [
			['Mitarbeiter', name, 'Mitarbeiter entfernen'],
			['Kostenzeilen', `${name} Transporter`, 'Zeile löschen']
		] as const) {
			const li = page.getByRole('list', { name: liste, exact: true }).locator('li', { hasText: text });
			if (await li.count()) {
				await li.locator('summary').click();
				await li.getByRole('button', { name: knopf }).click();
				await expect(li).toHaveCount(0);
			}
		}
	}
});
