import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';
import { tagPlus } from '../../src/lib/zeit';

/** Erinnerungen (Jamil msgs 2679/2682): Glocke, Aufgaben-Formular, Push-Seite, eigener Termin mit Erinnerung. */
const BUERO = 'buero@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, { method: methode, headers: koerper === undefined ? undefined : { 'content-type': 'application/json' }, body: koerper === undefined ? undefined : JSON.stringify(koerper) });
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

test('Glocke, Aufgabe mit „Erinnern“, Push-Seite', async ({ page }) => {
	await anmelden(page, BUERO);
	await page.goto('/todos');
	const glocke = page.getByRole('button', { name: /^Benachrichtigungen/ }).locator('visible=true').first();
	await glocke.click();
	await expect(page.getByRole('region', { name: 'Benachrichtigungen' }).first()).toBeVisible();
	await page.keyboard.press('Escape');
	await page.mouse.click(5, 300);

	await page.getByRole('button', { name: /Aufgabe hinzufügen|Neue Aufgabe|\+ Aufgabe/ }).first().click();
	await page.getByRole('button', { name: '🔔 Erinnern' }).click();
	const gruppe = page.getByRole('group', { name: 'Erinnerungen' });
	await expect(gruppe.getByLabel('🔔 Erinnern')).toHaveValue('1440');
	await gruppe.getByLabel('und').selectOption('fest');
	await expect(gruppe.getByLabel('und: Tag und Uhrzeit')).toBeVisible();

	await page.goto('/konto/benachrichtigungen');
	await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Dieses Gerät' })).toContainText(/Push auf diesem Gerät: aus|blockiert|kann keine Push|Home-Bildschirm/);
});

test('Eigener Termin über „+“ mit Erinnerung, erscheint im Kalender', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const woche = await api(page, 'GET', '/api/plantafel');
	const tag = tagPlus(woche.tage[0], info.project.name === 'mobil' ? 30 : 29);
	const titel = `E2E Zahnarzt ${info.project.name} ${Date.now()}`;
	let id: string | null = null;
	try {
		await page.goto(`/plantafel?ansicht=tag&tag=${tag}`);
		await page.getByRole('button', { name: /^Neuer Termin am / }).click();
		const dlg = page.locator('dialog.pt-dialog');
		await dlg.getByLabel('📌 Eigener Termin (ohne Auftrag)').check();
		await dlg.getByLabel('Titel *').fill(titel);
		await dlg.getByLabel('Von').fill('09:00');
		await dlg.getByLabel('Bis').fill('10:00');
		await dlg.getByLabel('🔔').selectOption('60');
		await dlg.getByRole('button', { name: 'Einsatz anlegen' }).click();
		await expect(dlg).toBeHidden();
		await expect(page.getByRole('region', { name: /^Termine / })).toContainText(titel);
		const w = await api(page, 'GET', `/api/plantafel?tag=${tag}`);
		id = w.einsaetze.find((e: { auftragTitel: string }) => e.auftragTitel === titel)?.id ?? null;
		expect(id).toBeTruthy();
	} finally {
		if (id) await api(page, 'DELETE', `/api/einsaetze/${id}`);
	}
});
