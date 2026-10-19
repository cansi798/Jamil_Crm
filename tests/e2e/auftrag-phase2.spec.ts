import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';

/**
 * Phase 2 der Wünsche von Jamil (19.10.2026): Zuständige am Auftrag, Einsatzort (Standard = Kundenadresse), Termine
 * mit Art im Auftrag, Hinweise zum Kunden in der Auftragsakte. Legt eigene Daten an und löscht sie wieder.
 */
const BUERO = 'buero@bauwelt.test';

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

test('Auftrag: Zuständige, Einsatzort, Termin mit Art, Hinweise zum Kunden', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunde = await api(page, 'POST', '/api/kunden', {
		art: 'privat',
		nachname: `E2E-Phase2 ${info.project.name} ${Date.now()}`,
		strasse: 'Teichweg 5',
		plz: '22846',
		ort: 'Norderstedt',
		notiz: 'Zahlt nur bar'
	});
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: 'E2E Phase 2', kundeId: kunde.id });
	try {
		// Hinweis zum Kunden und Einsatzort (Kundenadresse)
		await page.goto(`/auftraege/${auftrag.id}`);
		await expect(page.getByRole('complementary', { name: 'Hinweise zum Kunden' })).toContainText('Zahlt nur bar');
		await expect(page.getByText('Teichweg 5, 22846 Norderstedt')).toBeVisible();
		await expect(page.getByText('(Kundenadresse)')).toBeVisible();

		// Zuständige über „Auftrag bearbeiten“
		await page.getByRole('link', { name: 'Auftrag bearbeiten' }).click();
		const objekt = page.locator('select[name="objektId"]');
		await expect(objekt).toHaveValue('');
		await expect(objekt.locator('option:checked')).toHaveText(/Kundenadresse \(Standard\) – Teichweg 5, 22846 Norderstedt/);
		await page.getByRole('checkbox', { name: 'Murat Öztürk' }).check();
		await page.getByRole('button', { name: 'Speichern' }).click();
		await page.waitForURL(new RegExp(`/auftraege/${auftrag.id}$`));
		await expect(page.locator('dd', { hasText: 'Murat Öztürk' })).toBeVisible();

		// Termin mit Art
		await page.getByText('+ Termin').click();
		const termin = page.locator('form[action="?/terminAnlegen"]');
		await termin.locator('select[name="art"]').selectOption('besichtigung');
		await termin.locator('select[name="benutzerId"]').selectOption({ label: 'Murat Öztürk' });
		await termin.locator('input[name="von"]').fill('09:00');
		await termin.locator('input[name="bis"]').fill('10:00');
		await termin.locator('input[name="notiz"]').fill('Aufmaß nehmen');
		await page.getByRole('button', { name: 'Termin speichern' }).click();
		const termine = page.locator('.af-einsaetze');
		await expect(termine.getByText('Besichtigung')).toBeVisible();
		await expect(termine.getByText('Aufmaß nehmen')).toBeVisible();
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});
