import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Schnellzugriff unten rechts (Jamil msgs 3078/3079): runder Knopf öffnet ein kleines Menü mit Sprachsteuerung,
 * Neuer Kunde, Neuer Auftrag, Neuer Termin, Neue Aufgabe – je nach Modul und Recht. Nur mit Testmodus
 * (Anmeldung nur mit Benutzername). Legt nichts an (Formulare/Dialoge werden nur geöffnet).
 */
const FOTOS = process.env.FOTO_ORDNER;
const EINTRAEGE = ['Sprachsteuerung', 'Neuer Kunde', 'Neuer Auftrag', 'Neuer Termin', 'Neue Aufgabe'];

async function anmeldenAls(browser: Browser, info: TestInfo, benutzer: string) {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin', isMobile: info.project.name === 'mobil', hasTouch: info.project.name === 'mobil' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill(benutzer);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	return { ctx, page, viewport };
}

test.describe('Schnellzugriff', () => {
	test('Chef: Menü mit allen fünf Einträgen, schließt mit Escape und Klick daneben, Tastatur', async ({ browser }, info) => {
		const { ctx, page, viewport } = await anmeldenAls(browser, info, 'can.chef');
		await page.goto('/');
		const knopf = page.getByRole('button', { name: 'Schnellzugriff' });
		await expect(knopf).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('button', { name: 'Sprachbefehl' })).toHaveCount(0);
		const menue = page.getByRole('menu', { name: 'Schnellzugriff' });
		await expect(menue).toBeHidden();

		await knopf.click();
		await expect(knopf).toHaveAttribute('aria-expanded', 'true');
		await expect(menue.getByRole('menuitem')).toHaveText(EINTRAEGE);
		// Aufklapp-Animation abwarten (Einträge wachsen von 90 % auf 100 %), dann messen
		await menue.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((x) => x.finished)));
		// Alle Einträge vollständig im Fenster, nichts scrollt quer, Tippziele ≥ 44 px
		for (const e of await menue.getByRole('menuitem').all()) {
			const b = (await e.boundingBox())!;
			expect(b.x).toBeGreaterThanOrEqual(0);
			expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
			expect(b.y).toBeGreaterThanOrEqual(0);
			expect(b.height).toBeGreaterThanOrEqual(44);
		}
		await erwarteKeinQuerScrollen(page, viewport.width);
		// Menü liegt über dem Knopf und deckt die Leiste unten (Handy) nicht zu
		const kb = (await knopf.boundingBox())!;
		const oberster = (await menue.getByRole('menuitem', { name: 'Neue Aufgabe' }).boundingBox())!;
		expect(oberster.y + oberster.height).toBeLessThanOrEqual(kb.y);
		if (FOTOS) await page.screenshot({ path: `${FOTOS}/schnellzugriff-offen-${info.project.name}.png` });

		await page.keyboard.press('Escape');
		await expect(menue).toBeHidden();
		await expect(knopf).toBeFocused();
		await expect(knopf).toHaveAttribute('aria-expanded', 'false');

		// Klick daneben schließt
		await knopf.click();
		await expect(menue).toBeVisible();
		await page.mouse.click(10, 200);
		await expect(menue).toBeHidden();

		// Tastatur: Enter öffnet und setzt den Fokus auf den Eintrag am Knopf, Pfeil hoch geht nach oben
		await knopf.focus();
		await page.keyboard.press('Enter');
		await expect(menue.getByRole('menuitem', { name: 'Sprachsteuerung' })).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(menue.getByRole('menuitem', { name: 'Neuer Kunde' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(menue.getByRole('menuitem', { name: 'Neue Aufgabe' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(knopf).toBeFocused();
		await ctx.close();
	});

	test('Chef: jeder Eintrag öffnet das Richtige', async ({ browser }, info) => {
		const { ctx, page } = await anmeldenAls(browser, info, 'can.chef');
		const knopf = page.getByRole('button', { name: 'Schnellzugriff' });
		const menue = page.getByRole('menu', { name: 'Schnellzugriff' });
		const waehle = async (name: string) => {
			await knopf.click();
			await menue.getByRole('menuitem', { name }).click();
		};

		await page.goto('/');
		await waehle('Neuer Kunde');
		await expect(page).toHaveURL(/\/kunden\/neu$/);
		await expect(page.getByRole('heading', { name: 'Neuer Kunde', level: 1 })).toBeVisible();
		await expect(menue).toBeHidden();
		await expect(knopf).toHaveAttribute('aria-expanded', 'false');

		await waehle('Neuer Auftrag');
		await expect(page).toHaveURL(/\/auftraege\/neu$/);
		await expect(page.getByRole('heading', { name: 'Neuer Auftrag', level: 1 })).toBeVisible();

		await waehle('Neuer Termin');
		await expect(page.getByRole('dialog', { name: 'Einsatz anlegen' })).toBeVisible();
		// „neu“ verschwindet aus der Adresse
		await expect(page).toHaveURL(/\/plantafel$/);
		if (FOTOS) await page.screenshot({ path: `${FOTOS}/schnellzugriff-termin-${info.project.name}.png` });
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Einsatz anlegen' })).toBeHidden();
		// Auch direkt auf der Plantafel geht „Neuer Termin“ noch einmal auf
		await waehle('Neuer Termin');
		await expect(page.getByRole('dialog', { name: 'Einsatz anlegen' })).toBeVisible();
		await page.keyboard.press('Escape');

		await waehle('Neue Aufgabe');
		await expect(page).toHaveURL(/\/todos$/);
		await expect(page.getByRole('textbox', { name: 'Neue Aufgabe' })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Neue Aufgabe' })).toBeFocused();

		await waehle('Sprachsteuerung');
		const dialog = page.getByRole('dialog', { name: 'Sprachbefehl' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(dialog).toBeHidden();
		await expect(knopf).toBeFocused();
		await ctx.close();
	});

	test('Monteur (ohne Sprache und ohne Anlegen-Rechte): kein Knopf', async ({ browser }, info) => {
		const { ctx, page } = await anmeldenAls(browser, info, 'can.monteur');
		await page.goto('/');
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).first()).toBeAttached();
		await expect(page.getByRole('button', { name: 'Schnellzugriff' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Sprachbefehl' })).toHaveCount(0);
		await ctx.close();
	});
});
