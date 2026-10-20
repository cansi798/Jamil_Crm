import { expect, test } from '@playwright/test';

/**
 * Einstellungen → Nachfassen (Jamil msgs 2585, 2633, 2636): Mail-Vorlage mit Vorschau anlegen, eine Rechnungs-Stufe
 * anlegen, beides wieder löschen. Ändert die Stufen für Angebote des Betriebs NICHT. Braucht den Testmodus (Chef ohne
 * Zwei-Faktor); die Logik prüfen tests/unit/nachfassen.test.ts und tests/db/nachfassen.test.ts.
 */
test('Nachfassen: Vorlage mit Vorschau und Rechnungs-Stufe anlegen und löschen', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/einstellungen/nachfassen');
	await expect(page.getByRole('heading', { name: 'Automatisch nachfassen' })).toBeVisible();
	const name = `E2E ${info.project.name} ${Date.now()}`;

	try {
		await page.getByRole('button', { name: 'Vorlage hinzufügen' }).click();
		const f = page.locator('form[action="?/vorlage"]').filter({ hasNot: page.locator('input[name="id"]') });
		await f.locator('input[name="name"]').fill(name);
		await f.locator('input[name="betreff"]').fill('Ihr Angebot {{angebot.nummer}}');
		await f.locator('textarea[name="html"]').fill('<p>{{kunde.anrede}},</p><p>Angebot {{angebot.nummer}} über {{betrag}}</p>');
		// Vorschau mit Beispieldaten (iframe ohne Skripte)
		const vorschau = f.frameLocator('iframe');
		await expect(vorschau.locator('body')).toContainText('Sehr geehrte Familie Müller');
		await expect(vorschau.locator('body')).toContainText('AN-2026-0042');
		await f.getByRole('button', { name: 'Vorlage anlegen' }).click();
		const v = page.getByRole('list', { name: 'Mail-Vorlagen', exact: true }).locator('li', { hasText: name });
		await expect(v).toBeVisible();

		// Rechnungs-Stufe: Tag 10, To-do
		const rechnungen = page.locator('.karte', { hasText: 'Rechnungen gibt es im CRM noch nicht' });
		await rechnungen.getByRole('button', { name: 'Stufe hinzufügen' }).click();
		const s = rechnungen.locator('form[action="?/stufe"]').last();
		await s.locator('input[name="tage"]').fill('10');
		await s.locator('input[name="todoTitel"]').fill(`${name}: Zahlung prüfen`);
		await s.getByRole('button', { name: 'Stufe hinzufügen' }).click();
		await expect(rechnungen.getByRole('list', { name: 'Stufen Rechnung' })).toContainText(`${name}: Zahlung prüfen`);
	} finally {
		const st = page.getByRole('list', { name: 'Stufen Rechnung' }).locator('li', { hasText: name });
		if (await st.count()) {
			await st.locator('summary').first().click();
			await st.getByRole('button', { name: 'Stufe löschen' }).click();
			await expect(st).toHaveCount(0);
		}
		const v = page.getByRole('list', { name: 'Mail-Vorlagen', exact: true }).locator('li', { hasText: name });
		if (await v.count()) {
			await v.locator('summary').first().click();
			await v.getByRole('button', { name: 'Vorlage löschen' }).click();
			await expect(v).toHaveCount(0);
		}
	}
});
