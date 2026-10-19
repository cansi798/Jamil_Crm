import { expect, test, type Locator } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026): Firmenwerte und einen Mitarbeiter erfassen, Ergebnis und
 * Rechenweg prüfen. Die Seite braucht „Preise sehen“ + „Einstellungen“ (Chef). Der Seed-Chef hat Zwei-Faktor
 * (zwei-faktor.spec.ts), deshalb meldet sich der Test mit dem Testzugang „can.chef“ an – nur im Testmodus der Vorschau.
 * Die Firmenwerte gehören dem Betrieb „Bauwelt“, in dem auch Can und Jamil testen: Der Test merkt sie sich vorher und
 * stellt sie am Ende wieder her; seinen Mitarbeiter löscht er wieder.
 */
const FELDER = ['jahr', 'gemeinkosten', 'anzahlProduktiv', 'feiertage', 'pufferWert', 'gewinnProzent', 'risikoProzent', 'aktuellerSatz'];

async function leseFirma(firma: Locator) {
	const werte: Record<string, string> = {};
	for (const f of FELDER) werte[f] = await firma.locator(`input[name="${f}"]`).inputValue();
	werte.pufferArt = await firma.locator('select[name="pufferArt"]').inputValue();
	return werte;
}

async function setzeFirma(firma: Locator, werte: Record<string, string>) {
	for (const f of FELDER) await firma.locator(`input[name="${f}"]`).fill(werte[f]);
	await firma.locator('select[name="pufferArt"]').selectOption(werte.pufferArt);
	await firma.getByRole('button', { name: 'Firmenwerte speichern' }).click();
	await expect(firma.getByRole('alert')).toHaveCount(0);
}

test('Kalkulation: Firmenwerte, Mitarbeiter, Ergebnis und Rechenweg', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus (Chef ohne Zwei-Faktor)');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/kalkulation');
	await expect(page.getByRole('heading', { name: 'Kalkulation / Stundensatz' })).toBeVisible();
	const firma = page.locator('form[action="?/firma"]');
	const vorher = await leseFirma(firma);
	const name = `E2E ${info.project.name} ${Date.now()}`;
	try {
		// Firmenwerte (Beispiel aus der Anforderung)
		await setzeFirma(firma, {
			jahr: '2026',
			gemeinkosten: '60.000',
			anzahlProduktiv: '4',
			feiertage: '10',
			pufferArt: 'prozent',
			pufferWert: '15',
			gewinnProzent: '10',
			risikoProzent: '5',
			aktuellerSatz: '50'
		});
		await expect(firma.locator('input[name="gemeinkosten"]')).toHaveValue('60000,00');

		// Mitarbeiter
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
		await expect(ergebnis).toContainText('1.434,8 h/Jahr');
		await expect(ergebnis).toContainText('45,87');
		await expect(ergebnis).toContainText('52,76');
		const karte = page.locator('.karte, section').filter({ has: ergebnis }).last();
		await expect(karte.getByText('Aktueller Satz deckt die Kosten, Gewinn noch nicht erreicht')).toBeVisible();
		await karte.getByText('So wird gerechnet').click();
		await expect(karte.getByRole('cell', { name: '= Fakturierbare Stunden' })).toBeVisible();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);

		await karte.getByText('Bearbeiten').click();
		await karte.getByRole('button', { name: 'Mitarbeiter entfernen' }).click();
		await expect(page.getByLabel(`Ergebnis ${name}`)).toHaveCount(0);
	} finally {
		await page.goto('/kalkulation');
		await setzeFirma(page.locator('form[action="?/firma"]'), vorher);
	}
});
