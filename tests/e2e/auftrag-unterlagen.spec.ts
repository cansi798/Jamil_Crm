import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Dokumente und Notizen direkt im Auftrag (Jamil msg 3070): „+ Notiz hinzufügen“ / „+ Dokument hochladen“ wie
 * „+ Link hinzufügen“, „Im Kundenportal“ beim Anlegen und später in der Zeile, im Portal nur Freigegebenes.
 * Legt einen EIGENEN Testkunden an (Portal-Link nur für ihn) und räumt am Ende auf.
 */

async function chef(browser: Browser, viewport: { width: number; height: number }) {
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	return page;
}

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	return page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, { method: methode, headers: koerper ? { 'content-type': 'application/json' } : undefined, body: koerper ? JSON.stringify(koerper) : undefined });
			return { status: a.status, json: await a.json().catch(() => null) };
		},
		{ methode, url, koerper }
	);
}

// kleinstes gültiges PNG (1×1)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test('Notiz und Dokument inline, „Im Kundenportal“ beim Anlegen und in der Zeile, im Portal nur Freigegebenes', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const page = await chef(browser, viewport);
	const name = `Unterlagen${info.project.name === 'mobil' ? 'M' : 'D'}${Date.now().toString(36)}`;
	const kd = await api(page, 'POST', '/api/kunden', { art: 'privat', vorname: 'Eva', nachname: name, plz: '24105', ort: 'Kiel' });
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `Unterlagen ${name}`, kundeId: kd.json.id });
	try {
		await page.goto(`/auftraege/${auftrag.json.id}`);
		const karte = page.locator('.k-doku');
		await expect(karte.getByRole('link', { name: 'Dokumentation öffnen' })).toHaveAttribute('href', `/auftraege/${auftrag.json.id}/dokumentation`);

		// Notiz MIT Portal-Häkchen
		await karte.getByRole('button', { name: 'Notiz hinzufügen' }).click();
		let feld = karte.getByRole('region', { name: 'Notiz hinzufügen' });
		await feld.getByLabel('Notiz', { exact: true }).fill('Bitte Zufahrt freihalten');
		await feld.getByLabel(/Im Kundenportal sichtbar/).check();
		await feld.getByRole('button', { name: 'Notiz speichern' }).click();
		const liste = karte.getByRole('list', { name: 'Dokumente und Notizen' });
		await expect(liste.getByText('Bitte Zufahrt freihalten')).toBeVisible();
		await expect(liste.getByRole('switch', { name: /im Kundenportal anzeigen/ }).first()).toHaveAttribute('aria-checked', 'true');

		// interne Notiz (Standard: aus)
		await karte.getByRole('button', { name: 'Notiz hinzufügen' }).click();
		feld = karte.getByRole('region', { name: 'Notiz hinzufügen' });
		await expect(feld.getByLabel(/Im Kundenportal sichtbar/)).not.toBeChecked();
		await feld.getByLabel('Notiz', { exact: true }).fill('Intern: Kunde zahlt spät');
		await feld.getByRole('button', { name: 'Notiz speichern' }).click();
		await expect(liste.getByText('Intern: Kunde zahlt spät')).toBeVisible();

		// Dokument ohne Häkchen hochladen, dann in der Zeile freigeben
		await karte.getByRole('button', { name: 'Dokument hochladen' }).click();
		const dok = karte.getByRole('region', { name: 'Dokument hochladen' });
		await dok.locator('input[type="file"]').setInputFiles({ name: 'baustelle.png', mimeType: 'image/png', buffer: PNG });
		await dok.getByRole('button', { name: 'Hochladen' }).click();
		const schalter = liste.getByRole('switch', { name: '„baustelle.png“ im Kundenportal anzeigen' });
		await expect(schalter).toHaveAttribute('aria-checked', 'false');
		await schalter.click();
		await expect(schalter).toHaveAttribute('aria-checked', 'true');
		await erwarteKeinQuerScrollen(page, viewport.width);

		// Portal-Link für den Testkunden, Kunde meldet sich mit der PLZ an
		await page.goto(`/kunden/${kd.json.id}`);
		await page.locator('#kundenportal').getByRole('button', { name: 'Link für den Kunden erzeugen' }).click();
		const pfad = new URL(await page.locator('#kundenportal').getByLabel('Portal-Link').inputValue()).pathname;
		const gast = await browser.newContext({ viewport, locale: 'de-DE' });
		const kunde = await gast.newPage();
		await kunde.goto(pfad);
		await kunde.getByLabel('Bitte geben Sie Ihr Passwort ein (Ihre Postleitzahl)').fill('24105');
		await kunde.getByRole('button', { name: 'Öffnen' }).click();
		const unterlagen = kunde.getByRole('region', { name: 'Ihre Unterlagen' });
		await expect(unterlagen).toContainText('Bitte Zufahrt freihalten');
		await expect(unterlagen).toContainText(/Notiz vom \d{2}\.\d{2}\.\d{4}/);
		await expect(unterlagen.getByRole('link', { name: /baustelle\.png/ })).toBeVisible();
		await expect(kunde.locator('body')).not.toContainText('zahlt spät');
		await erwarteKeinQuerScrollen(kunde, viewport.width);
		await gast.close();
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.json.id}`);
		await api(page, 'DELETE', `/api/kunden/${kd.json.id}`);
		await page.context().close().catch(() => {});
	}
});
