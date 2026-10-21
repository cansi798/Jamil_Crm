import { expect, test } from '@playwright/test';

/**
 * Nachfassen (Jamil msgs 2585, 2633, 2636) mit der Vorlagen-Bibliothek (msg 2789): Mail-Vorlage „Zahlungserinnerung“
 * mit Vorschau in Einstellungen → E-Mail-Vorlagen anlegen, in einer Rechnungs-Stufe auswählen, beides wieder löschen.
 * Ändert die Stufen für Angebote des Betriebs NICHT. Braucht den Testmodus (Chef ohne Zwei-Faktor).
 */
test('Nachfassen: Vorlage in der Bibliothek anlegen, in einer Rechnungs-Stufe wählen, beides löschen', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const name = `E2E ${info.project.name} ${Date.now()}`;
	page.on('dialog', (d) => d.accept());

	try {
		await page.goto('/einstellungen/mail-vorlagen');
		await expect(page.getByRole('heading', { level: 1, name: 'E-Mail-Vorlagen' })).toBeVisible();
		await page.getByRole('link', { name: '+ Neue Vorlage' }).click();
		await page.waitForURL(/\/einstellungen\/mail-vorlagen\/neu/);
		const f = page.locator('form[action="?/vorlage"]');
		await f.locator('input[name="name"]').fill(name);
		await f.locator('select[name="zweck"]').selectOption('zahlungserinnerung');
		await f.locator('input[name="betreff"]').fill('Zahlungserinnerung {{angebot.nummer}}');
		await f.locator('textarea[name="html"]').fill('<p>{{kunde.anrede}},</p><p>bitte überweisen Sie {{betrag}} bis {{faellig_am}}.</p>');
		// Vorschau mit Beispieldaten (iframe ohne Skripte)
		const vorschau = f.frameLocator('iframe');
		await expect(vorschau.locator('body')).toContainText('Sehr geehrte Familie Müller');
		await expect(vorschau.locator('body')).toContainText('12.480,00');
		await f.getByRole('button', { name: 'Vorlage anlegen' }).click();
		await page.waitForURL(/\/einstellungen\/mail-vorlagen\/[0-9a-f-]{36}\?angelegt=1$/);
		await page.goto('/einstellungen/mail-vorlagen');
		await expect(page.getByRole('list', { name: 'Vorlagen Zahlungserinnerung / Mahnung' }).locator('li', { hasText: name })).toBeVisible();

		// Rechnungs-Stufe: Tag 10, Mail mit dieser Vorlage + Aufgabe
		await page.goto('/einstellungen/nachfassen');
		const rechnungen = page.locator('.karte', { hasText: 'Rechnungen gibt es im CRM noch nicht' });
		await rechnungen.getByRole('button', { name: 'Stufe hinzufügen' }).click();
		const s = rechnungen.locator('form[action="?/stufe"]').last();
		await s.locator('input[name="tage"]').fill('10');
		await s.locator('input[name="mail"]').check();
		await s.locator('select[name="mailVorlageId"]').selectOption({ label: name });
		await s.locator('input[name="todoTitel"]').fill(`${name}: Zahlung prüfen`);
		await s.getByRole('button', { name: 'Stufe hinzufügen' }).click();
		await expect(rechnungen.getByRole('list', { name: 'Stufen Rechnung' })).toContainText(`Mail „${name}“`);
	} finally {
		await page.goto('/einstellungen/nachfassen');
		const st = page.getByRole('list', { name: 'Stufen Rechnung' }).locator('li', { hasText: name });
		if (await st.count()) {
			await st.locator('summary').first().click();
			await st.getByRole('button', { name: 'Stufe löschen' }).click();
			await expect(st).toHaveCount(0);
		}
		await page.goto('/einstellungen/mail-vorlagen');
		const v = page.getByRole('link', { name: new RegExp(name) });
		if (await v.count()) {
			// Löschen oben rechts mit Rückfrage (msgs 3043, 3091)
			await v.first().click();
			await page.getByRole('button', { name: 'Vorlage löschen' }).click();
			await page.getByRole('button', { name: 'Endgültig löschen' }).click();
			await page.waitForURL(/\/einstellungen\/mail-vorlagen$/);
			await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
		}
	}
});
