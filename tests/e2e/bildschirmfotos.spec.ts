import { expect, test } from '@playwright/test';
import { anmelden, anmeldenAlsAdmin } from './hilfe';

/**
 * Bildschirmfotos zur Abnahme (keine Prüfung im eigentlichen Sinn). Läuft nur, wenn BILDSCHIRMFOTOS auf einen
 * Ordner zeigt, z. B.:
 *   … bash -lc 'BILDSCHIRMFOTOS=/w/pfad/zum/ordner npx -y playwright@1.48.2 test bildschirmfotos'
 * Die Bilder werden nicht eingecheckt. Mobil: nur der sichtbare Bildschirm (bei ganzen Seiten läge die feste
 * Leiste unten scheinbar mitten im Inhalt).
 */
const ORDNER = process.env.BILDSCHIRMFOTOS;

test.describe('Bildschirmfotos', () => {
	test.skip(!ORDNER, 'nur mit BILDSCHIRMFOTOS=<ordner>');

	test('mobil: Anmeldung, Start, Kundenliste, Kunde, Mehr', async ({ page }, info) => {
		test.skip(info.project.name !== 'mobil', 'mobil');
		await page.goto('/anmelden');
		await page.screenshot({ path: `${ORDNER}/anmeldung-mobil.png` });
		await anmelden(page, 'buero@bauwelt.test');
		await page.screenshot({ path: `${ORDNER}/start-mobil.png` });
		await page.goto('/kunden');
		await page.screenshot({ path: `${ORDNER}/kundenliste-mobil.png` });
		await page.goto('/kunden?suche=weißenböck');
		await page.getByRole('main').getByRole('list').getByRole('link').first().click();
		await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
		await page.screenshot({ path: `${ORDNER}/kunde-mobil.png` });
		await page.goto('/mehr');
		await page.screenshot({ path: `${ORDNER}/mehr-mobil.png` });
	});

	test('Desktop: Kundenliste und Admin-Übersicht', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop');
		await anmelden(page, 'buero@bauwelt.test');
		await page.goto('/kunden');
		await page.screenshot({ path: `${ORDNER}/kundenliste-desktop.png`, fullPage: true });
		await page.getByRole('button', { name: 'Abmelden' }).click();
		await expect(page).toHaveURL(/\/anmelden$/);
		await anmeldenAlsAdmin(page);
		await expect(page.getByRole('heading', { name: 'Betriebe', exact: true })).toBeVisible();
		await page.screenshot({ path: `${ORDNER}/admin-uebersicht-desktop.png`, fullPage: true });
	});
});
