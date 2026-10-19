import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Phase 1 der Wünsche von Jamil (19.10.2026): Kundenakte (Notizen, Dokumente, Platzhalter Kundenportal) und
 * Lautstärke/Schmutz an Auftrags-To-dos. Legt eigene Daten an und löscht sie am Ende wieder.
 */
const BUERO = 'buero@bauwelt.test';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

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

test('Kundenakte: Notiz schreiben, Dokument hochladen und herunterladen, löschen; Kundenportal-Platzhalter', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunde = await api(page, 'POST', '/api/kunden', { art: 'privat', nachname: `E2E-Akte ${info.project.name} ${Date.now()}` });
	try {
		await page.goto(`/kunden/${kunde.id}`);
		// Notiz
		const notiz = `Hund im Garten – bitte klingeln ${Date.now()}`;
		// Formulare sind eingeklappt (AddPanel) und gehen nach dem Speichern wieder zu
		await expect(page.getByLabel('Neue Notiz')).toHaveCount(0);
		await page.getByRole('button', { name: 'Notiz hinzufügen' }).click();
		await page.getByLabel('Neue Notiz').fill(notiz);
		await page.getByRole('button', { name: 'Notiz speichern' }).click();
		const notizen = page.getByRole('list', { name: 'Notizen' });
		await expect(notizen.getByText(notiz)).toBeVisible();
		await expect(page.getByLabel('Neue Notiz')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Notiz hinzufügen' })).toBeVisible();
		// Dokument
		await page.getByRole('button', { name: 'Dokument hochladen' }).click();
		await page.locator('input[type="file"][name="datei"]').setInputFiles({ name: 'Grundriss Bad.pdf', mimeType: 'application/pdf', buffer: PDF });
		await page.getByLabel('Beschreibung (optional)').fill('vom Kunden');
		await page.getByRole('button', { name: 'Hochladen' }).click();
		const dokumente = page.getByRole('list', { name: 'Dokumente' });
		const link = dokumente.getByRole('link', { name: /Grundriss Bad\.pdf/ });
		await expect(link).toBeVisible();
		await expect(dokumente.getByText(/vom Kunden/)).toBeVisible();
		const download = await Promise.all([page.waitForEvent('download'), link.click()]).then(([d]) => d);
		expect(download.suggestedFilename()).toBe('Grundriss Bad.pdf');
		// falscher Inhalt → Fehlermeldung, Feld bleibt offen, nichts gespeichert
		await page.getByRole('button', { name: 'Dokument hochladen' }).click();
		await page.locator('input[type="file"][name="datei"]').setInputFiles({ name: 'falsch.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>') });
		await page.getByRole('button', { name: 'Hochladen' }).click();
		await expect(page.getByRole('alert')).toContainText('passt nicht zum Dateityp');
		await expect(dokumente.getByRole('link')).toHaveCount(1);
		// Kundenportal (Platzhalter)
		await expect(page.getByRole('heading', { name: 'Kundenportal' })).toBeVisible();
		await expect(page.getByRole('button', { name: /Kundenportal öffnen/ })).toBeDisabled();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
		// löschen
		await dokumente.getByRole('button', { name: 'Dokument Grundriss Bad.pdf löschen' }).click();
		await expect(dokumente.getByText('Noch keine Dokumente.')).toBeVisible();
		await notizen.getByRole('button', { name: /^Notiz vom .* löschen$/ }).click();
		await expect(notizen.getByText('Noch keine Notizen.')).toBeVisible();
	} finally {
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});

test('Auftrags-To-do mit Lautstärke und Schmutz', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunden = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Belastung ${info.project.name} ${Date.now()}`, kundeId: kunden[0].id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		await page.getByRole('button', { name: '+ To-do hinzufügen' }).click();
		const f = page.locator('form.td-neu');
		await f.getByLabel('Neues To-do').fill('Fliesen abschlagen');
		await f.getByLabel('Lautstärke').selectOption('3');
		await f.getByLabel('Schmutz').selectOption('2');
		await f.getByRole('button', { name: 'To-do speichern' }).click();
		// Liste: Zeile aufklappen zeigt Details und Bearbeiten
		const zeile = page.locator('.tl-zeile', { hasText: 'Fliesen abschlagen' });
		await zeile.locator('.tl-titel').click();
		await expect(zeile.locator('.tl-details')).toContainText('Lautstärke: hoch');
		await expect(zeile.locator('.tl-details')).toContainText('Schmutz: mittel');
		await zeile.locator('select[name="lautstaerke"]').selectOption('1');
		await zeile.locator('select[name="schmutz"]').selectOption('');
		await zeile.getByRole('button', { name: 'Speichern' }).click();
		// nach dem Speichern zugeklappt; erneut öffnen
		await expect(zeile.locator('select[name="lautstaerke"]')).toHaveCount(0);
		await zeile.locator('.tl-titel').click();
		await expect(zeile.getByText('Lautstärke: gering')).toBeVisible();
		await expect(zeile.getByText(/Schmutz:/)).toHaveCount(0);
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
