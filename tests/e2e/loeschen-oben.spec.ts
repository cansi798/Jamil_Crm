import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Regel von Jamil (Talk msg 3043): Löschen eines ganzen Datensatzes steht oben rechts im Seitenkopf; die Rückfrage
 * klappt direkt unter dem Kopf auf („Abbrechen“ / „Endgültig löschen“). Eigene Wegwerf-Daten, am Ende gelöscht.
 * Mit BILDSCHIRMFOTOS=/w/<ordner> entstehen Fotos zur Abnahme.
 */
const BUERO = 'buero@bauwelt.test';
const ORDNER = process.env.BILDSCHIRMFOTOS;

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

/** Der Knopf steht in den Kopf-Aktionen und rechts oben (rechter Rand nahe am rechten Rand des Kopfs). */
async function erwarteObenRechts(page: Page, name: string) {
	const knopf = page.locator('.seiten-kopf .seiten-aktionen').getByRole('button', { name });
	await expect(knopf).toBeVisible();
	const k = (await knopf.boundingBox())!;
	const kopf = (await page.locator('.seiten-kopf').first().boundingBox())!;
	expect(kopf.x + kopf.width - (k.x + k.width)).toBeLessThan(kopf.width / 2);
	expect(k.y - kopf.y).toBeLessThan(kopf.height);
}

test('Objekt und Kunde: „… löschen“ oben rechts, Rückfrage unter dem Kopf, Abbrechen und Endgültig löschen', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const breite = page.viewportSize()!.width;
	const stempel = `${info.project.name} ${Date.now()}`;
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: `E2E-Löschen ${stempel}` });
	let kundeGeloescht = false;
	try {
		await page.goto(`/kunden/${kunde.id}/objekte/neu`);
		await page.locator('input[name="bezeichnung"]').fill('Wegwerf-Objekt');
		await page.getByRole('button', { name: 'Objekt anlegen' }).click();
		await page.waitForURL(new RegExp(`/kunden/${kunde.id}$`));
		await page.getByRole('link', { name: /Wegwerf-Objekt/ }).first().click();
		await page.waitForURL(/\/objekte\/[0-9a-f-]{36}$/);
		const objektUrl = page.url();

		// Objekt: Knopf oben rechts, kein altes „Objekt löschen …“ unten mehr
		await erwarteObenRechts(page, 'Objekt löschen');
		await expect(page.getByText('Objekt löschen …')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Endgültig löschen' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Objekt löschen' }).click();
		const panel = page.getByRole('region', { name: 'Objekt löschen' });
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('Das Objekt wird endgültig gelöscht.');
		// Rückfrage direkt unter dem Kopf
		const kopf = (await page.locator('.seiten-kopf').boundingBox())!;
		const p = (await panel.boundingBox())!;
		expect(p.y - (kopf.y + kopf.height)).toBeLessThan(40);
		await erwarteKeinQuerScrollen(page, breite);
		if (ORDNER) await page.screenshot({ path: `${ORDNER}/objekt-loeschen-${info.project.name}.png` });
		await panel.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(panel).toHaveCount(0);
		// Endgültig löschen → zurück zum Kunden
		await page.getByRole('button', { name: 'Objekt löschen' }).click();
		await page.getByRole('button', { name: 'Endgültig löschen' }).click();
		await page.waitForURL(new RegExp(`/kunden/${kunde.id}$`));
		expect(page.url()).not.toBe(objektUrl);

		// Kunde: gleicher Baustein
		await erwarteObenRechts(page, 'Kunde löschen');
		await page.getByRole('button', { name: 'Kunde löschen' }).click();
		await expect(page.getByRole('region', { name: 'Kunde löschen' })).toBeVisible();
		await erwarteKeinQuerScrollen(page, breite);
		if (ORDNER) await page.screenshot({ path: `${ORDNER}/kunde-loeschen-${info.project.name}.png` });
		await page.getByRole('button', { name: 'Endgültig löschen' }).click();
		await expect(page).toHaveURL(/\/kunden$/);
		kundeGeloescht = true;
	} finally {
		if (!kundeGeloescht) await api(page, 'DELETE', `/api/kunden/${kunde.id}`).catch(() => undefined);
	}
});

test('Rolle mit Benutzern: Fehler bleibt in der offenen Rückfrage stehen', async ({ page }, info) => {
	test.skip(info.project.name === 'mobil', 'einmal reicht');
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	await page.goto('/einstellungen/rollen');
	// Eine Rolle, die noch Benutzer hat (z. B. „Inhaber“) – Löschen schlägt fehl, es wird nichts gelöscht
	// Nur eine Rolle wählen, die laut Liste mindestens einen Benutzer hat (sonst würde wirklich gelöscht)
	await page.locator('a[href^="/einstellungen/rollen/"]').filter({ hasText: /·\s*[1-9]\d*\s+Benutzer/ }).first().click();
	await page.waitForURL(/\/einstellungen\/rollen\/[0-9a-f-]{36}$/);
	await erwarteObenRechts(page, 'Rolle löschen');
	await page.getByRole('button', { name: 'Rolle löschen' }).click();
	const panel = page.getByRole('region', { name: 'Rolle löschen' });
	await expect(panel).toBeVisible();
	await panel.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(panel.getByRole('alert')).toContainText('noch von Benutzern verwendet');
	await expect(panel.getByRole('button', { name: 'Endgültig löschen' })).toBeVisible();
	if (ORDNER) await page.screenshot({ path: `${ORDNER}/rolle-fehler-${info.project.name}.png` });
});
