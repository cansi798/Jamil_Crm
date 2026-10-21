import { expect, test, type Page } from '@playwright/test';

/**
 * Vorschau Mail-Vorlagen und Signatur (Jamil msg 2670), Auftragsquellen mit Farben (2672), Abzeichen und Filter
 * „Nachfassen fällig“ (2674). Chef im Testmodus; es wird nichts gespeichert (Vorlagen und Farben bleiben, wie sie sind).
 */
async function chef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
}

test('Mail-Vorlage: Live-Vorschau mit Betreff, Beispieldaten, Handy-Breite, Klartext; Vorlage kann kein Skript ausführen', async ({ page }) => {
	await chef(page);
	// Seit msg 2789: alle Vorlagen in Einstellungen → E-Mail-Vorlagen (je Zweck eine Liste, immer mit Standard);
	// seit msg 3086 wie alle Vorlagen: Liste → Detailseite mit Editor und Vorschau
	await page.goto('/einstellungen/mail-vorlagen');
	const liste = page.getByRole('list', { name: 'Vorlagen Nachfassen Angebot' });
	await expect(liste.getByText('Standard')).toBeVisible();
	await liste.getByRole('link').first().click();
	await page.waitForURL(/\/einstellungen\/mail-vorlagen\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('button', { name: 'Vorlage löschen' })).toBeVisible();
	const form = page.locator('form[action="?/vorlage"]');
	const vorschau = form.getByRole('region', { name: /^Vorschau / });
	await expect(vorschau).toBeVisible();

	const frame = vorschau.locator('iframe');
	await expect(frame).toHaveAttribute('sandbox', '');
	await form.getByLabel('Betreff').fill('Test {{angebot.nummer}} für {{kunde.name}}');
	await expect(vorschau.locator('.mv-betreff')).toHaveText('Test AN-2026-0042 für Familie Müller');
	// unbekannter Platzhalter wird sofort markiert
	await form.getByLabel('Betreff').fill('Test {{kunde.nmae}}');
	await expect(form.getByRole('alert')).toContainText('{{kunde.nmae}}');
	await form.getByLabel('Betreff').fill('Test {{angebot.nummer}} für {{kunde.name}}');
	await expect(form.getByRole('alert')).toHaveCount(0);

	// Skript in der Vorlage: läuft nicht (sandbox ohne allow-scripts + CSP), App bleibt unberührt
	const html = form.getByLabel('Text (HTML)');
	await html.fill('<p>Hallo {{kunde.name}}</p><script>parent.document.title="GEHACKT"</script><img src="x" onerror="parent.document.title=\'GEHACKT\'">');
	await expect(frame).toHaveAttribute('srcdoc', /Hallo Familie Müller/);
	await expect(form.frameLocator('iframe[sandbox=""]').getByText('Hallo Familie Müller')).toBeVisible();
	await page.waitForTimeout(500);
	expect(await page.title()).not.toBe('GEHACKT');

	await vorschau.getByRole('button', { name: 'Handy' }).click();
	await expect(vorschau.locator('.mv-mail')).toHaveClass(/mobil/);
	await vorschau.getByRole('button', { name: 'Klartext' }).click();
	await expect(vorschau.getByLabel(/\(Klartext\)$/)).toContainText('Hallo Familie Müller');
	const daten = vorschau.getByLabel('Beispieldaten für die Vorschau');
	if ((await daten.locator('option').count()) > 1) {
		await daten.selectOption({ index: 1 });
		await expect(vorschau.getByLabel(/\(Klartext\)$/)).not.toContainText('Familie Müller');
	}
	// Signatur hat dieselbe Vorschau (Liste); nichts gespeichert – Seite ohne Speichern verlassen
	await page.goto('/einstellungen/mail-vorlagen');
	await expect(page.getByRole('region', { name: 'Vorschau Signatur' }).locator('iframe')).toHaveAttribute('sandbox', '');
});

test('Auftragsquellen: Farbwahl je Eintrag; Aufträge: Filter „Nachfassen fällig“', async ({ page }) => {
	await chef(page);
	await page.goto('/einstellungen/quellen');
	await expect(page.getByRole('heading', { level: 1, name: 'Auftragsquellen' })).toBeVisible();
	await expect(page.getByLabel('Farbe Hornbach')).toHaveAttribute('type', 'color');
	await expect(page.locator('.aq-etikett', { hasText: 'Hornbach' }).first()).toBeVisible();

	await page.goto('/auftraege?ansicht=liste');
	const filter = page.getByRole('link', { name: '↻ Nachfassen fällig' });
	await filter.click();
	await expect(page).toHaveURL(/nachfassen=faellig/);
	await expect(page.getByRole('link', { name: '↻ Nachfassen fällig' })).toHaveAttribute('aria-current', 'page');
	await page.getByRole('link', { name: '↻ Nachfassen fällig' }).click();
	await expect(page).not.toHaveURL(/nachfassen=faellig/);
});
