import { expect, test } from '@playwright/test';
import { anmelden, anmeldenAlsAdmin } from './hilfe';
import { pdfSeiteAlsPng } from './pdf-seite';

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

	test('Stufe 1b mobil: Start „heute“ (Monteur), Auftrag, To-dos, Plantafel (Büro)', async ({ page }, info) => {
		test.skip(info.project.name !== 'mobil', 'mobil');
		await anmelden(page, 'monteur@bauwelt.test');
		await page.goto('/');
		await page.screenshot({ path: `${ORDNER}/1b-start-heute-mobil.png` });
		await page.goto('/auftraege');
		await page.screenshot({ path: `${ORDNER}/1b-auftraege-monteur-mobil.png` });
		await page.goto('/todos');
		await page.screenshot({ path: `${ORDNER}/1b-todos-monteur-mobil.png` });
		await page.context().clearCookies();
		await anmelden(page, 'buero@bauwelt.test');
		await page.goto('/auftraege');
		await page.getByRole('main').getByRole('link', { name: /Badsanierung/ }).first().click();
		await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/);
		await page.screenshot({ path: `${ORDNER}/1b-auftrag-mobil.png`, fullPage: true });
		await page.goto('/plantafel');
		await page.screenshot({ path: `${ORDNER}/1b-plantafel-mobil.png` });
	});

	test('Stufe 1b Desktop: Plantafel, Aufträge, Auftrag, To-dos, Abwesenheiten, Start „heute“', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop');
		await anmelden(page, 'buero@bauwelt.test');
		await page.goto('/plantafel');
		await page.screenshot({ path: `${ORDNER}/1b-plantafel-desktop.png`, fullPage: true });
		await page.goto('/auftraege');
		await page.screenshot({ path: `${ORDNER}/1b-auftraege-desktop.png`, fullPage: true });
		await page.getByRole('main').getByRole('link', { name: /Badsanierung/ }).first().click();
		await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/);
		await page.screenshot({ path: `${ORDNER}/1b-auftrag-desktop.png`, fullPage: true });
		await page.goto('/todos?nur=alle');
		await page.screenshot({ path: `${ORDNER}/1b-todos-desktop.png`, fullPage: true });
		await page.goto('/plantafel/abwesenheiten');
		await page.screenshot({ path: `${ORDNER}/1b-abwesenheiten-desktop.png`, fullPage: true });
		await page.context().clearCookies();
		await anmelden(page, 'monteur@bauwelt.test');
		await page.goto('/');
		await page.screenshot({ path: `${ORDNER}/1b-start-heute-desktop.png`, fullPage: true });
	});

	test('Stufe 1c mobil: Katalog, Angebots-Editor (Entwurf), Auftrag mit Angeboten', async ({ page }, info) => {
		test.skip(info.project.name !== 'mobil', 'mobil');
		await anmelden(page, 'buero@bauwelt.test');
		await page.goto('/katalog');
		await page.screenshot({ path: `${ORDNER}/1c-katalog-mobil.png` });
		await page.goto('/angebote');
		await page.screenshot({ path: `${ORDNER}/1c-angebote-mobil.png` });
		await page.getByRole('main').getByRole('link', { name: /Weißenböck/ }).first().click();
		await expect(page).toHaveURL(/\/angebote\/[0-9a-f-]{36}$/);
		await page.screenshot({ path: `${ORDNER}/1c-angebot-editor-mobil.png` });
		await page.screenshot({ path: `${ORDNER}/1c-angebot-editor-mobil-ganz.png`, fullPage: true });
		await page.getByRole('link', { name: /← Auftrag/ }).click();
		await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/);
		await page.getByRole('heading', { name: 'Angebote' }).scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${ORDNER}/1c-auftrag-angebote-mobil.png` });
	});

	test('Stufe 1c Desktop: Katalog, Angebote, Editor, Monteur ohne Preise, erste PDF-Seite', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop');
		await anmelden(page, 'buero@bauwelt.test');
		await page.goto('/katalog');
		await page.screenshot({ path: `${ORDNER}/1c-katalog-desktop.png`, fullPage: true });
		await page.goto('/angebote');
		await page.screenshot({ path: `${ORDNER}/1c-angebote-desktop.png`, fullPage: true });
		await page.getByRole('main').getByRole('link', { name: /Weißenböck/ }).first().click();
		await expect(page).toHaveURL(/\/angebote\/[0-9a-f-]{36}$/);
		const id = page.url().split('/').pop()!;
		await page.screenshot({ path: `${ORDNER}/1c-angebot-editor-desktop.png`, fullPage: true });
		const bytes = await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), `/api/angebote/${id}/pdf`);
		await page.goto('/angebote?status=versendet');
		await page.getByRole('main').getByRole('link', { name: /AN-\d{4}-/ }).first().click();
		await expect(page).toHaveURL(/\/angebote\/[0-9a-f-]{36}$/);
		await page.screenshot({ path: `${ORDNER}/1c-angebot-versendet-desktop.png`, fullPage: true });
		await page.context().clearCookies();
		await anmelden(page, 'monteur@bauwelt.test');
		await page.goto('/auftraege');
		await page.getByRole('main').getByRole('link', { name: /Ladenumbau/ }).first().click();
		await page.screenshot({ path: `${ORDNER}/1c-auftrag-monteur-ohne-preise-desktop.png`, fullPage: true });
		await pdfSeiteAlsPng(page, new Uint8Array(bytes), `${ORDNER}/1c-angebot-pdf-seite1.png`);
	});
});
