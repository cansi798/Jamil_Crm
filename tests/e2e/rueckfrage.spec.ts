import { expect, test, type Page } from '@playwright/test';
import { anmelden, bestaetigen, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Regel von Jamil (Talk msg 3091): Vor jedem Löschen/Entfernen eine Rückfrage. Zeilen-Löschen (hier: Notiz beim
 * Kunden) fragt mit der gemeinsamen Blase nach; Abbrechen und Escape lassen alles stehen, kein Browser-confirm().
 * Eigene Wegwerf-Daten, am Ende gelöscht. Mit BILDSCHIRMFOTOS=/w/<ordner> entstehen Fotos zur Abnahme.
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

test('Notiz löschen: erst Rückfrage, Abbrechen/Escape behalten, „Löschen“ löscht', async ({ page }, info) => {
	page.on('dialog', (d) => {
		throw new Error(`Browser-Dialog statt Rückfrage-Blase: ${d.message()}`);
	});
	await anmelden(page, BUERO);
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: `E2E-Rückfrage ${info.project.name} ${Date.now()}` });
	try {
		await page.goto(`/kunden/${kunde.id}`);
		await page.getByRole('button', { name: 'Notiz hinzufügen' }).click();
		await page.getByLabel('Neue Notiz').fill('Wegwerf-Notiz');
		await page.getByRole('button', { name: 'Notiz speichern' }).click();
		const notizen = page.getByRole('list', { name: 'Notizen' });
		await expect(notizen.getByText('Wegwerf-Notiz')).toBeVisible();
		const knopf = notizen.getByRole('button', { name: /^Notiz vom .* löschen$/ });

		// 1. Klick → Blase, nichts gelöscht; Abbrechen
		await knopf.click();
		const blase = page.getByTestId('rueckfrage');
		await expect(blase).toBeVisible();
		await expect(blase).toContainText('Notiz wirklich löschen?');
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		if (ORDNER) await page.screenshot({ path: `${ORDNER}/rueckfrage-notiz-${info.project.name}.png` });
		await blase.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(blase).toHaveCount(0);
		await page.waitForTimeout(500);
		await expect(notizen.getByText('Wegwerf-Notiz')).toBeVisible();

		// 2. Escape schließt ebenfalls ohne Löschen
		await knopf.click();
		await expect(blase).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(blase).toHaveCount(0);
		await expect(notizen.getByText('Wegwerf-Notiz')).toBeVisible();

		// 3. Bestätigen löscht
		await knopf.click();
		await bestaetigen(page);
		await expect(notizen.getByText('Wegwerf-Notiz')).toHaveCount(0);
	} finally {
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`).catch(() => undefined);
	}
});
