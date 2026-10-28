import { expect, test, type Page } from '@playwright/test';
import { bestaetigen, erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Runde vom 28.10. (Jamil msgs 3521–3535): Infos in der Kundenzeile + Sortierung, Ausgangsbelege und dezentes Kundenportal am Auftrag,
 * Verlauf mit eigenem Scrollbereich, Kundenakte „Automatik“, Aufgaben ohne Lautstärke/Schmutz mit Unteraufgaben und Personen auf der
 * Karte, Protokoll- & Aufmaß-Vorlagen mit Reitern, Bestandskunden in den Kundenportal-Einstellungen. Legt eine Aufgabe an und löscht
 * sie wieder → nie gegen die Vorschau.
 */
nurAufTestserver(test);

async function chef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
}

test('Kundenliste, Auftrag, Kundenakte, Vorlagen, Kundenportal-Einstellungen', async ({ page }, info) => {
	const breite = info.project.name === 'mobil' ? 390 : 1280;
	await chef(page);

	// Kundenliste: Abzeichen in der Zeile (Seed: „Badsanierung“ in Arbeit + „Dachrinne“ abgerechnet beim selben Kunden)
	await page.goto('/kunden');
	const hinweise = page.getByTestId('kunden-hinweise');
	await expect(hinweise.first()).toBeVisible();
	await expect(page.locator('[data-art="bestand"]').first()).toContainText('Bestandskunde');
	await expect(page.locator('[data-art="auftraege"]').first()).toContainText(/offene/);
	await expect(page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Infos in der Kundenzeile/ })).toBeVisible();
	// Sortieren nach nächstem Termin (Auswahl in der Filterleiste, schickt sofort ab)
	await page.getByRole('combobox', { name: /Sortieren/ }).selectOption('termin');
	await expect(page).toHaveURL(/sortierung=termin/);
	await erwarteKeinQuerScrollen(page, breite);

	// Auftrag: rechts „Ausgangsbelege“ (Angebote + Auftragsbestätigungen), Kundenportal dezent, Verlauf scrollt in sich
	await page.goto('/auftraege?ansicht=liste&suche=Ladenumbau');
	const href = await page.locator('a[href^="/auftraege/"]').evaluateAll((l) => l.map((a) => a.getAttribute('href')).find((h) => /^\/auftraege\/[0-9a-f-]{36}$/.test(h ?? '')));
	test.skip(!href, 'Seed-Auftrag fehlt');
	await page.goto(href!);
	const belege = page.locator('#ausgangsbelege');
	await expect(belege.getByRole('heading', { name: 'Ausgangsbelege' })).toBeVisible();
	await expect(belege.locator('[data-typ="angebot"]').first()).toContainText('Angebot');
	await expect(page.getByRole('heading', { name: 'Angebote', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('portal-status-auftrag')).toContainText(/Kundenportal/);
	const verlauf = page.getByRole('region', { name: 'Verlauf des Auftrags' });
	await expect(verlauf).toHaveAttribute('tabindex', '0');
	expect(await verlauf.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
	await erwarteKeinQuerScrollen(page, breite);

	// Kundenakte: Abschnitt „Automatik“ mit der Auftragsbestätigung (ohne Kundenportal-Block)
	await page.getByRole('link', { name: /beim Kunden einstellen/ }).first().click();
	await expect(page).toHaveURL(/#automatik$/);
	const automatik = page.locator('#automatik');
	await expect(automatik.getByRole('combobox', { name: /Auftragsbestätigung automatisch erstellen/ })).toBeVisible();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /Auftragsbestätigung/ })).toHaveCount(0);
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /Leistungen für Bestandskunden/ })).toBeVisible();
	await expect(page.getByTestId('portal-einstellung').getByRole('combobox', { name: /Projektbegleiter/ })).toBeVisible();

	// Protokoll- & Aufmaß-Vorlagen: ein Menüpunkt, zwei Reiter
	await page.goto('/einstellungen/protokoll-vorlagen');
	await expect(page.getByRole('heading', { name: 'Protokoll- & Aufmaß-Vorlagen', level: 1 })).toBeAttached();
	await page.getByRole('link', { name: 'Aufmaße', exact: true }).click();
	await expect(page).toHaveURL(/\/einstellungen\/aufmass-vorlagen$/);
	if (info.project.name === 'desktop') {
		const markiert = page.locator('.hauptnav a[aria-current="page"]:visible');
		await expect(markiert).toHaveCount(1);
		await expect(markiert).toContainText('Protokoll- & Aufmaß-Vorlagen');
	}

	// Kundenportal-Einstellungen: Bestandskunden-Abschnitt mit „Wann erscheint die Karte?“
	await page.goto('/einstellungen/kundenportal#bestandskunden');
	await expect(page.getByRole('heading', { name: 'Leistungen für Bestandskunden', level: 2 })).toBeVisible();
	await expect(page.getByRole('combobox', { name: /Wann erscheint die Karte/ })).toHaveValue('abgerechnet');
});

test('Aufgaben: direkte Aufgabe ohne Lautstärke/Schmutz, Unteraufgaben, Person auf der Karte', async ({ page }) => {
	await chef(page);
	await page.goto('/todos?person=alle');
	const titel = `E2E Unteraufgaben ${Date.now()}`;
	await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
	const formular = page.locator('form.td-neu');
	await formular.getByLabel('Neue Aufgabe').fill(titel);
	await expect(formular.getByText('Lautstärke')).toHaveCount(0);
	await formular.getByRole('button', { name: 'Aufgabe speichern' }).click();
	const karte = page.locator('.kanban-karte', { hasText: titel });
	await expect(karte).toBeVisible();

	// Bearbeiten: keine Lautstärke/Schmutz (Aufgabe ohne Auftrag), Unteraufgabe anlegen und abhaken
	await karte.getByText('Bearbeiten').click();
	await expect(karte.getByRole('combobox', { name: 'Lautstärke' })).toHaveCount(0);
	const ua = karte.getByTestId('unteraufgaben');
	await ua.getByRole('textbox', { name: /Neue Unteraufgabe/ }).fill('Schlüssel holen');
	await ua.getByRole('button', { name: '+ Hinzufügen' }).click();
	await expect(page.locator('.kanban-karte', { hasText: titel })).toContainText('0/1 Unteraufgaben');
	const karte2 = page.locator('.kanban-karte', { hasText: titel });
	if (!(await karte2.getByTestId('unteraufgaben').isVisible())) await karte2.getByText('Bearbeiten').click();
	await karte2.getByTestId('unteraufgaben').getByRole('checkbox', { name: 'Schlüssel holen' }).click();
	await expect(page.locator('.kanban-karte', { hasText: titel })).toContainText('1/1 Unteraufgaben');

	// Person direkt auf der Karte zuweisen (PersonWahl speichert sofort beim Ankreuzen)
	const chip = page.locator('.kanban-karte', { hasText: titel }).getByRole('button', { name: new RegExp(`^Mitarbeiter für „${titel}“`) });
	await chip.click();
	const dialog = page.getByRole('dialog', { name: `Mitarbeiter für „${titel}“` });
	const vorher = await dialog.getByRole('checkbox', { checked: true }).count();
	await dialog.getByRole('checkbox', { checked: false }).first().check();
	if (await dialog.isVisible()) await page.keyboard.press('Escape');
	// gespeichert: nach dem Neuladen ist eine Person mehr angekreuzt
	await page.waitForLoadState('networkidle');
	await page.reload();
	await page.locator('.kanban-karte', { hasText: titel }).getByRole('button', { name: new RegExp(`^Mitarbeiter für „${titel}“`) }).click();
	await expect(page.getByRole('dialog', { name: `Mitarbeiter für „${titel}“` }).getByRole('checkbox', { checked: true })).toHaveCount(vorher + 1);
	await page.keyboard.press('Escape');

	// Aufräumen: Aufgabe in der Liste löschen
	await page.goto('/todos?person=alle&ansicht=liste');
	await page.getByRole('button', { name: titel }).first().click();
	await page.getByRole('button', { name: 'Löschen', exact: true }).click();
	await bestaetigen(page);
	await expect(page.getByText(titel)).toHaveCount(0);
});
